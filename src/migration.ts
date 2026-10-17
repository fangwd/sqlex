import { createHash } from 'node:crypto';
import type {
  Column,
  Constraint,
  Database as DatabaseDefinition,
  Value,
} from './types';
import type { Database } from './database';
import {
  getInformationSchema,
  type Connection,
  type Dialect,
  type DialectEncoder,
} from './engine';
import { queryInformationSchema } from './engine/util';
import {
  type AnyFieldDefinition,
  type RecordClass,
  type RecordClassMap,
  columnName,
  foreignKeyName,
  schemaFromRecords,
} from './orm';
import { encodeVector, isVectorColumn } from './vector';

export type MigrationConstraint = Constraint;

export interface MigrationIndex {
  name: string;
  columns: string[];
  unique?: boolean;
  /**
   * Partial index predicate, emitted verbatim as `where <expression>`.
   * PostgreSQL and SQLite only; MySQL has no partial indexes.
   */
  where?: string;
}

export interface MigrationCheck {
  name: string;
  expression: string;
}

export interface MigrationTable {
  name: string;
  columns: Column[];
  constraints: MigrationConstraint[];
  indexes: MigrationIndex[];
  checks?: MigrationCheck[];
  comment?: string;
}

export interface MigrationSchema {
  name: string;
  tables: MigrationTable[];
}

export type MigrationOperation =
  | { kind: 'createTable'; table: MigrationTable }
  | { kind: 'dropTable'; table: string }
  | { kind: 'addColumn'; table: string; column: Column }
  | { kind: 'alterColumn'; table: string; column: Column; from?: Column }
  | { kind: 'dropColumn'; table: string; column: string }
  | { kind: 'renameColumn'; table: string; from: string; to: string }
  | { kind: 'addConstraint'; table: string; constraint: MigrationConstraint }
  | {
      kind: 'dropConstraint';
      table: string;
      constraint: string;
      definition?: MigrationConstraint;
    }
  | { kind: 'createIndex'; table: string; index: MigrationIndex }
  | { kind: 'dropIndex'; table: string; index: string }
  | { kind: 'addCheck'; table: string; check: MigrationCheck }
  | { kind: 'dropCheck'; table: string; check: string }
  | { kind: 'sql'; statements: string[] };

export interface Migration {
  id: string;
  readonly up: readonly MigrationOperation[];
  readonly down: readonly MigrationOperation[];
  schema?: MigrationSchema;
}

export interface MigrationDiff {
  operations: MigrationOperation[];
  warnings: string[];
  schema: MigrationSchema;
}

export interface MigrationStatus {
  id: string;
  applied: boolean;
  checksum: string;
  appliedAt?: string;
  valid?: boolean;
}

export interface MigrateOptions {
  dryRun?: boolean;
  target?: string;
}

export interface BaselineOptions extends Pick<MigrateOptions, 'target'> {
  force?: boolean;
}

export interface ReconcileOptions extends Pick<MigrateOptions, 'dryRun'> {
  /** Also alter changed columns and drop undeclared ones. */
  destructive?: boolean;
}

export interface MigrationResult {
  applied: string[];
  sql: string[];
}

export function defineMigration(migration: Migration): Migration {
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(migration.id)) {
    throw Error(`Invalid migration id: ${migration.id}`);
  }
  return Object.freeze({
    ...migration,
    up: Object.freeze([...migration.up]),
    down: Object.freeze([...migration.down]),
  });
}

export const operation = Object.freeze({
  createTable: (table: MigrationTable): MigrationOperation => ({
    kind: 'createTable',
    table,
  }),
  dropTable: (table: string): MigrationOperation => ({
    kind: 'dropTable',
    table,
  }),
  addColumn: (
    table: string,
    column: Column
  ): MigrationOperation => ({ kind: 'addColumn', table, column }),
  alterColumn: (
    table: string,
    column: Column,
    from?: Column
  ): MigrationOperation => ({
    kind: 'alterColumn',
    table,
    column,
    ...(from ? { from } : {}),
  }),
  dropColumn: (table: string, column: string): MigrationOperation => ({
    kind: 'dropColumn',
    table,
    column,
  }),
  renameColumn: (
    table: string,
    from: string,
    to: string
  ): MigrationOperation => ({ kind: 'renameColumn', table, from, to }),
  addConstraint: (
    table: string,
    constraint: MigrationConstraint
  ): MigrationOperation => ({ kind: 'addConstraint', table, constraint }),
  dropConstraint: (
    table: string,
    constraint: string | MigrationConstraint
  ): MigrationOperation => ({
    kind: 'dropConstraint',
    table,
    constraint: typeof constraint === 'string'
      ? constraint
      : requiredConstraintName(constraint),
    definition: typeof constraint === 'string' ? undefined : constraint,
  }),
  createIndex: (
    table: string,
    index: MigrationIndex
  ): MigrationOperation => ({ kind: 'createIndex', table, index }),
  dropIndex: (table: string, index: string): MigrationOperation => ({
    kind: 'dropIndex',
    table,
    index,
  }),
  addCheck: (table: string, check: MigrationCheck): MigrationOperation => ({
    kind: 'addCheck',
    table,
    check,
  }),
  dropCheck: (table: string, check: string): MigrationOperation => ({
    kind: 'dropCheck',
    table,
    check,
  }),
  sql: (statements: string | string[]): MigrationOperation => ({
    kind: 'sql',
    statements: typeof statements === 'string' ? [statements] : statements,
  }),
});

export function migrationSchemaFromRecords(
  classes: RecordClassMap,
  name = ''
): MigrationSchema {
  const schema = schemaFromRecords(classes, name).database;
  const byTable = new Map(
    Object.values(classes).map(recordClass => [
      recordClass.definition.table,
      recordClass,
    ])
  );

  return {
    name: schema.name,
    tables: schema.tables.map(table => {
      const recordClass = byTable.get(table.name)!;
      const fields = Object.entries(recordClass.definition.fields);
      // Table-level keys carry their own actions; a field's options only
      // feed the per-field key its declaration produced.
      const tableKeyNames = new Set(
        (recordClass.definition.foreignKeys || []).map(foreignKey =>
          foreignKey.name ||
          foreignKeyName(
            table.name,
            foreignKey.fields.map(fieldName =>
              columnName(fieldName, recordClass.definition.fields[fieldName])
            )
          )
        )
      );
      const constraints = table.constraints.map(constraint => {
        if (!constraint.references) return constraint;
        if (constraint.name && tableKeyNames.has(constraint.name)) {
          return constraint;
        }
        const field = fields.find(([fieldName, definition]) =>
          columnName(fieldName, definition) === constraint.columns[0]
        )![1];
        return {
          ...constraint,
          onDelete: stringOption(field, 'onDelete'),
          onUpdate: stringOption(field, 'onUpdate'),
        };
      });
      const indexes = fields.flatMap(([fieldName, definition]) => {
        const configured = definition.options.index;
        if (!configured) return [];
        const column = columnName(fieldName, definition);
        return [{
          name: typeof configured === 'string'
            ? configured
            : `${table.name}_${column}_idx`,
          columns: [column],
        }];
      });
      const columnOf = (fieldName: string): string => {
        const definition = recordClass.definition.fields[fieldName];
        if (!definition) {
          throw Error(`${table.name}: unknown field ${fieldName} in index`);
        }
        return columnName(fieldName, definition);
      };
      for (const declared of recordClass.definition.indexes || []) {
        const indexColumns = declared.fields.map(columnOf);
        indexes.push({
          name: declared.name || `${table.name}_${indexColumns.join('_')}_idx`,
          columns: indexColumns,
          ...(declared.unique ? { unique: true } : {}),
          ...(declared.where ? { where: declared.where } : {}),
        });
      }
      const checks = (recordClass.definition.checks || []).map(
        (check, position) => ({
          name: check.name || `${table.name}_check_${position + 1}`,
          expression: check.expression,
        })
      );
      return {
        ...table,
        constraints,
        indexes,
        ...(checks.length ? { checks } : {}),
      };
    }),
  };
}

