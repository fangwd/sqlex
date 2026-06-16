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
  return new Builder(connection, catalogName).getResult();
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
