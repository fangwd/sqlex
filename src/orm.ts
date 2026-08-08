import type {
  Column,
  Constraint,
  Database as DatabaseDefinition,
  Document,
  FilterShape,
  SelectFields,
  Value,
  VectorValue,
} from './types';
import type { Database, OrderBy, SelectOptions, Table } from './database';
import { ForeignKeyField, RelatedField, Schema, SimpleField } from './schema';
import { FlushMethod, FlushState } from './flush';
import { Record as BaseRecord, runtimeOf } from './record';
import { validateVector } from './vector';

export interface SqlDefault {
  readonly sql: string;
}

export function sqlDefault(sql: string): SqlDefault {
  return Object.freeze({ sql });
}

export interface FieldOptions {
  column?: string;
  nullable?: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  generated?: boolean;
  default?: Value | SqlDefault;
  index?: boolean | string;
}

export interface StringFieldOptions extends FieldOptions {
  maxLength?: number;
}

export interface DecimalFieldOptions extends FieldOptions {
  precision?: number;
  scale?: number;
}

export interface VectorFieldOptions extends Omit<
  FieldOptions,
  'default' | 'primaryKey' | 'unique' | 'generated' | 'index'
> {
  /** Number of floating-point entries stored in the vector. */
  dimensions: number;
  default?: VectorValue | null | SqlDefault;
  /** Vector keys are not portable across the supported engines. */
  primaryKey?: never;
  unique?: never;
  generated?: never;
  index?: never;
}

export interface EnumFieldOptions<T extends string> extends FieldOptions {
  values: readonly T[];
  typeName?: string;
  default?: NoInfer<T> | SqlDefault;
}

type ScalarFieldOptions = FieldOptions & {
  maxLength?: number;
  precision?: number;
  scale?: number;
  values?: readonly string[];
  typeName?: string;
};

declare const fieldValue: unique symbol;

export interface ForeignKeyOptions extends FieldOptions {
  relatedName?: string;
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
}

export type ReferentialAction =
  | 'cascade'
  | 'restrict'
  | 'set null'
  | 'set default'
  | 'no action';

export type ScalarFieldKind =
  | 'integer'
  | 'bigint'
  | 'float'
  | 'decimal'
  | 'string'
  | 'text'
  | 'boolean'
  | 'date'
  | 'time'
  | 'datetime'
  | 'json'
  | 'vector'
  | 'uuid'
  | 'enum';

export interface ScalarFieldDefinition<
  T = unknown,
  TOptions extends ScalarFieldOptions = ScalarFieldOptions
> {
  readonly kind: ScalarFieldKind;
  readonly options: TOptions;
  readonly [fieldValue]?: T;
}

export interface ForeignKeyDefinition<
  TTarget extends RecordClass<any, any> = RecordClass<any, any>,
  TOptions extends ForeignKeyOptions = ForeignKeyOptions
> {
  readonly kind: 'foreignKey';
  readonly target: (() => TTarget) | string;
  readonly options: TOptions;
  readonly [fieldValue]?: InstanceType<TTarget>;
}

export type AnyFieldDefinition =
  | ScalarFieldDefinition<unknown, any>
  | ForeignKeyDefinition<RecordClass<any, any>, any>;

export type FieldDefinitions = Record<string, AnyFieldDefinition>;

function scalar<T, TOptions extends ScalarFieldOptions>(
  kind: ScalarFieldKind,
  options: TOptions
): ScalarFieldDefinition<T, TOptions> {
  return Object.freeze({ kind, options });
}

// Zero-argument calls need a non-generic overload: inside defineRecord the
// contextual AnyFieldDefinition would otherwise infer the options type
// parameter as its `any` and break create/update inference.
interface ScalarFieldFactory<T, TBase extends ScalarFieldOptions> {
  (): ScalarFieldDefinition<T, {}>;
  <const TOptions extends TBase>(options: TOptions): ScalarFieldDefinition<T, TOptions>;
}

function scalarFactory<T, TBase extends ScalarFieldOptions>(
  kind: ScalarFieldKind
): ScalarFieldFactory<T, TBase> {
  const factory = (options?: TBase) => scalar(kind, options || {});
  return factory as ScalarFieldFactory<T, TBase>;
}