export function diffMigrationSchemas(
  previous: MigrationSchema | undefined,
  next: MigrationSchema
): MigrationDiff {
  const operations: MigrationOperation[] = [];
  const warnings: string[] = [];
  const previousTables = new Map(
    (previous?.tables || []).map(table => [table.name, table])
  );
  const nextTables = new Map(next.tables.map(table => [table.name, table]));

  // New tables arrive fully ordered by createTableOperations; the diff of the
  // existing tables is ordered once at the end so backing keys precede the
  // foreign keys referencing them.
  const created = createTableOperations(
    next.tables.filter(table => !previousTables.has(table.name))
  );

  for (const table of next.tables) {
    const oldTable = previousTables.get(table.name);
    if (!oldTable) continue;

    const oldColumns = new Map(
      oldTable.columns.map(column => [column.name, column])
    );
    const newColumns = new Map(table.columns.map(column => [column.name, column]));
    const blockedColumns = new Set<string>();

    for (const column of table.columns) {
      if (!oldColumns.has(column.name)) {
        if (
          column.nullable !== true &&
          !hasUsableColumnDefault(column)
        ) {
          blockedColumns.add(column.name);
          warnings.push(
            `${table.name}.${column.name} is required and has no default; ` +
            'add an explicit backfill migration'
          );
        } else {
          operations.push(operation.addColumn(table.name, column));
        }
      } else if (!sameSchemaValue(oldColumns.get(column.name), column)) {
        operations.push(
          operation.alterColumn(table.name, column, oldColumns.get(column.name))
        );
      }
    }
    for (const column of oldTable.columns) {
      if (!newColumns.has(column.name)) {
        warnings.push(
          `${table.name}.${column.name} was removed; destructive changes are not generated`
        );
      }
    }

    diffConstraints(oldTable, table, operations, warnings, blockedColumns);
    diffIndexes(oldTable, table, operations, warnings, blockedColumns);
    diffChecks(oldTable, table, operations, warnings);
  }

  for (const table of previous?.tables || []) {
    if (!nextTables.has(table.name)) {
      warnings.push(
        `${table.name} was removed; destructive changes are not generated`
      );
    }
  }

  return {
    operations: [...created, ...orderAdditive(operations)],
    warnings,
    schema: next,
  };
}

export function makeMigration(
  id: string,
  classes: RecordClassMap,
  previous?: Migration
): { migration: Migration; warnings: string[] } {
  const schema = migrationSchemaFromRecords(classes, previous?.schema?.name);
  const diff = diffMigrationSchemas(previous?.schema, schema);
  const migration = defineMigration({
    id,
    up: diff.operations,
    down: invertOperations(diff.operations),
    schema,
  });
  return { migration, warnings: diff.warnings };
}

export function invertOperations(
  operations: readonly MigrationOperation[]
): MigrationOperation[] {
  return [...operations].reverse().map(item => {
    switch (item.kind) {
      case 'createTable':
        return operation.dropTable(item.table.name);
      case 'addColumn':
        return operation.dropColumn(item.table, item.column.name);
      case 'alterColumn':
        if (!item.from) break;
        return operation.alterColumn(item.table, item.from, item.column);
      case 'addConstraint':
        return operation.dropConstraint(item.table, item.constraint);
      case 'createIndex':
        return operation.dropIndex(item.table, item.index.name);
      case 'addCheck':
        return operation.dropCheck(item.table, item.check.name);
      case 'renameColumn':
        return operation.renameColumn(item.table, item.to, item.from);
      case 'sql':
        throw Error('Raw SQL operations require an explicit down migration');
    }
    throw Error(`${item.kind} cannot be automatically reversed`);
  });
}

export function printMigration(migration: Migration): string {
  return [
    "import { defineMigration } from 'sqlex';",
    '',
    `export default defineMigration(${JSON.stringify(migration, null, 2)});`,
    '',
  ].join('\n');
}

export class MigrationCompiler {
  constructor(
    readonly dialect: Dialect,
    private readonly encoder: DialectEncoder
  ) {}

  compile(operation: MigrationOperation): string[] {
    switch (operation.kind) {
      case 'createTable':
        return this.createTable(operation.table);
      case 'dropTable':
        return [`drop table ${this.id(operation.table)}`];
      case 'addColumn':
        if (this.dialect === 'sqlite3' && operation.column.defaultSql) {
          throw Error(
            'sqlite3 cannot add a column with a non-constant default ' +
            `(${operation.table}.${operation.column.name}); ` +
            'use an explicit table-rebuild migration'
          );
        }
        return [
          `alter table ${this.id(operation.table)} add column ` +
          this.column(operation.column),
          ...this.columnComment(operation.table, operation.column),
        ];
      case 'alterColumn':
        return this.alterColumn(
          operation.table,
          operation.column,
          operation.from
        );
      case 'dropColumn':
        return [
          `alter table ${this.id(operation.table)} drop column ` +
          this.id(operation.column)
        ];
      case 'renameColumn':
        return [
          `alter table ${this.id(operation.table)} rename column ` +
          `${this.id(operation.from)} to ${this.id(operation.to)}`
        ];
      case 'addConstraint':
        if (this.dialect === 'sqlite3') {
          throw Error(
            'SQLite cannot add constraints in place; use a table rebuild or raw SQL migration'
          );
        }
        return [
          `alter table ${this.id(operation.table)} add ` +
          this.constraint(operation.constraint)
        ];
      case 'dropConstraint':
        if (this.dialect === 'sqlite3') {
          throw Error(
            'SQLite cannot drop constraints in place; use a table rebuild or raw SQL migration'
          );
        }
        return [this.dropConstraint(
          operation.table,
          operation.constraint,
          operation.definition
        )];
      case 'createIndex':
        return [this.createIndex(operation.table, operation.index)];
      case 'dropIndex':
        return [this.dropIndex(operation.table, operation.index)];
      case 'addCheck':
        if (this.dialect === 'sqlite3') {
          throw Error(
            'SQLite cannot add constraints in place; use a table rebuild or raw SQL migration'
          );
        }
        return [
          `alter table ${this.id(operation.table)} add ` +
          `constraint ${this.id(operation.check.name)} ` +
          `check (${operation.check.expression})`,
        ];
      case 'dropCheck':
        if (this.dialect === 'sqlite3') {
          throw Error(
            'SQLite cannot drop constraints in place; use a table rebuild or raw SQL migration'
          );
        }
        // MySQL only accepts `drop check` for check constraints.
        return [
          `alter table ${this.id(operation.table)} drop ` +
          (this.dialect === 'mysql' ? 'check ' : 'constraint ') +
          this.id(operation.check),
        ];
      case 'sql':
        return [...operation.statements];
    }
  }

  private createTable(table: MigrationTable): string[] {
    const singlePrimary = table.constraints.find(
      constraint => constraint.primaryKey && constraint.columns.length === 1
    );
    const inlineSqlitePrimary =
      this.dialect === 'sqlite3' && singlePrimary
        ? table.columns.find(column =>
            column.name === singlePrimary.columns[0] &&
            column.autoIncrement &&
            /int/i.test(column.type)
          )
        : undefined;
    const definitions = table.columns.map(column =>
      this.column(
        column,
        inlineSqlitePrimary?.name === column.name
          ? ' primary key autoincrement'
          : ''
      )
    );
    for (const constraint of table.constraints) {
      if (inlineSqlitePrimary && constraint === singlePrimary) continue;
      definitions.push(this.constraint(constraint));
    }
    for (const check of table.checks || []) {
      definitions.push(
        `constraint ${this.id(check.name)} check (${check.expression})`
      );
    }
    let sql =
      `create table ${this.id(table.name)} (` + definitions.join(', ') + ')';
    if (this.dialect === 'mysql' && table.comment) {
      sql += ` comment ${this.encoder.escape(table.comment)}`;
    }

    // postgres stores comments through their own statements; sqlite has no
    // comment storage at all, so a comment simply is not emitted there.
    const statements = [sql];
    if (this.dialect === 'postgres') {
      if (table.comment) {
        statements.push(
          `comment on table ${this.id(table.name)} is ` +
            this.encoder.escape(table.comment)
        );
      }
      for (const column of table.columns) {
        statements.push(...this.columnComment(table.name, column));
      }
    }
    return statements;
  }

