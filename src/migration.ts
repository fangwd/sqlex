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
import {
  type AnyFieldDefinition,
  type RecordClass,
  type RecordClassMap,
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
      const constraints = table.constraints.map(constraint => {
        if (!constraint.references) return constraint;
        const field = fields.find(([fieldName, definition]) =>
          getColumnName(fieldName, definition) === constraint.columns[0]
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
        const column = getColumnName(fieldName, definition);
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
        return getColumnName(fieldName, definition);
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

  const newTables = next.tables.filter(table => !previousTables.has(table.name));
  for (const table of sortTablesByReferences(newTables)) {
    operations.push(operation.createTable(table));
    for (const index of table.indexes) {
      operations.push(operation.createIndex(table.name, index));
    }
  }

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
        warnings.push(
          `${table.name}.${column.name} changed; add an explicit alter or raw SQL operation`
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
  }

  for (const table of previous?.tables || []) {
    if (!nextTables.has(table.name)) {
      warnings.push(
        `${table.name} was removed; destructive changes are not generated`
      );
    }
  }

  return { operations, warnings, schema: next };
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
      case 'addConstraint':
        return operation.dropConstraint(item.table, item.constraint);
      case 'createIndex':
        return operation.dropIndex(item.table, item.index.name);
      case 'renameColumn':
        return operation.renameColumn(item.table, item.to, item.from);
      case 'sql':
        throw Error('Raw SQL operations require an explicit down migration');
      default:
        throw Error(`${item.kind} cannot be automatically reversed`);
    }
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

function sortTablesByReferences(tables: MigrationTable[]): MigrationTable[] {
  const pending = new Map(tables.map(table => [table.name, table]));
  const result: MigrationTable[] = [];
  while (pending.size) {
    const ready = [...pending.values()].find(table =>
      table.constraints.every(constraint =>
        !constraint.references ||
        constraint.references.table === table.name ||
        !pending.has(constraint.references.table)
      )
    );
    if (!ready) {
      throw Error(
        'Cannot generate migration for cyclic foreign keys between new tables: ' +
        `${[...pending.keys()].join(', ')}; add those tables and constraints ` +
        'in an explicit migration'
      );
    }
    result.push(ready);
    pending.delete(ready.name);
  }
  return result;
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

function getColumnName(
  name: string,
  definition: AnyFieldDefinition
): string {
  return definition.options.column ||
    (definition.kind === 'foreignKey' ? `${name}_id` : name);
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
      } else if (
        normalizeColumnType(actualColumn.type, dialect) !==
        normalizeColumnType(column.type, dialect)
      ) {
        differences.push(
          `column ${table.name}.${column.name} has type ` +
          `${actualColumn.type}, expected ${column.type}`
        );
      } else if (
        Boolean(actualColumn.nullable) !== Boolean(column.nullable)
      ) {
        differences.push(
          `column ${table.name}.${column.name} is ` +
          `${actualColumn.nullable ? 'nullable' : 'required'}, expected ` +
          `${column.nullable ? 'nullable' : 'required'}`
        );
      } else if (
        Boolean(actualColumn.autoIncrement) !== Boolean(column.autoIncrement)
      ) {
        differences.push(
          `column ${table.name}.${column.name} ` +
          `${actualColumn.autoIncrement ? 'is' : 'is not'} auto-incrementing, ` +
          `expected ${column.autoIncrement ? 'auto-incrementing' : 'a supplied value'}`
        );
      } else if (!sameColumnDimensions(actualColumn, column, dialect)) {
        differences.push(
          `column ${table.name}.${column.name} has dimensions ` +
          `${formatColumnDimensions(actualColumn)}, expected ` +
          formatColumnDimensions(column)
        );
      } else if (!sameColumnDefault(actualColumn, column)) {
        differences.push(
          `column ${table.name}.${column.name} has default ` +
          `${formatDefault(actualColumn.default)}, expected ` +
          formatDefault(column.defaultSql ?? column.default)
        );
      }
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