interface IdFieldFactory {
  (): ScalarFieldDefinition<number, { primaryKey: true; generated: true }>;
  <const TOptions extends FieldOptions>(
    options: TOptions
  ): ScalarFieldDefinition<number, TOptions & { primaryKey: true; generated: true }>;
}

const idFactory = ((options?: FieldOptions) =>
  scalar('integer', {
    ...options,
    primaryKey: true,
    generated: true,
  })) as IdFieldFactory;

interface JsonFieldFactory {
  <T = unknown>(): ScalarFieldDefinition<T, {}>;
  <T = unknown, const TOptions extends FieldOptions = FieldOptions>(
    options: TOptions
  ): ScalarFieldDefinition<T, TOptions>;
}

const jsonFactory = ((options?: FieldOptions) =>
  scalar('json', options || {})) as JsonFieldFactory;

interface VectorFieldFactory {
  <const TOptions extends VectorFieldOptions>(
    options: TOptions
  ): ScalarFieldDefinition<number[], TOptions>;
}

const vectorFactory = ((options: VectorFieldOptions) => {
  if (!options || !Number.isInteger(options.dimensions) || options.dimensions < 1) {
    throw Error('vector dimensions must be a positive integer');
  }
  for (const option of ['primaryKey', 'unique', 'generated', 'index'] as const) {
    if (option in options) {
      throw Error(`vector fields do not support the ${option} option`);
    }
  }
  const defaultValue = options.default;
  if (
    defaultValue !== undefined &&
    defaultValue !== null &&
    !(typeof defaultValue === 'object' && 'sql' in defaultValue)
  ) {
    validateVector(defaultValue, options.dimensions);
  }
  return scalar('vector', options);
}) as VectorFieldFactory;

interface ForeignKeyFactory {
  <TTarget extends RecordClass<any, any>>(
    target: (() => TTarget) | string
  ): ForeignKeyDefinition<TTarget, {}>;
  <
    TTarget extends RecordClass<any, any>,
    const TOptions extends ForeignKeyOptions
  >(
    target: (() => TTarget) | string,
    options: TOptions
  ): ForeignKeyDefinition<TTarget, TOptions>;
}

const foreignKeyFactory = ((
  target: (() => RecordClass) | string,
  options?: ForeignKeyOptions
) => Object.freeze({
  kind: 'foreignKey',
  target,
  options: options || {},
})) as ForeignKeyFactory;

export const field = Object.freeze({
  id: idFactory,
  integer: scalarFactory<number, FieldOptions>('integer'),
  bigint: scalarFactory<number, FieldOptions>('bigint'),
  float: scalarFactory<number, FieldOptions>('float'),
  decimal: scalarFactory<number, DecimalFieldOptions>('decimal'),
  string: scalarFactory<string, StringFieldOptions>('string'),
  text: scalarFactory<string, FieldOptions>('text'),
  boolean: scalarFactory<boolean, FieldOptions>('boolean'),
  date: scalarFactory<Date, FieldOptions>('date'),
  time: scalarFactory<string, FieldOptions>('time'),
  datetime: scalarFactory<Date, FieldOptions>('datetime'),
  json: jsonFactory,
  vector: vectorFactory,
  uuid: scalarFactory<string, FieldOptions>('uuid'),
  enum: <const T extends string, const TOptions extends EnumFieldOptions<T>>(
    options: EnumFieldOptions<T> & TOptions
  ) => scalar<T, TOptions>('enum', options),
  foreignKey: foreignKeyFactory,
});

/**
 * A multi-column index. `where` makes it partial (PostgreSQL and SQLite).
 * Field names are plain strings so a record class stays assignable to
 * `RecordClass`; unknown names are rejected when the schema is built.
 */
export interface RecordIndexDefinition {
  fields: readonly string[];
  name?: string;
  unique?: boolean;
  where?: string;
}

/** A named table check constraint. The expression is emitted verbatim. */
export interface RecordCheckDefinition {
  name?: string;
  expression: string;
}

export interface RecordDefinition<
  TFields extends FieldDefinitions = FieldDefinitions
> {
  table: string;
  name?: string;
  fields: TFields;
  /**
   * Composite unique constraints, each a list of field names. Single-column
   * uniqueness is better expressed with the field's own `unique` option.
   */
  unique?: readonly (readonly string[])[];
  indexes?: readonly RecordIndexDefinition[];
  checks?: readonly RecordCheckDefinition[];
}