  private alterColumn(table: string, column: Column, from?: Column): string[] {
    if (this.dialect === 'sqlite3') {
      throw Error(
        `SQLite cannot alter columns in place (${table}.${column.name}); ` +
        'use a table rebuild or raw SQL migration'
      );
    }
    if (
      this.dialect === 'postgres' &&
      from &&
      Boolean(from.autoIncrement) !== Boolean(column.autoIncrement)
    ) {
      throw Error(
        'PostgreSQL cannot change whether a column is generated in place ' +
        `(${table}.${column.name}); write an explicit migration`
      );
    }
    const prefix = `alter table ${this.id(table)} `;
    if (this.dialect === 'mysql') {
      return [`${prefix}modify column ${this.column(column)}`];
    }
    const name = this.id(column.name);
    const type = this.type(column);
    const nullable = column.nullable === true ? 'drop' : 'set';
    const actions = [
      `alter column ${name} type ${type} using ${name}::${type}`,
      `alter column ${name} ${nullable} not null`,
    ];
    if (!column.autoIncrement) {
      const defaultValue = this.defaultValue(column);
      actions.push(
        `alter column ${name} ` +
        (defaultValue === undefined
          ? 'drop default'
          : `set default ${defaultValue}`)
      );
    }
    const values = column.userDefinedType?.values;
    if (column.type.toLowerCase() === 'enum' && values?.length) {
      // Re-create the check that stands in for the enum; its name is what
      // Postgres assigns to the inline check written by createTable.
      const check = this.id(`${table}_${column.name}_check`);
      actions.push(
        `drop constraint if exists ${check}`,
        `add constraint ${check} check (${name} in (` +
        values.map(value => this.encoder.escape(value)).join(', ') + '))'
      );
    }
    return [prefix + actions.join(', '), ...this.columnComment(table, column)];
  }

  private columnComment(table: string, column: Column): string[] {
    if (this.dialect !== 'postgres' || !column.comment) return [];
    return [
      `comment on column ${this.id(table)}.${this.id(column.name)} is ` +
        this.encoder.escape(column.comment),
    ];
  }

  private column(column: Column, suffix = ''): string {
    let type = this.type(column);
    if (
      this.dialect === 'postgres' &&
      column.autoIncrement &&
      /^(integer|int|bigint)$/i.test(column.type)
    ) {
      type = /big/i.test(column.type) ? 'bigserial' : 'serial';
    }
    let sql = `${this.id(column.name)} ${type}`;
    if (this.dialect === 'mysql' && column.autoIncrement) {
      sql += ' auto_increment';
    }
    if (!suffix && column.nullable !== true) {
      sql += ' not null';
    }
    const defaultValue = this.defaultValue(column);
    if (defaultValue !== undefined) {
      sql += ` default ${defaultValue}`;
    }
    if (
      column.type.toLowerCase() === 'enum' &&
      this.dialect !== 'mysql' &&
      column.userDefinedType?.values.length
    ) {
      const values = column.userDefinedType.values
        .map(value => this.encoder.escape(value))
        .join(', ');
      sql += ` check (${this.id(column.name)} in (${values}))`;
    }
    if (this.dialect === 'mysql' && column.comment) {
      sql += ` comment ${this.encoder.escape(column.comment)}`;
    }
    return sql + suffix;
  }

  private type(column: Column): string {
    const type = column.type.toLowerCase();
    if (type === 'vector') {
      return column.dimensions === undefined
        ? 'vector'
        : `vector(${column.dimensions})`;
    }
    if (type === 'varchar' || type === 'string') {
      return `varchar(${column.size || 255})`;
    }
    if (type === 'decimal') {
      return column.precision
        ? `decimal(${column.precision},${column.scale || 0})`
        : 'decimal';
    }
    if (type === 'jsonb') {
      if (this.dialect === 'postgres') return 'jsonb';
      // MySQL's json is already a binary representation; SQLite stores text.
      return this.dialect === 'sqlite3' ? 'text' : 'json';
    }
    if (type === 'datetime') {
      return this.dialect === 'postgres' ? 'timestamp' : 'datetime';
    }
    if (type === 'timestamptz') {
      // Only PostgreSQL distinguishes an offset-aware timestamp.
      return this.dialect === 'postgres' ? 'timestamptz' : 'datetime';
    }
    if (type === 'double' || type === 'float') {
      return this.dialect === 'postgres' ? 'double precision' : 'double';
    }
    if (type === 'uuid') {
      if (this.dialect === 'postgres') return 'uuid';
      return this.dialect === 'mysql' ? 'char(36)' : 'text';
    }
    if (type === 'json') {
      return this.dialect === 'sqlite3' ? 'text' : 'json';
    }
    if (type === 'boolean' && this.dialect === 'sqlite3') return 'integer';
    if (type === 'enum') {
      const values = column.userDefinedType?.values || [];
      if (this.dialect === 'mysql') {
        return `enum(${values.map(value => this.encoder.escape(value)).join(',')})`;
      }
      return 'text';
    }
    return type;
  }

  private defaultValue(column: Column): string | undefined {
    if (column.defaultSql) return column.defaultSql;
    if (column.default === undefined) return undefined;
    if (column.default === null) return 'null';
    if (isVectorColumn(column)) {
      const encoded = encodeVector(column.default, column, this.encoder);
      return this.dialect === 'mysql' ? `(${encoded})` : encoded;
    }
    if (typeof column.default === 'boolean') {
      return column.default ? 'true' : 'false';
    }
    if (typeof column.default === 'number') return String(column.default);
    if (column.default instanceof Date) {
      return this.encoder.escapeDate(column.default);
    }
    return this.encoder.escape(String(column.default));
  }

  private constraint(constraint: MigrationConstraint): string {
    const name = constraint.name
      ? `constraint ${this.id(constraint.name)} `
      : '';
    const columns = constraint.columns.map(column => this.id(column)).join(', ');
    if (constraint.primaryKey) {
      return `${name}primary key (${columns})`;
    }
    if (constraint.unique) {
      return `${name}unique (${columns})`;
    }
    if (constraint.references) {
      let sql =
        `${name}foreign key (${columns}) references ` +
        `${this.id(constraint.references.table)} (` +
        constraint.references.columns.map(column => this.id(column)).join(', ') +
        ')';
      if (constraint.onDelete) sql += ` on delete ${constraint.onDelete}`;
      if (constraint.onUpdate) sql += ` on update ${constraint.onUpdate}`;
      return sql;
    }
    throw Error(`Unsupported constraint: ${JSON.stringify(constraint)}`);
  }

  private createIndex(table: string, index: MigrationIndex): string {
    const unique = index.unique ? 'unique ' : '';
    const columns = index.columns.map(column => this.id(column)).join(', ');
    if (index.where && this.dialect === 'mysql') {
      throw Error(
        `${table}.${index.name}: MySQL does not support partial indexes`
      );
    }
    const where = index.where ? ` where ${index.where}` : '';
    return (
      `create ${unique}index ${this.id(index.name)} on ` +
      `${this.id(table)} (${columns})${where}`
    );
  }

  private dropConstraint(
    table: string,
    name: string,
    definition?: MigrationConstraint
  ): string {
    const prefix = `alter table ${this.id(table)} `;
    if (this.dialect === 'mysql' && definition) {
      if (definition.references) {
        return `${prefix}drop foreign key ${this.id(name)}`;
      }
      if (definition.unique) {
        return `${prefix}drop index ${this.id(name)}`;
      }
      if (definition.primaryKey) {
        return `${prefix}drop primary key`;
      }
    }
    return `${prefix}drop constraint ${this.id(name)}`;
  }

  private dropIndex(table: string, index: string): string {
    if (this.dialect === 'mysql') {
      return `drop index ${this.id(index)} on ${this.id(table)}`;
    }
    return `drop index ${this.id(index)}`;
  }

  private id(name: string): string {
    return this.encoder.escapeId(name);
  }
}

export class MigrationRunner {
  readonly compiler: MigrationCompiler;

  constructor(
    private readonly db: Database,
    private readonly tableName = '_sqlex_migrations'
  ) {
    this.compiler = new MigrationCompiler(db.pool.dialect, db.pool);
  }

