import { Connection } from '.';
import {
  Database as SchemaInfo,
  Table as TableInfo,
  Column as ColumnInfo,
  Constraint as ConstraintInfo
} from '../types';
import { lower, queryInformationSchema as query } from './util';

type KeyColumn = [columnName: string, reference: [string, string]];

export function getInformationSchema(
  connection: Connection,
  catalogName: string,
  schemaName?: string
): Promise<SchemaInfo> {
  if (connection.dialect === 'postgres') {
    const Builder = require('./postgres').default.SchemaBuilder;
    return new Builder(connection, catalogName, schemaName).getResult();
  }
  if (connection.dialect === 'sqlite3') {
    return new SqliteBuilder(connection).getResult();
  }
  return new Builder(connection, catalogName).getResult();
}

interface TableInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

interface ForeignKeyRow {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string | null;
}

interface IndexListRow {
  seq: number;
  name: string;
  unique: number;
  origin: string;
}

interface IndexInfoRow {
  seqno: number;
  cid: number;
  name: string | null;
}

// SQLite has no information_schema; reconstruct SchemaInfo from its PRAGMA
// interface. The table-valued pragma_*() functions are used (rather than bare
// PRAGMA) so the queries run through the standard select path.
class SqliteBuilder {
  connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  async getResult(): Promise<SchemaInfo> {
    const conn = this.connection;
    const tableRows = await query<{ name: string }>(
      conn,
      "select name from sqlite_master where type = 'table' " +
        "and name not like 'sqlite_%' and name <> 'sqlite_sequence'"
    );

    // First pass: columns and primary keys (the latter are needed to resolve
    // foreign keys that reference a table's primary key implicitly).
    const raw: { name: string; cols: TableInfoRow[] }[] = [];
    const pkByTable: { [table: string]: string[] } = {};
    for (const { name } of tableRows) {
      const cols = await query<TableInfoRow>(
        conn,
        `select * from pragma_table_info(${conn.escape(name)})`
      );
      raw.push({ name, cols });
      pkByTable[name] = cols
        .filter(c => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map(c => c.name);
    }

    const schemaInfo: SchemaInfo = { name: conn.database || '', tables: [] };
    for (const { name, cols } of raw) {
      const pkCols = pkByTable[name];
      const columns: ColumnInfo[] = cols.map(c => {
        const declared = (c.type || 'text').trim();
        // Split a declared type like 'varchar(200)' into base type + size so
        // it lines up with how the other dialects report data_type.
        const baseType = declared.replace(/\(.*$/, '').trim();
        const columnInfo: ColumnInfo = {
          name: c.name,
          type: baseType.toLowerCase(),
          nullable: !(c.notnull || c.pk > 0)
        };
        if (/char|text/i.test(baseType)) {
          const m = /\(\s*(\d+)/.exec(declared);
          if (m) columnInfo.size = Number(m[1]);
        }
        // An INTEGER PRIMARY KEY is SQLite's auto-incrementing rowid alias.
        if (pkCols.length === 1 && c.pk === 1 && /^integer$/i.test(baseType)) {
          columnInfo.autoIncrement = true;
        }
        if (c.dflt_value !== null && c.dflt_value !== undefined) {
          columnInfo.default = c.dflt_value as ColumnInfo['default'];
        }
        return columnInfo;
      });

      const constraints: ConstraintInfo[] = [];
      if (pkCols.length) {
        constraints.push({ primaryKey: true, columns: pkCols });
      }

      // Unique constraints and unique indexes (skip the implicit primary key).
      const indexes = await query<IndexListRow>(
        conn,
        `select * from pragma_index_list(${conn.escape(name)})`
      );
      for (const idx of indexes) {
        if (!idx.unique || idx.origin === 'pk') continue;
        const info = await query<IndexInfoRow>(
          conn,
          `select * from pragma_index_info(${conn.escape(idx.name)})`
        );
        const uniqueCols = info
          .sort((a, b) => a.seqno - b.seqno)
          .map(r => r.name)
          .filter((n): n is string => n != null);
        if (uniqueCols.length) {
          constraints.push({ unique: true, columns: uniqueCols });
        }
      }

      // Foreign keys, grouped by id (a composite key spans several rows).
      const fkRows = await query<ForeignKeyRow>(
        conn,
        `select * from pragma_foreign_key_list(${conn.escape(name)})`
      );
      const groups: { [id: string]: ForeignKeyRow[] } = {};
      for (const fk of fkRows) {
        (groups[fk.id] = groups[fk.id] || []).push(fk);
      }
      for (const id of Object.keys(groups)) {
        const group = groups[id].sort((a, b) => a.seq - b.seq);
        const refTable = group[0].table;
        const refPk = pkByTable[refTable] || [];
        constraints.push({
          columns: group.map(g => g.from),
          references: {
            table: refTable,
            columns: group
              .map((g, i) => g.to ?? refPk[i])
              .filter((c): c is string => c != null)
          }
        });
      }

      schemaInfo.tables.push({ name, columns, constraints });
    }

    return schemaInfo;
  }
}

class Builder {
  connection: Connection;
  schemaName: string;
  escapedSchemaName: string;

  constructor(connection: Connection, schemaName: string) {
    this.connection = connection;
    this.schemaName = schemaName;
    this.escapedSchemaName = connection.escape(schemaName);
  }

  getResult(): Promise<SchemaInfo> {
    return Promise.all([
      this.getTables(),
      this.getColumns(),
      this.getTableConstraints(),
      this.getKeyColumnUsage()
    ]).then(result => {
      const [
        tableSet,
        tableColumnsMap,
        tableConstraintMap,
        tableConstraintColumnsMap
      ] = result;

      const schemaInfo: SchemaInfo = {
        name: this.schemaName,
        tables: []
      };

      for (const tableName in tableColumnsMap) {
        if (!tableSet.has(tableName)) continue;
        const tableInfo: TableInfo = {
          name: tableName,
          columns: tableColumnsMap[tableName],
          constraints: []
        };

        for (const constraintName in tableConstraintMap[tableName]) {
          const type = tableConstraintMap[tableName][constraintName];
          const columns = tableConstraintColumnsMap[tableName][constraintName];
          const constraint: ConstraintInfo = {
            name: constraintName,
            columns: columns.map(entry => entry[0])
          };
          switch (type) {
            case 'PRIMARY KEY':
              constraint.primaryKey = true;
              break;
            case 'UNIQUE':
              constraint.unique = true;
              break;
            case 'FOREIGN KEY':
              constraint.references = {
                table: columns[0][1][0],
                columns: columns.map(entry => entry[1][1])
              };
              break;
          }
          tableInfo.constraints.push(constraint);
        }
        schemaInfo.tables.push(tableInfo);
      }

      return schemaInfo;
    });
  }

  getTables(): Promise<Set<string>> {
    return query(
      this.connection,
      `
        select table_name from information_schema.tables
        where table_schema = ${
          this.escapedSchemaName
        } and table_type = 'BASE TABLE'
        `
    ).then(rows => {
      const set = new Set<string>();
      for (const row of rows) {
        set.add(row.table_name as string);
      }
      return set;
    });
  }

  getColumns(): Promise<{ [key: string]: ColumnInfo[] }> {
    return query(
      this.connection,
      `
        select table_name, column_name, ordinal_position, column_default,
        is_nullable, data_type, character_maximum_length, extra
        from information_schema.columns
        where table_schema = ${this.escapedSchemaName}`
    ).then(rows => {
      const ordered: { [key: string]: [number, ColumnInfo][] } = {};
      for (const row of rows) {
        const tableName = row.table_name as string;
        ordered[tableName] = ordered[tableName] || [];
        const columnInfo: ColumnInfo = {
          name: row.column_name as string,
          type: row.data_type as string,
          nullable: row.is_nullable === 'YES'
        };
        if (/char|text/i.exec(columnInfo.type)) {
          columnInfo.size = row.character_maximum_length as number;
        }
        if (/auto_increment/i.exec(row.extra as string)) {
          columnInfo.autoIncrement = true;
        }
        ordered[tableName].push([row.ordinal_position as number, columnInfo]);
      }
      const map: { [key: string]: ColumnInfo[] } = {};
      for (const tableName in ordered) {
        map[tableName] = ordered[tableName]
          .sort((a, b) => a[0] - b[0])
          .map(r => r[1]);
      }
      return map;
    });
  }

  // table_name => constraint_name => constraint_type
  getTableConstraints(): Promise<{ [key: string]: { [key: string]: string } }> {
    return query(
      this.connection,
      `
        select table_name, constraint_name, constraint_type
        from information_schema.table_constraints
        where table_schema = ${this.escapedSchemaName}`
    ).then(rows => {
      const map: { [key: string]: { [key: string]: string } } = {};
      for (let row of rows) {
        row = lower(row);
        const tableName = row.table_name as string;
        map[tableName] = map[tableName] || {};
        map[tableName][row.constraint_name as string] = row.constraint_type as string;
      }
      return map;
    });
  }

  // table_name => constraint_name => column_name[]
  getKeyColumnUsage(): Promise<{
    [key: string]: { [key: string]: KeyColumn[] };
  }> {
    return query(
      this.connection,
      `
        select table_name, constraint_name, column_name, ordinal_position,
        referenced_table_name, referenced_column_name
        from information_schema.key_column_usage
        where table_schema = ${this.escapedSchemaName}`
    ).then(rows => {
      const ordered: {
        [key: string]: { [key: string]: [number, string, [string, string]][] };
      } = {};
      for (const row of rows) {
        const tableName = row.table_name as string;
        const constraintName = row.constraint_name as string;
        ordered[tableName] = ordered[tableName] || {};
        ordered[tableName][constraintName] =
          ordered[tableName][constraintName] || [];
        ordered[tableName][constraintName].push([
          row.ordinal_position as number,
          row.column_name as string,
          [
            row.referenced_table_name as string,
            row.referenced_column_name as string
          ]
        ]);
      }
      const map: { [key: string]: { [key: string]: KeyColumn[] } } = {};
      for (const tableName in ordered) {
        map[tableName] = {};
        for (const constraintName in ordered[tableName]) {
          map[tableName][constraintName] = ordered[tableName][constraintName]
            .sort((a, b) => a[0] - b[0])
            .map(r => [r[1], r[2]]);
        }
      }
      return map;
    });
  }
}