type FieldValue<TField extends AnyFieldDefinition> =
  TField extends ForeignKeyDefinition<infer TTarget, any>
    ? InstanceType<TTarget>
    : TField extends ScalarFieldDefinition<infer TValue, any>
      ? TValue
      : never;

type NullableFieldValue<TField extends AnyFieldDefinition> =
  TField['options'] extends { nullable: true }
    ? FieldValue<TField> | null
    : FieldValue<TField>;

export type InferRecordFields<TFields extends FieldDefinitions> = {
  -readonly [K in keyof TFields]: NullableFieldValue<TFields[K]>;
};

// When writing, a foreign key also accepts the referenced primary key value.
type CreateFieldValue<TField extends AnyFieldDefinition> =
  TField extends ForeignKeyDefinition<infer TTarget, any>
    ? InstanceType<TTarget> | number | string
    : TField extends ScalarFieldDefinition<infer TValue, any>
      ? TValue
      : never;

type NullableCreateFieldValue<TField extends AnyFieldDefinition> =
  TField['options'] extends { nullable: true }
    ? CreateFieldValue<TField> | null
    : CreateFieldValue<TField>;

export type InferRecordCreate<TFields extends FieldDefinitions> = {
  [K in keyof TFields as TFields[K]['options'] extends
    | { generated: true }
    | { default: unknown }
    | { nullable: true }
    ? never
    : K]: TFields[K]['options'] extends { nullable: true }
      ? NullableCreateFieldValue<TFields[K]> | undefined
      : NullableCreateFieldValue<TFields[K]>;
} & {
  [K in keyof TFields as TFields[K]['options'] extends
    | { generated: true }
    | { default: unknown }
    | { nullable: true }
    ? K
    : never]?: NullableCreateFieldValue<TFields[K]>;
};

export type InferRecordUpdate<TFields extends FieldDefinitions> = {
  [K in keyof TFields]?: NullableCreateFieldValue<TFields[K]>;
};

export interface RecordClass<
  TFields extends FieldDefinitions = FieldDefinitions,
  TInstance extends BaseRecord = BaseRecord
> {
  new(table: Table): TInstance;
  readonly definition: RecordDefinition<TFields>;
}

export type RecordClassMap = Record<string, RecordClass>;

export function defineRecord<const TFields extends FieldDefinitions>(
  definition: RecordDefinition<TFields>
): RecordClass<TFields, BaseRecord & InferRecordFields<TFields>> {
  class DefinedRecord extends BaseRecord {
    static readonly definition = Object.freeze(definition);
  }
  return DefinedRecord as unknown as RecordClass<
    TFields,
    BaseRecord & InferRecordFields<TFields>
  >;
}

type FieldsOf<TClass extends RecordClass<any, any>> =
  TClass extends RecordClass<infer TFields, any> ? TFields : never;

type InstanceOf<TClass extends RecordClass> = InstanceType<TClass>;
type RowOf<TClass extends RecordClass> = InferRecordFields<FieldsOf<TClass>>;
type CreateOf<TClass extends RecordClass> = InferRecordCreate<FieldsOf<TClass>>;
type UpdateOf<TClass extends RecordClass> = InferRecordUpdate<FieldsOf<TClass>>;
type FilterOf<TClass extends RecordClass> = FilterShape<RowOf<TClass>>;

export type BoundModel<TClass extends RecordClass> = Manager<TClass>;

export type BoundModels<TClasses extends RecordClassMap> = {
  readonly [K in keyof TClasses]: BoundModel<TClasses[K]>;
};

class RecordHydrator<TClasses extends RecordClassMap = RecordClassMap> {
  private readonly byTable = new Map<string, RecordClass>();
  private readonly identityMap = new Map<string, BaseRecord>();

  constructor(
    private readonly db: Database,
    classes: TClasses
  ) {
    for (const recordClass of Object.values(classes)) {
      this.byTable.set(recordClass.definition.table, recordClass);
    }
  }