  plan(migrations: readonly Migration[], options: MigrateOptions = {}): string[] {
    this.assertMigrationList(migrations);
    const targetIndex = options.target
      ? migrations.findIndex(item => item.id === options.target)
      : -1;
    if (options.target && targetIndex < 0) {
      throw Error(`Unknown migration target: ${options.target}`);
    }
    const selected = options.target
      ? migrations.slice(0, targetIndex + 1)
      : migrations;
    return selected.flatMap(item =>
      item.up.flatMap(operation => this.compiler.compile(operation))
    );
  }

  async status(migrations: readonly Migration[]): Promise<MigrationStatus[]> {
    this.assertMigrationList(migrations);
    const connection = await this.db.pool.getConnection();
    try {
      await this.ensureTable(connection);
      const applied = await this.applied(connection);
      return migrations.map(migration => {
        const entry = applied.get(migration.id);
        return {
          id: migration.id,
          applied: Boolean(entry),
          checksum: migrationChecksum(migration),
          appliedAt: entry?.appliedAt,
          valid: entry
            ? entry.checksum === migrationChecksum(migration)
            : undefined,
        };
      });
    } finally {
      await connection.release();
    }
  }

  async up(
    migrations: readonly Migration[],
    options: MigrateOptions = {}
  ): Promise<MigrationResult> {
    this.assertMigrationList(migrations);
    const targetIndex = options.target
      ? migrations.findIndex(item => item.id === options.target)
      : migrations.length - 1;
    if (options.target && targetIndex < 0) {
      throw Error(`Unknown migration target: ${options.target}`);
    }
    if (options.dryRun) {
      const connection = await this.db.pool.getConnection();
      try {
        const applied = await this.appliedIfPresent(connection);
        this.assertAppliedMigrations(migrations, applied);
        const sql = migrations
          .slice(0, targetIndex + 1)
          .filter(migration => !applied.has(migration.id))
          .flatMap(migration =>
            migration.up.flatMap(operation => this.compiler.compile(operation))
          );
        return { applied: [], sql };
      } finally {
        await connection.release();
      }
    }
    const connection = await this.db.pool.getConnection();
    const sql: string[] = [];
    const appliedIds: string[] = [];
    let locked = false;
    try {
      await this.acquireLock(connection);
      locked = true;
      await this.ensureTable(connection);
      const applied = await this.applied(connection);
      this.assertAppliedMigrations(migrations, applied);

      for (const migration of migrations) {
        const existing = applied.get(migration.id);
        const checksum = migrationChecksum(migration);
        if (existing) {
          continue;
        }
        if (
          options.target &&
          migrations.findIndex(item => item.id === migration.id) >
            migrations.findIndex(item => item.id === options.target)
        ) {
          break;
        }
        const statements = migration.up.flatMap(operation =>
          this.compiler.compile(operation)
        );
        sql.push(...statements);
        await connection.transaction(async () => {
          for (const statement of statements) {
            await connection._query(statement);
          }
          await this.recordApplied(connection, migration.id, checksum);
        });
        appliedIds.push(migration.id);
      }
      return { applied: appliedIds, sql };
    } finally {
      await this.releaseConnection(connection, locked);
    }
  }

  async down(
    migrations: readonly Migration[],
    count = 1,
    options: Pick<MigrateOptions, 'dryRun'> = {}
  ): Promise<MigrationResult> {
    this.assertMigrationList(migrations);
    if (!Number.isInteger(count) || count < 1) {
      throw Error(`Invalid migration count: ${count}`);
    }
    if (options.dryRun) {
      const connection = await this.db.pool.getConnection();
      try {
        const applied = await this.appliedIfPresent(connection);
        this.assertAppliedMigrations(migrations, applied);
        const selected = [...migrations]
          .filter(migration => applied.has(migration.id))
          .reverse()
          .slice(0, count);
        return {
          applied: [],
          sql: selected.flatMap(migration =>
            migration.down.flatMap(operation => this.compiler.compile(operation))
          ),
        };
      } finally {
        await connection.release();
      }
    }
    const connection = await this.db.pool.getConnection();
    const sql: string[] = [];
    const reverted: string[] = [];
    let locked = false;
    try {
      await this.acquireLock(connection);
      locked = true;
      await this.ensureTable(connection);
      const applied = await this.applied(connection);
      this.assertAppliedMigrations(migrations, applied);
      const selected = [...migrations]
        .filter(migration => applied.has(migration.id))
        .reverse()
        .slice(0, count);

      for (const migration of selected) {
        const statements = migration.down.flatMap(operation =>
          this.compiler.compile(operation)
        );
        sql.push(...statements);
        await connection.transaction(async () => {
          for (const statement of statements) {
            await connection._query(statement);
          }
          await connection._query(
            `delete from ${this.id(this.tableName)} where id=` +
            connection.escape(migration.id)
          );
        });
        reverted.push(migration.id);
      }
      return { applied: reverted, sql };
    } finally {
      await this.releaseConnection(connection, locked);
    }
  }

  async baseline(
    migrations: readonly Migration[],
    options: BaselineOptions = {}
  ): Promise<MigrationResult> {
    this.assertMigrationList(migrations);
    if (migrations.length === 0) return { applied: [], sql: [] };
    const targetIndex = options.target
      ? migrations.findIndex(item => item.id === options.target)
      : migrations.length - 1;
    if (targetIndex < 0) {
      throw Error(`Unknown migration target: ${options.target}`);
    }
    const selected = migrations.slice(0, targetIndex + 1);
    const target = selected[selected.length - 1];
    if (!target) return { applied: [], sql: [] };

    const connection = await this.db.pool.getConnection();
    let locked = false;
    try {
      await this.acquireLock(connection);
      locked = true;
      await this.ensureTable(connection);
      const applied = await this.applied(connection);
      this.assertAppliedMigrations(migrations, applied);
      if (!options.force) {
        // Manual migrations may not carry a snapshot; verify against the
        // latest one available, as documented.
        const snapshot = [...selected]
          .reverse()
          .find(migration => migration.schema)?.schema;
        if (!snapshot) {
          throw Error(
            `no schema snapshot found up to ${target.id}; ` +
            'use baseline --force to override'
          );
        }
        const live = await getInformationSchema(
          connection,
          this.db.name,
          snapshot.name || undefined
        );
        assertSchemaCompatible(live, snapshot, connection.dialect);
      }

      const recorded: string[] = [];
      await connection.transaction(async () => {
        for (const migration of selected) {
          if (applied.has(migration.id)) continue;
          await this.recordApplied(
            connection,
            migration.id,
            migrationChecksum(migration)
          );
          recorded.push(migration.id);
        }
      });
      return { applied: recorded, sql: [] };
    } finally {
      await this.releaseConnection(connection, locked);
    }
  }

  /**
   * Bring the live database up to the record declarations. Missing tables,
   * columns, constraints, and indexes are created; with `destructive`,
   * changed columns are altered and undeclared columns dropped. Anything
   * else is reported in one error before any DDL runs. Returns the SQL that
   * was (or, with `dryRun`, would be) executed.
   */
  async reconcile(
    classes: RecordClassMap,
    options: ReconcileOptions = {}
  ): Promise<string[]> {
    const expected = migrationSchemaFromRecords(classes);
    const schemaName = expected.name || undefined;
    const connection = await this.db.pool.getConnection();
    let locked = false;
    try {
      if (!options.dryRun) {
        await this.acquireLock(connection);
        locked = true;
      }
      const live = await getInformationSchema(
        connection,
        this.db.name,
        schemaName
      );
      const indexes = await getLiveIndexes(connection, this.db.name, schemaName);
      const checks = await getLiveChecks(connection, this.db.name, schemaName);
      const sql = reconcileOperations(
        live,
        indexes,
        checks,
        expected,
        connection.dialect,
        Boolean(options.destructive)
      ).flatMap(operation => this.compiler.compile(operation));
      if (!options.dryRun && sql.length) {
        await connection.transaction(async () => {
          for (const statement of sql) {
            await connection._query(statement);
          }
        });
      }
      return sql;
    } finally {
      await this.releaseConnection(connection, locked);
    }
  }

  private async ensureTable(connection: Connection): Promise<void> {
    const timestamp = connection.dialect === 'sqlite3'
      ? 'text'
      : 'timestamp';
    await connection._query(
      `create table if not exists ${this.id(this.tableName)} (` +
      'id varchar(255) primary key, ' +
      'checksum varchar(64) not null, ' +
      `applied_at ${timestamp} not null)`
    );
  }

  // Like applied(), but returns an empty map when the ledger table does not
  // exist yet, so read-only paths (dry runs) never create it.
  private async appliedIfPresent(
    connection: Connection
  ): Promise<Map<string, { checksum: string; appliedAt: string }>> {
    try {
      return await this.applied(connection);
    } catch (error) {
      if (this.isMissingLedgerError(error, connection.dialect)) {
        return new Map();
      }
      throw error;
    }
  }

  private isMissingLedgerError(error: unknown, dialect: Dialect): boolean {
    const value = error as { code?: unknown; message?: unknown } | null;
    const code = typeof value?.code === 'string' ? value.code : '';
    const message = typeof value?.message === 'string' ? value.message : '';
    if (dialect === 'postgres') return code === '42P01';
    if (dialect === 'mysql') return code === 'ER_NO_SUCH_TABLE';
    return (
      dialect === 'sqlite3' &&
      code === 'SQLITE_ERROR' &&
      /no such table/i.test(message) &&
      message.includes(this.tableName)
    );
  }

  private assertAppliedMigrations(
    migrations: readonly Migration[],
    applied: Map<string, { checksum: string; appliedAt: string }>
  ): void {
    const known = new Set(migrations.map(migration => migration.id));
    for (const id of applied.keys()) {
      if (!known.has(id)) {
        throw Error(`Applied migration is missing: ${id}`);
      }
    }
    for (const migration of migrations) {
      const entry = applied.get(migration.id);
      if (entry && entry.checksum !== migrationChecksum(migration)) {
        throw Error(`Applied migration changed: ${migration.id}`);
      }
    }
  }

  private assertMigrationList(migrations: readonly Migration[]): void {
    const seen = new Set<string>();
    for (const migration of migrations) {
      if (seen.has(migration.id)) {
        throw Error(`Duplicate migration id: ${migration.id}`);
      }
      seen.add(migration.id);
    }
  }

  private async applied(
    connection: Connection
  ): Promise<Map<string, { checksum: string; appliedAt: string }>> {
    const rows = await connection._query(
      `select id, checksum, applied_at from ${this.id(this.tableName)} ` +
      'order by id'
    );
    return new Map(
      (rows || []).map((row: {
        id: string;
        checksum: string;
        applied_at: string | Date;
      }) => [
        row.id,
        {
          checksum: row.checksum,
          appliedAt: row.applied_at instanceof Date
            ? row.applied_at.toISOString()
            : String(row.applied_at),
        },
      ])
    );
  }

  private recordApplied(
    connection: Connection,
    id: string,
    checksum: string
  ): Promise<unknown> {
    const now = connection.escapeDate(new Date());
    return connection._query(
      `insert into ${this.id(this.tableName)} ` +
      '(id, checksum, applied_at) values (' +
      `${connection.escape(id)}, ${connection.escape(checksum)}, ${now})`
    );
  }

  private async acquireLock(connection: Connection): Promise<void> {
    if (connection.dialect === 'postgres') {
      await connection._query(
        "select pg_advisory_lock(hashtext('sqlex:migrations'))"
      );
    } else if (connection.dialect === 'mysql') {
      // get_lock returns 0 on timeout and null on error instead of raising.
      const rows = (await connection._query(
        "select get_lock('sqlex:migrations', 30) as acquired"
      )) as Array<{ acquired?: unknown }> | undefined;
      if (Number(rows?.[0]?.acquired) !== 1) {
        throw Error('Timed out acquiring the migration lock');
      }
    }
  }

  private async releaseLock(connection: Connection): Promise<void> {
    if (connection.dialect === 'postgres') {
      await connection._query(
        "select pg_advisory_unlock(hashtext('sqlex:migrations'))"
      );
    } else if (connection.dialect === 'mysql') {
      await connection._query(
        "select release_lock('sqlex:migrations')"
      );
    }
  }

  private async releaseConnection(
    connection: Connection,
    locked: boolean
  ): Promise<void> {
    try {
      if (locked) await this.releaseLock(connection);
    } finally {
      await connection.release();
    }
  }

  private id(name: string): string {
    return this.db.pool.escapeId(name);
  }
}

export function migrationChecksum(migration: Migration): string {
  return createHash('sha256')
    .update(stableStringify({
      id: migration.id,
      up: migration.up,
      down: migration.down,
      schema: migration.schema,
    }))
    .digest('hex');
}

function diffConstraints(
  previous: MigrationTable,
  next: MigrationTable,
  operations: MigrationOperation[],
  warnings: string[],
  blockedColumns: ReadonlySet<string>
): void {
  const oldItems = new Map(
    previous.constraints.map(item => [constraintKey(item), item])
  );
  const newItems = new Map(
    next.constraints.map(item => [constraintKey(item), item])
  );
  for (const [key, constraint] of newItems) {
    if (
      !oldItems.has(key) &&
      !constraint.columns.some(column => blockedColumns.has(column))
    ) {
      operations.push(operation.addConstraint(next.name, constraint));
    }
  }
  for (const [key, constraint] of oldItems) {
    if (!newItems.has(key)) {
      warnings.push(
        `${next.name} constraint ${requiredConstraintName(constraint)} was removed; ` +
        'destructive changes are not generated'
      );
    }
  }
}

function diffIndexes(
  previous: MigrationTable,
  next: MigrationTable,
  operations: MigrationOperation[],
  warnings: string[],
  blockedColumns: ReadonlySet<string>
): void {
  const oldItems = new Map(previous.indexes.map(item => [item.name, item]));
  const newItems = new Map(next.indexes.map(item => [item.name, item]));
  for (const [name, index] of newItems) {
    if (!oldItems.has(name)) {
      if (!index.columns.some(column => blockedColumns.has(column))) {
        operations.push(operation.createIndex(next.name, index));
      }
    } else if (!sameSchemaValue(oldItems.get(name), index)) {
      warnings.push(
        `${next.name} index ${name} changed; add explicit drop/create operations`
      );
    }
  }
  for (const name of oldItems.keys()) {
    if (!newItems.has(name)) {
      warnings.push(
        `${next.name} index ${name} was removed; destructive changes are not generated`
      );
    }
  }
}

function diffChecks(
  previous: MigrationTable,
  next: MigrationTable,
  operations: MigrationOperation[],
  warnings: string[]
): void {
  const oldItems = new Map(
    (previous.checks || []).map(item => [item.name, item])
  );
  const newItems = new Map((next.checks || []).map(item => [item.name, item]));
  for (const [name, check] of newItems) {
    const old = oldItems.get(name);
    if (!old) {
      operations.push(operation.addCheck(next.name, check));
    } else if (old.expression !== check.expression) {
      warnings.push(
        `${next.name} check ${name} changed; add explicit drop/create operations`
      );
    }
  }
  for (const name of oldItems.keys()) {
    if (!newItems.has(name)) {
      warnings.push(
        `${next.name} check ${name} was removed; destructive changes are not generated`
      );
    }
  }
}

interface DeferredConstraint {
  table: string;
  constraint: MigrationConstraint;
}

/**
 * Operations that create every table in dependency order. A foreign key that
 * closes a cycle is left out of its table and added once all tables exist.
 */
function createTableOperations(tables: MigrationTable[]): MigrationOperation[] {
  const pending = new Map(tables.map(table => [table.name, table]));
  const operations: MigrationOperation[] = [];
  const deferred: DeferredConstraint[] = [];
  const blocks = (table: MigrationTable, constraint: MigrationConstraint) =>
    Boolean(constraint.references) &&
    constraint.references!.table !== table.name &&
    pending.has(constraint.references!.table);
  while (pending.size) {
    let next = [...pending.values()].find(table =>
      !table.constraints.some(constraint => blocks(table, constraint))
    );
    if (!next) {
      const [first] = pending.values();
      for (const constraint of first.constraints) {
        if (blocks(first, constraint)) deferred.push({ table: first.name, constraint });
      }
      next = {
        ...first,
        constraints: first.constraints.filter(constraint => !blocks(first, constraint)),
      };
    }
    operations.push(operation.createTable(next));
    for (const index of next.indexes) {
      operations.push(operation.createIndex(next.name, index));
    }
    pending.delete(next.name);
  }
  for (const { table, constraint } of deferred) {
    operations.push(operation.addConstraint(table, constraint));
  }
  return operations;
}