  hydrate<TClass extends RecordClass>(
    recordClass: TClass,
    row: Document
  ): InstanceOf<TClass> {
    const table = this.db.table(recordClass.definition.table);
    const identity = recordIdentity(table, row);
    const existing = identity
      ? this.identityMap.get(identity) as InstanceOf<TClass> | undefined
      : undefined;
    const record = existing || new recordClass(table);
    const runtime = runtimeOf(record);
    if (!existing) {
      runtime.data = {};
      runtime.state = new FlushState();
      runtime.state.method = FlushMethod.UPDATE;
      runtime.state.selected = true;
      runtime.inserted = true;
      if (identity) this.identityMap.set(identity, record);
    }

    for (const field of table.model.fields) {
      const value = row[field.name];
      if (value === undefined) continue;
      if (existing && runtimeOf(existing).state.dirty.has(field.name)) continue;

      if (field instanceof ForeignKeyField && value && typeof value === 'object') {
        const targetTable = field.referencedField.model.table.name;
        const targetClass = this.byTable.get(targetTable);
        runtime.data[field.name] = targetClass
          ? this.hydrate(targetClass, value as Document)
          : value as never;
      } else if (field instanceof RelatedField && Array.isArray(value)) {
        const targetTable = field.referencingField.model.table.name;
        const targetClass = this.byTable.get(targetTable);
        runtime.data[field.name] = targetClass
          ? value.map(item => this.hydrate(targetClass, item as Document)) as never
          : value as never;
      } else {
        runtime.data[field.name] = value as never;
      }
    }

    this.attach(record);
    return record as InstanceOf<TClass>;
  }

  attach(record: BaseRecord): void {
    runtimeOf(record).hydrate = (targetTable: Table, value: Document) => {
      const targetClass = this.byTable.get(targetTable.model.table.name);
      return targetClass ? this.hydrate(targetClass, value) : value;
    };
  }
}

export class QuerySet<TClass extends RecordClass> {
  constructor(
    private readonly table: Table,
    private readonly recordClass: TClass,
    private readonly hydrator: RecordHydrator,
    private readonly fields: SelectFields<RowOf<TClass>> = '*',
    private readonly options: SelectOptions = {}
  ) {}

  filter(filter: FilterOf<TClass>): QuerySet<TClass> {
    const where = this.options.where
      ? { and: [this.options.where, filter] }
      : filter;
    return new QuerySet(
      this.table,
      this.recordClass,
      this.hydrator,
      this.fields,
      { ...this.options, where: where as Document }
    );
  }

  orderBy(orderBy: OrderBy): QuerySet<TClass> {
    return new QuerySet(
      this.table,
      this.recordClass,
      this.hydrator,
      this.fields,
      { ...this.options, orderBy }
    );
  }

  limit(limit: number): QuerySet<TClass> {
    return new QuerySet(
      this.table,
      this.recordClass,
      this.hydrator,
      this.fields,
      { ...this.options, limit }
    );
  }

  offset(offset: number): QuerySet<TClass> {
    return new QuerySet(
      this.table,
      this.recordClass,
      this.hydrator,
      this.fields,
      { ...this.options, offset }
    );
  }

  select(fields: SelectFields<RowOf<TClass>>): QuerySet<TClass> {
    return new QuerySet(
      this.table,
      this.recordClass,
      this.hydrator,
      fields,
      this.options
    );
  }

  async all(): Promise<InstanceOf<TClass>[]> {
    const rows = await this.table.select<Document>(
      this.fields as string | string[] | Document,
      this.options
    );
    return rows.map(row => this.hydrator.hydrate(this.recordClass, row));
  }

  async first(): Promise<InstanceOf<TClass> | undefined> {
    const rows = await this.limit(1).all();
    return rows[0];
  }

  count(): Promise<number> {
    return this.table.count(this.options.where);
  }

  async exists(): Promise<boolean> {
    const key = this.table.model.primaryKey.fields[0].name;
    const rows = await this.table.select<Document>(key, {
      ...this.options,
      limit: 1,
    });
    return rows.length > 0;
  }

  update(data: UpdateOf<TClass>): Promise<unknown> {
    this.checkMutable('update');
    const row: Document = {};
    for (const [name, value] of Object.entries(data as { [key: string]: unknown })) {
      row[name] = value instanceof BaseRecord
        ? runtimeOf(value).primaryKey()
        : (value as Document[string]);
    }
    return this.table.update(row, this.options.where as Document | undefined);
  }