function constraintKey(constraint: MigrationConstraint): string {
  return stableStringify({
    columns: constraint.columns,
    primaryKey: constraint.primaryKey,
    unique: constraint.unique,
    references: constraint.references,
    onDelete: constraint.onDelete,
    onUpdate: constraint.onUpdate,
  });
}

function requiredConstraintName(constraint: Constraint): string {
  if (!constraint.name) {
    throw Error(`Constraint has no name: ${JSON.stringify(constraint)}`);
  }
  return constraint.name;
}

function stableStringify(value: unknown): string {
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) =>
      `${JSON.stringify(key)}:${stableStringify(item)}`
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameSchemaValue(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}


function stringOption(
  field: AnyFieldDefinition,
  name: 'onDelete' | 'onUpdate'
): string | undefined {
  const value = (field.options as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : undefined;
}

function assertSchemaCompatible(
  live: DatabaseDefinition,
  expected: MigrationSchema,
  dialect: Dialect
): void {
  const liveTables = new Map(live.tables.map(table => [table.name, table]));
  const differences: string[] = [];

  for (const table of expected.tables) {
    const actual = liveTables.get(table.name);
    if (!actual) {
      differences.push(`missing table ${table.name}`);
      continue;
    }
    const actualColumns = new Map(
      actual.columns.map(column => [column.name, column])
    );
    for (const column of table.columns) {
      const actualColumn = actualColumns.get(column.name);
      if (!actualColumn) {
        differences.push(`missing column ${table.name}.${column.name}`);
        continue;
      }
      const difference = columnDifference(
        actualColumn,
        column,
        table.name,
        dialect
      );
      if (difference) differences.push(difference);
    }
    for (const constraint of table.constraints) {
      const found = actual.constraints.some(candidate =>
        sameConstraintShape(candidate, constraint)
      );
      if (!found) {
        differences.push(
          `missing constraint ${table.name}.${constraint.name || constraintKey(constraint)}`
        );
      }
    }
  }
  if (differences.length) {
    throw Error(
      'Database does not match the migration snapshot:\n' +
      differences.map(item => `- ${item}`).join('\n')
    );
  }
}

function reconcileOperations(
  live: DatabaseDefinition,
  liveIndexes: ReadonlyMap<string, LiveIndex>,
  liveChecks: ReadonlyMap<string, readonly LiveCheck[]>,
  expected: MigrationSchema,
  dialect: Dialect,
  destructive: boolean
): MigrationOperation[] {
  const liveTables = new Map(live.tables.map(table => [table.name, table]));
  const problems: string[] = [];
  const created: MigrationOperation[] = [];
  // Stale constraints go before column changes so a dropped column is not
  // still referenced; new constraints and indexes go after so their columns
  // exist. Foreign keys are dropped before other constraints because they
  // depend on the unique keys being removed.
  const droppedForeign: MigrationOperation[] = [];
  const dropped: MigrationOperation[] = [];
  const changed: MigrationOperation[] = [];
  const added: MigrationOperation[] = [];

  const newTables = expected.tables.filter(
    table => !liveTables.has(table.name)
  );
  created.push(...createTableOperations(newTables));

  for (const table of expected.tables) {
    const actual = liveTables.get(table.name);
    if (!actual) continue;
    const actualColumns = new Map(
      actual.columns.map(column => [column.name, column])
    );
    const declared = new Set(table.columns.map(column => column.name));

    for (const column of table.columns) {
      const actualColumn = actualColumns.get(column.name);
      if (!actualColumn) {
        if (column.nullable === true || hasUsableColumnDefault(column)) {
          changed.push(operation.addColumn(table.name, column));
        } else {
          problems.push(
            `missing column ${table.name}.${column.name} is required ` +
            'and has no default'
          );
        }
        continue;
      }
      const difference = columnDifference(
        actualColumn,
        column,
        table.name,
        dialect
      );
      if (!difference) continue;
      // PostgreSQL cannot attach or detach a sequence through alterColumn.
      const generationChanged = dialect === 'postgres' &&
        Boolean(actualColumn.autoIncrement) !== Boolean(column.autoIncrement);
      if (destructive && !generationChanged) {
        changed.push(operation.alterColumn(table.name, column));
      } else {
        problems.push(difference);
      }
    }
    for (const column of actual.columns) {
      if (declared.has(column.name)) continue;
      if (destructive) {
        changed.push(operation.dropColumn(table.name, column.name));
      } else {
        problems.push(`column ${table.name}.${column.name} is not declared`);
      }
    }

    for (const constraint of actual.constraints) {
      const isDeclared =
        table.constraints.some(item => sameConstraintShape(constraint, item)) ||
        // MySQL and SQLite report unique indexes as constraints.
        (Boolean(constraint.unique) && table.indexes.some(index =>
          index.unique && sameSchemaValue(index.columns, constraint.columns)
        )) ||
        // A unique index whose definition drifted is still declared by name;
        // the index comparison below reports or rebuilds it, so it must not
        // also be dropped as an undeclared constraint.
        (Boolean(constraint.unique) && constraint.name !== undefined &&
          table.indexes.some(index => index.name === constraint.name));
      if (isDeclared) continue;
      if (destructive && constraint.name && dialect !== 'sqlite3') {
        const drop = operation.dropConstraint(table.name, constraint);
        if (constraint.references) {
          droppedForeign.push(drop);
        } else {
          dropped.push(drop);
        }
      } else {
        problems.push(
          `constraint ${table.name}.` +
          `${constraint.name || constraintKey(constraint)} is not declared`
        );
      }
    }
    for (const constraint of table.constraints) {
      const found = actual.constraints.some(candidate =>
        sameConstraintShape(candidate, constraint)
      );
      if (!found) {
        added.push(operation.addConstraint(table.name, constraint));
      }
    }
    for (const index of table.indexes) {
      const actualIndex = liveIndexes.get(`${table.name}.${index.name}`);
      if (!actualIndex) {
        added.push(operation.createIndex(table.name, index));
        continue;
      }
      const difference = indexDifference(actualIndex, index, table.name);
      if (!difference) continue;
      if (destructive) {
        dropped.push(operation.dropIndex(table.name, index.name));
        added.push(operation.createIndex(table.name, index));
      } else {
        problems.push(difference);
      }
    }

    if (supportsChecks(dialect)) {
      const actualChecks = liveChecks.get(table.name) || [];
      const declaredChecks = table.checks || [];
      const declaredNames = new Set(declaredChecks.map(check => check.name));
      for (const check of declaredChecks) {
        if (!actualChecks.some(item => item.name === check.name)) {
          added.push(operation.addCheck(table.name, check));
        }
      }
      // The inline check standing in for an enum column is named by the
      // engine after the column and belongs to it, not to the declarations.
      const implicit = implicitEnumCheckNames(table);
      for (const check of actualChecks) {
        if (declaredNames.has(check.name) || implicit.has(check.name)) continue;
        if (destructive) {
          dropped.push(operation.dropCheck(table.name, check.name));
        } else {
          problems.push(
            `check constraint ${table.name}.${check.name} is not declared`
          );
        }
      }
    }
  }

  if (problems.length) {
    throw Error(
      'Schema cannot be reconciled automatically:\n' +
      problems.map(item => `- ${item}`).join('\n')
    );
  }
  return [
    ...created,
    ...droppedForeign,
    ...dropped,
    ...changed,
    ...orderAdditive(added),
  ];
}

/**
 * Order additive operations so every dependency exists first: plain changes,
 * then indexes (a foreign key may reference a unique index), then other
 * constraints, then cross-table foreign keys last (their backing key may be
 * an index or unique constraint added anywhere in this batch). Relative
 * order within each group is preserved.
 */
function orderAdditive(operations: MigrationOperation[]): MigrationOperation[] {
  const rest: MigrationOperation[] = [];
  const indexes: MigrationOperation[] = [];
  const constraints: MigrationOperation[] = [];
  const foreign: MigrationOperation[] = [];
  for (const item of operations) {
    if (item.kind === 'createIndex') {
      indexes.push(item);
    } else if (
      item.kind === 'addConstraint' &&
      item.constraint.references &&
      item.constraint.references.table !== item.table
    ) {
      foreign.push(item);
    } else if (item.kind === 'addConstraint' || item.kind === 'addCheck') {
      constraints.push(item);
    } else {
      rest.push(item);
    }
  }
  return [...rest, ...indexes, ...constraints, ...foreign];
}

interface LiveIndex {
  /** Index key columns in order; empty when the dialect does not report them. */
  columns: string[];
  unique?: boolean;
  /** Whether the index has a predicate; undefined when not introspected. */
  partial?: boolean;
}

// Every live index as `table.index`, including those backing unique and
// primary key constraints. SQLite and unknown dialects report names only,
// so callers fall back to existence checks when columns are empty.
async function getLiveIndexes(
  connection: Connection,
  catalogName: string,
  schemaName?: string
): Promise<Map<string, LiveIndex>> {
  const indexes = new Map<string, LiveIndex>();
  const add = (
    table: string,
    name: string,
    column: string | null,
    flags?: { unique?: boolean; partial?: boolean }
  ) => {
    const key = `${table}.${name}`;
    let index = indexes.get(key);
    if (!index) {
      index = { columns: [], ...flags };
      indexes.set(key, index);
    }
    if (column) index.columns.push(column);
  };
  if (connection.dialect === 'postgres') {
    const rows = await queryInformationSchema<{
      table_name: string;
      index_name: string;
      column_name: string | null;
      is_unique: boolean;
      is_partial: boolean;
    }>(
      connection,
      'select c.relname as table_name, i.relname as index_name, ' +
        'a.attname as column_name, ix.indisunique as is_unique, ' +
        '(ix.indpred is not null) as is_partial ' +
        'from pg_index ix ' +
        'join pg_class i on i.oid = ix.indexrelid ' +
        'join pg_class c on c.oid = ix.indrelid ' +
        'join pg_namespace n on n.oid = c.relnamespace ' +
        'cross join generate_series(0, ix.indnatts - 1) as k(n) ' +
        'left join pg_attribute a ' +
        'on a.attrelid = ix.indrelid and a.attnum = ix.indkey[k.n] ' +
        'where n.nspname = ' +
        connection.escape(schemaName || 'public') +
        ' order by c.relname, i.relname, k.n'
    );
    for (const row of rows) {
      add(row.table_name, row.index_name, row.column_name, {
        unique: row.is_unique,
        partial: row.is_partial,
      });
    }
    return indexes;
  }
  if (connection.dialect === 'mysql') {
    const rows = await queryInformationSchema<{
      table_name: string;
      index_name: string;
      column_name: string;
      non_unique: number;
    }>(
      connection,
      'select table_name as table_name, index_name as index_name, ' +
        'column_name as column_name, non_unique as non_unique ' +
        'from information_schema.statistics ' +
        `where table_schema = ${connection.escape(catalogName)} ` +
        'order by table_name, index_name, seq_in_index'
    );
    for (const row of rows) {
      add(row.table_name, row.index_name, row.column_name, {
        unique: !Number(row.non_unique),
      });
    }
    return indexes;
  }
  if (connection.dialect === 'sqlite3') {
    const names = await queryInformationSchema<{
      table_name: string;
      index_name: string;
    }>(
      connection,
      'select tbl_name as table_name, name as index_name ' +
        "from sqlite_master where type = 'index'"
    );
    const flags = new Map<string, { unique: boolean; partial: boolean }>();
    const listed = new Set<string>();
    for (const entry of names) {
      if (!listed.has(entry.table_name)) {
        listed.add(entry.table_name);
        const list = await queryInformationSchema<{
          name: string;
          is_unique: number;
          is_partial: number;
        }>(
          connection,
          'select name, "unique" as is_unique, "partial" as is_partial ' +
            `from pragma_index_list(${connection.escape(entry.table_name)})`
        );
        for (const item of list) {
          flags.set(`${entry.table_name}.${item.name}`, {
            unique: Boolean(item.is_unique),
            partial: Boolean(item.is_partial),
          });
        }
      }
      const columns = await queryInformationSchema<{ name: string | null }>(
        connection,
        `select * from pragma_index_info(${connection.escape(entry.index_name)})`
      );
      indexes.set(`${entry.table_name}.${entry.index_name}`, {
        columns: columns
          .map(column => column.name)
          .filter((name): name is string => name != null),
        ...flags.get(`${entry.table_name}.${entry.index_name}`),
      });
    }
    return indexes;
  }
  const rows = await queryInformationSchema<{
    table_name: string;
    index_name: string;
  }>(
    connection,
    'select tbl_name as table_name, name as index_name ' +
      "from sqlite_master where type = 'index'"
  );
  for (const row of rows) add(row.table_name, row.index_name, null);
  return indexes;
}

interface LiveCheck {
  name: string;
  expression: string;
}

// Live table-level check constraints as `table => checks`. Expressions are
// dialect-normalised (postgres rewrites them), so callers match by name.
// SQLite keeps checks in the table DDL only and cannot alter them in place,
// so it reports none and callers skip the comparison entirely.
async function getLiveChecks(
  connection: Connection,
  catalogName: string,
  schemaName?: string
): Promise<Map<string, LiveCheck[]>> {
  const checks = new Map<string, LiveCheck[]>();
  if (connection.dialect !== 'postgres' && connection.dialect !== 'mysql') {
    return checks;
  }
  const rows = connection.dialect === 'postgres'
    ? await queryInformationSchema<{
        table_name: string;
        constraint_name: string;
        definition: string;
      }>(
        connection,
        'select c.relname as table_name, con.conname as constraint_name, ' +
          'pg_get_constraintdef(con.oid) as definition ' +
          'from pg_constraint con ' +
          'join pg_class c on c.oid = con.conrelid ' +
          'join pg_namespace n on n.oid = c.relnamespace ' +
          "where con.contype = 'c' and n.nspname = " +
          connection.escape(schemaName || 'public')
      )
    : await queryInformationSchema<{
        table_name: string;
        constraint_name: string;
        definition: string;
      }>(
        connection,
        'select tc.table_name as table_name, ' +
          'cc.constraint_name as constraint_name, ' +
          'cc.check_clause as definition ' +
          'from information_schema.check_constraints cc ' +
          'join information_schema.table_constraints tc ' +
          'on tc.constraint_name = cc.constraint_name ' +
          'and tc.constraint_schema = cc.constraint_schema ' +
          "and tc.constraint_type = 'CHECK' " +
          'where cc.constraint_schema = ' +
          connection.escape(catalogName)
      );
  for (const row of rows) {
    const table = checks.get(row.table_name) || [];
    table.push({ name: row.constraint_name, expression: row.definition });
    checks.set(row.table_name, table);
  }
  return checks;
}

function columnDifference(
  actual: Column,
  expected: Column,
  table: string,
  dialect: Dialect
): string | undefined {
  const label = `column ${table}.${expected.name}`;
  // A native PostgreSQL enum introspects as varchar with its type attached.
  const actualType =
    actual.userDefinedType?.type === 'enum' ? 'enum' : actual.type;
  if (
    normalizeColumnType(actualType, dialect) !==
    normalizeColumnType(expected.type, dialect)
  ) {
    return `${label} has type ${actual.type}, expected ${expected.type}`;
  }
  const actualValues = actual.userDefinedType?.values;
  const expectedValues = expected.userDefinedType?.values;
  if (
    actualValues && expectedValues &&
    !sameSchemaValue(actualValues, expectedValues)
  ) {
    return `${label} has values ${JSON.stringify(actualValues)}, ` +
      `expected ${JSON.stringify(expectedValues)}`;
  }
  if (Boolean(actual.nullable) !== Boolean(expected.nullable)) {
    return `${label} is ${actual.nullable ? 'nullable' : 'required'}, ` +
      `expected ${expected.nullable ? 'nullable' : 'required'}`;
  }
  if (Boolean(actual.autoIncrement) !== Boolean(expected.autoIncrement)) {
    return `${label} ${actual.autoIncrement ? 'is' : 'is not'} ` +
      'auto-incrementing, expected ' +
      (expected.autoIncrement ? 'auto-incrementing' : 'a supplied value');
  }
  if (!sameColumnDimensions(actual, expected, dialect)) {
    return `${label} has dimensions ${formatColumnDimensions(actual)}, ` +
      `expected ${formatColumnDimensions(expected)}`;
  }
  if (!sameColumnDefault(actual, expected)) {
    return `${label} has default ${formatDefault(actual.default)}, ` +
      `expected ${formatDefault(expected.defaultSql ?? expected.default)}`;
  }
  return undefined;
}

function normalizeColumnType(type: string, dialect: Dialect): string {
  const value = type.toLowerCase().replace(/\(.*/, '');
  if (dialect === 'sqlite3') {
    if (value === 'boolean') return 'integer';
    if (value === 'json' || value === 'jsonb' || value === 'uuid') return 'text';
  }
  // MySQL has one json type; a binary-json declaration lands on it.
  if (dialect === 'mysql' && value === 'jsonb') return 'json';
  if (dialect === 'mysql') {
    if (value === 'tinyint') return 'boolean';
    if (value === 'uuid') return 'char';
  }
  // Enum columns are stored as text (with a check constraint) outside mysql.
  if (value === 'enum' && dialect !== 'mysql') return 'text';
  if (/^(numeric|decimal)$/.test(value)) return 'decimal';
  if (/^(int|integer|serial)$/.test(value)) return 'integer';
  if (/^(bigint|bigserial)$/.test(value)) return 'bigint';
  if (/^(double precision|double|float|real)$/.test(value)) return 'float';
  if (/^(timestamp.*|datetime)$/.test(value)) return 'datetime';
  if (/^(character varying|varchar)$/.test(value)) return 'varchar';
  return value;
}

// SQLite stores check constraints only in the table DDL and cannot add or
// drop them in place, so reconcile leaves them to explicit rebuilds.
function supportsChecks(dialect: Dialect): boolean {
  return dialect === 'postgres' || dialect === 'mysql';
}

// The inline check backing a non-native enum column is auto-named by the
// engine after the column (`<table>_<column>_check`) and is emitted by the
// column DDL, not declared in `checks`; reconcile must not treat it as stale.
function implicitEnumCheckNames(table: MigrationTable): Set<string> {
  const names = new Set<string>();
  for (const column of table.columns) {
    if (
      column.type.toLowerCase() === 'enum' &&
      column.userDefinedType?.values.length
    ) {
      names.add(`${table.name}_${column.name}_check`);
    }
  }
  return names;
}

function indexDifference(
  actual: LiveIndex,
  expected: MigrationIndex,
  table: string
): string | undefined {
  const label = `index ${table}.${expected.name}`;
  // Empty columns mean the dialect reports index names only, so there is
  // nothing to compare beyond existence.
  if (
    actual.columns.length &&
    stableStringify(actual.columns) !== stableStringify(expected.columns)
  ) {
    return (
      `${label} covers ${actual.columns.join(', ')}, ` +
      `expected ${expected.columns.join(', ')}`
    );
  }
  if (
    actual.unique !== undefined &&
    Boolean(actual.unique) !== Boolean(expected.unique)
  ) {
    return (
      `${label} is ${actual.unique ? 'unique' : 'not unique'}, ` +
      `expected ${expected.unique ? 'unique' : 'not unique'}`
    );
  }
  // The predicate text is dialect-normalised, so only its presence is compared.
  if (
    actual.partial !== undefined &&
    Boolean(actual.partial) !== Boolean(expected.where)
  ) {
    return (
      `${label} is ${actual.partial ? 'partial' : 'not partial'}, ` +
      `expected ${expected.where ? 'partial' : 'not partial'}`
    );
  }
  return undefined;
}

function sameConstraintShape(
  left: Constraint,
  right: Constraint
): boolean {
  return (
    stableStringify(left.columns) === stableStringify(right.columns) &&
    Boolean(left.primaryKey) === Boolean(right.primaryKey) &&
    Boolean(left.unique) === Boolean(right.unique) &&
    (left.references?.table || '') === (right.references?.table || '') &&
    stableStringify(left.references?.columns || []) ===
      stableStringify(right.references?.columns || []) &&
    normalizeReferentialAction(left.onDelete) ===
      normalizeReferentialAction(right.onDelete) &&
    normalizeReferentialAction(left.onUpdate) ===
      normalizeReferentialAction(right.onUpdate)
  );
}

function sameColumnDefault(
  actual: Column,
  expected: Column
): boolean {
  if (expected.autoIncrement) return true;
  const wanted = expected.defaultSql ?? expected.default;
  const found = actual.default;
  if (wanted === undefined) return found === undefined || found === null;
  if (wanted === null) {
    return found === undefined || found === null ||
      normalizeSqlDefault(found) === 'null';
  }
  if (found === undefined || found === null) return false;
  if (expected.defaultSql !== undefined) {
    return normalizeSqlDefault(found) === normalizeSqlDefault(wanted);
  }
  const literal = unquoteSqlDefault(found);
  if (typeof wanted === 'boolean') {
    return wanted
      ? /^(true|1|b'1')$/i.test(literal)
      : /^(false|0|b'0')$/i.test(literal);
  }
  if (typeof wanted === 'number') return Number(literal) === wanted;
  if (wanted instanceof Date) {
    const parsed = new Date(literal);
    return !Number.isNaN(parsed.valueOf()) &&
      parsed.valueOf() === wanted.valueOf();
  }
  if (Array.isArray(wanted)) {
    const vector = /\[[^\]]*\]/.exec(String(found));
    if (!vector) return false;
    try {
      return stableStringify(JSON.parse(vector[0])) === stableStringify(wanted);
    } catch {
      return false;
    }
  }
  return literal === String(wanted);
}

function sameColumnDimensions(
  actual: Column,
  expected: Column,
  dialect: Dialect
): boolean {
  const type = normalizeColumnType(expected.type, dialect);
  if (type === 'vector') {
    return actual.dimensions === expected.dimensions;
  }
  if (type === 'varchar') {
    const expectedSize =
      dialect === 'mysql' && expected.type.toLowerCase() === 'uuid'
        ? 36
        : expected.size ?? 255;
    return actual.size === expectedSize;
  }
  if (type === 'decimal' && expected.precision !== undefined) {
    return (
      actual.precision === expected.precision &&
      (actual.scale ?? 0) === (expected.scale ?? 0)
    );
  }
  return true;
}

function formatColumnDimensions(column: Column): string {
  if (column.dimensions !== undefined) {
    return String(column.dimensions);
  }
  if (column.precision !== undefined) {
    return `${column.precision},${column.scale ?? 0}`;
  }
  return column.size === undefined ? 'unspecified' : String(column.size);
}

function normalizeSqlDefault(value: unknown): string {
  return unquoteSqlDefault(value)
    .toLowerCase()
    .replace(/\s+/g, '');
}

function unquoteSqlDefault(value: unknown): string {
  let text = String(value).trim();
  text = text.replace(/::[\w\s".\[\]]+$/i, '').trim();
  while (text.startsWith('(') && text.endsWith(')')) {
    text = text.slice(1, -1).trim();
  }
  const match = /^(?:e)?'(.*)'$/is.exec(text);
  return match ? match[1].replace(/''/g, "'") : text;
}

function formatDefault(value: unknown): string {
  return value === undefined ? 'none' : JSON.stringify(value);
}

function normalizeReferentialAction(value: string | undefined): string {
  const action = value?.trim().toLowerCase().replace(/\s+/g, ' ');
  return !action || action === 'no action' || action === 'restrict'
    ? 'restrict'
    : action;
}

function hasUsableColumnDefault(column: Column): boolean {
  if (column.default !== undefined && column.default !== null) return true;
  return column.defaultSql !== undefined &&
    normalizeSqlDefault(column.defaultSql) !== 'null';
}