  delete(): Promise<unknown> {
    this.checkMutable('delete');
    return this.table.delete(this.options.where);
  }

  // Bulk statements act on every matching row; a sliced or ordered query set
  // would silently ignore those options.
  private checkMutable(method: string): void {
    for (const option of ['limit', 'offset', 'orderBy'] as const) {
      if (this.options[option] !== undefined) {
        throw Error(
          `${method}() does not support ${option}; ` +
          'load the records and save or delete them individually'
        );
      }
    }
  }

  then<TResult1 = InstanceOf<TClass>[], TResult2 = never>(
    onfulfilled?:
      | ((value: InstanceOf<TClass>[]) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.all().then(onfulfilled, onrejected);
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<InstanceOf<TClass>> {
    for (const record of await this.all()) {
      yield record;
    }
  }
}

export class MultipleRecordsError extends Error {
  constructor(table: string) {
    super(`Multiple ${table} records matched get()`);
    this.name = 'MultipleRecordsError';
  }
}

export class Manager<TClass extends RecordClass> {
  constructor(
    private readonly table: Table,
    readonly record: TClass,
    private readonly hydrator: RecordHydrator
  ) {}

  // Django-style alias: models.User.objects.filter() === models.User.filter()
  get objects(): this {
    return this;
  }

  all(): Promise<InstanceOf<TClass>[]> {
    return this.query().all();
  }

  filter(filter: FilterOf<TClass>): QuerySet<TClass> {
    return this.query().filter(filter);
  }

  async get(filter: Value | FilterOf<TClass>): Promise<InstanceOf<TClass> | undefined> {
    if (filter === null || typeof filter !== 'object') {
      const row = await this.table.get<Document>(filter);
      return row ? this.hydrator.hydrate(this.record, row) : undefined;
    }
    const rows = await this.filter(filter).limit(2).all();
    if (rows.length > 1) throw new MultipleRecordsError(this.table.name);
    return rows[0];
  }

  first(
    filter: FilterOf<TClass> = {} as FilterOf<TClass>,
    orderBy?: OrderBy
  ): Promise<InstanceOf<TClass> | undefined> {
    const query = this.filter(filter);
    return (orderBy ? query.orderBy(orderBy) : query).first();
  }

  count(filter?: FilterOf<TClass>): Promise<number> {
    return this.table.count(filter as Document | undefined);
  }

  build(data: CreateOf<TClass>): InstanceOf<TClass> {
    const record = new this.record(this.table);
    this.hydrator.attach(record);
    Object.assign(record, data);
    return record as InstanceOf<TClass>;
  }

  async create(data: CreateOf<TClass>): Promise<InstanceOf<TClass>> {
    const record = this.build(data);
    await record.save();
    const row = await this.table.get<Document>(runtimeOf(record).filter());
    return this.hydrator.hydrate(this.record, row);
  }

  async getOrCreate(
    lookup: UpdateOf<TClass>,
    defaults?: UpdateOf<TClass>
  ): Promise<[InstanceOf<TClass>, boolean]> {
    const existing = await this.get(lookup as FilterOf<TClass>);
    if (existing) return [existing, false];
    // A concurrent creator may win between the lookup and the insert; the
    // insert-only flush adopts the winning row instead of updating it.
    const record = this.build({ ...lookup, ...defaults } as CreateOf<TClass>);
    const runtime = runtimeOf(record);
    runtime.insertOnly = true;
    await record.save();
    const row = await this.table.get<Document>(runtime.filter());
    return [this.hydrator.hydrate(this.record, row), runtime.isInserted()];
  }

  query(): QuerySet<TClass> {
    return new QuerySet(this.table, this.record, this.hydrator);
  }
}

export function bindRecords<const TClasses extends RecordClassMap>(
  db: Database,
  classes: TClasses
): BoundModels<TClasses> {
  const schema = schemaFromRecords(classes, db.name);
  db.useSchema(schema);
  const hydrator = new RecordHydrator(db, classes);
  const result: Partial<BoundModels<TClasses>> = {};

  for (const [name, recordClass] of Object.entries(classes)) {
    const table = db.table(recordClass.definition.table);
    result[name as keyof TClasses] = new Manager(
      table,
      recordClass,
      hydrator
    ) as BoundModels<TClasses>[keyof TClasses];
  }
  return result as BoundModels<TClasses>;
}

export function schemaFromRecords<TClasses extends RecordClassMap>(
  classes: TClasses,
  databaseName = ''
): Schema {
  const entries = Object.entries(classes);
  const registered = new Map(
    entries.map(([, recordClass]) => [
      recordClass.definition.table,
      recordClass,
    ])
  );
  for (const [, recordClass] of entries) {
    validateRecordDefinition(recordClass, registered);
  }
  const tables = entries.map(([, recordClass]) =>
    tableFromRecord(recordClass, registered)
  );
  const config = {
    models: entries.map(([name, recordClass]) => ({
      name: recordClass.definition.name || name,
      table: recordClass.definition.table,
      fields: Object.entries(recordClass.definition.fields).map(
        ([fieldName, definition]) => ({
          name: fieldName,
          column: columnName(fieldName, definition),
          ...(definition.kind === 'foreignKey' && definition.options.relatedName
            ? { relatedName: definition.options.relatedName }
            : {}),
        })
      ),
    })),
  };
  const database: DatabaseDefinition = { name: databaseName, tables };
  return new Schema(database, config);
}

function tableFromRecord(
  recordClass: RecordClass,
  registered: Map<string, RecordClass>
): DatabaseDefinition['tables'][number] {
  const columns: Column[] = [];
  const constraints: Constraint[] = [];
  // Primary key columns are gathered rather than emitted per field: several
  // fields marked primaryKey form one composite key, not one key each.
  const primaryKeyColumns: string[] = [];

  for (const [name, definition] of Object.entries(recordClass.definition.fields)) {
    const column = columnFromField(name, definition, recordClass, registered);
    columns.push(column);

    if (definition.options.primaryKey) {
      primaryKeyColumns.push(column.name);
    }
    if (definition.options.unique) {
      constraints.push({
        name: `${recordClass.definition.table}_${column.name}_key`,
        columns: [column.name],
        unique: true,
      });
    }
    if (definition.kind === 'foreignKey') {
      const target = resolveForeignTarget(definition, recordClass, registered);
      const targetKey = primaryField(target);
      constraints.push({
        name: `${recordClass.definition.table}_${column.name}_fkey`,
        columns: [column.name],
        references: {
          table: target.definition.table,
          columns: [columnName(targetKey[0], targetKey[1])],
        },
      });
    }
  }

  if (primaryKeyColumns.length) {
    constraints.unshift({
      name: `${recordClass.definition.table}_pkey`,
      columns: primaryKeyColumns,
      primaryKey: true,
    });
  }

  for (const group of recordClass.definition.unique || []) {
    const groupColumns = group.map(fieldName =>
      columnName(fieldName, fieldDefinition(recordClass, fieldName))
    );
    constraints.push({
      name: `${recordClass.definition.table}_${groupColumns.join('_')}_key`,
      columns: groupColumns,
      unique: true,
    });
  }

  return { name: recordClass.definition.table, columns, constraints };
}

function columnFromField(
  name: string,
  definition: AnyFieldDefinition,
  owner?: RecordClass,
  registered?: Map<string, RecordClass>
): Column {
  if (definition.kind === 'foreignKey') {
    if (!owner || !registered) {
      throw Error(`Cannot resolve foreign key field ${name}`);
    }
    const target = resolveForeignTarget(definition, owner, registered);
    const [targetName, targetDefinition] = primaryField(target);
    const targetColumn = columnFromField(
      targetName,
      targetDefinition,
      target,
      registered
    );
    return {
      ...targetColumn,
      name: columnName(name, definition),
      nullable: definition.options.nullable,
      autoIncrement: false,
      default: literalDefault(definition.options.default),
    };
  }

  const options = definition.options;
  const column: Column = {
    name: columnName(name, definition),
    type: columnType(definition),
    nullable: options.nullable,
    autoIncrement: options.generated,
    default: literalDefault(options.default),
  };
  if (definition.kind === 'string') {
    column.size = (options as StringFieldOptions).maxLength;
  } else if (definition.kind === 'vector') {
    column.dimensions = (options as VectorFieldOptions).dimensions;
  } else if (definition.kind === 'enum') {
    const enumOptions = options as unknown as EnumFieldOptions<string>;
    column.userDefinedType = {
      type: 'enum',
      name: enumOptions.typeName || `${column.name}_enum`,
      values: [...enumOptions.values],
    };
  }
  return column;
}

function columnType(definition: ScalarFieldDefinition): string {
  switch (definition.kind) {
    case 'string': return 'varchar';
    case 'integer': return 'integer';
    case 'bigint': return 'bigint';
    case 'float': return 'double';
    case 'decimal': return 'decimal';
    case 'boolean': return 'boolean';
    case 'datetime': return 'datetime';
    case 'json': return 'json';
    case 'uuid': return 'uuid';
    case 'enum': return 'enum';
    default: return definition.kind;
  }
}

function columnName(name: string, definition: AnyFieldDefinition): string {
  return definition.options.column ||
    (definition.kind === 'foreignKey' ? `${name}_id` : name);
}

function fieldDefinition(
  recordClass: RecordClass,
  fieldName: string
): AnyFieldDefinition {
  const definition = recordClass.definition.fields[fieldName];
  if (!definition) {
    throw Error(`${recordClass.definition.table}: unknown field ${fieldName}`);
  }
  return definition;
}

function primaryField(recordClass: RecordClass): [string, AnyFieldDefinition] {
  const entries = Object.entries(recordClass.definition.fields)
    .filter(([, definition]) => definition.options.primaryKey);
  if (!entries.length) {
    throw Error(`${recordClass.definition.table}: no primary key field`);
  }
  if (entries.length > 1) {
    throw Error(
      `${recordClass.definition.table}: cannot be referenced by a foreign ` +
      'key because its primary key is composite'
    );
  }
  return entries[0];
}

function literalDefault(value: Value | SqlDefault | undefined): Value | undefined {
  return value && typeof value === 'object' && 'sql' in value
    ? undefined
    : value as Value | undefined;
}

function recordIdentity(table: Table, row: Document): string | undefined {
  const values = table.model.primaryKey.fields.map(field =>
    table.model.valueOf(row, field)
  );
  return values.some(value => value === undefined)
    ? undefined
    : `${table.name}:${JSON.stringify(values)}`;
}

function validateRecordDefinition(
  recordClass: RecordClass,
  registered: Map<string, RecordClass>
): void {
  const { table, fields } = recordClass.definition;
  const primaryKeys = Object.entries(fields)
    .filter(([, definition]) => definition.options.primaryKey);
  if (primaryKeys.length === 0) {
    throw Error(`${table}: expected at least one primary key field`);
  }
  if (primaryKeys.length > 1) {
    const generated = primaryKeys.find(
      ([, definition]) => definition.options.generated
    );
    if (generated) {
      throw Error(
        `${table}.${generated[0]}: a generated field cannot be part of a ` +
        'composite primary key'
      );
    }
  }

  for (const [name, definition] of Object.entries(fields)) {
    if (name.startsWith('__') || name in BaseRecord.prototype) {
      throw Error(
        `${table}.${name}: field name conflicts with the Record API; ` +
        'use the column option with a different property name'
      );
    }
    if (
      definition.kind === 'foreignKey' &&
      !registered.has(foreignTargetTable(definition, recordClass))
    ) {
      throw Error(
        `${table}.${name}: referenced model is not present in the binding`
      );
    }
  }
}

function resolveForeignTarget(
  definition: ForeignKeyDefinition,
  owner: RecordClass,
  registered: Map<string, RecordClass>
): RecordClass {
  const table = foreignTargetTable(definition, owner);
  const target = registered.get(table);
  if (!target) {
    throw Error(`${owner.definition.table}: referenced model ${table} is not registered`);
  }
  return target;
}

function foreignTargetTable(
  definition: ForeignKeyDefinition,
  owner: RecordClass
): string {
  if (typeof definition.target === 'string') {
    return definition.target === 'self'
      ? owner.definition.table
      : definition.target;
  }
  return definition.target().definition.table;
}

export function getSqlDefault(
  definition: AnyFieldDefinition
): string | undefined {
  const value = definition.options.default;
  return value && typeof value === 'object' && 'sql' in value
    ? value.sql
    : undefined;
}
