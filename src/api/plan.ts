import {
  ForeignKeyField,
  Model,
  RelatedField,
  Schema,
  SimpleField,
} from '../schema';
import {
  API_FILTER_OPERATORS,
  ApiConfig,
  ApiDefaults,
  ApiFilterOperator,
  DEFAULT_FILTER_OPERATORS,
  DEFAULT_INCLUDE_MAX_DEPTH,
  DEFAULT_MAX_PAGE_LIMIT,
  DEFAULT_OPERATIONS,
  DEFAULT_PAGE_LIMIT,
  OPERATIONS,
  Operation,
  AfterReadFn,
  AssignFn,
  AuthorizeFn,
  BeforeWriteFn,
  ResourceConfig,
  ScopeFn,
} from './config';
import { AGGREGATE_PARAMS, RESERVED_PARAMS } from './params';
import {
  ColumnKind,
  classifyColumn,
  isNullableField,
  isRequiredOnCreate,
  isSortable,
  isSummable,
  isWritable,
  operatorsForKind,
} from './column';

export interface IdentityPlan {
  fields: SimpleField[];
  composite: boolean;
}

export interface FilterPlan {
  /** External parameter name; a dotted path for filters across foreign keys. */
  path: string;
  field: SimpleField;
  kind: ColumnKind;
  operators: ApiFilterOperator[];
}

export interface SortPlan {
  path: string;
  field: SimpleField;
}

export interface IncludePlan {
  name: string;
  field: ForeignKeyField | RelatedField;
  target: Model;
  kind: 'one' | 'many';
  /** Row cap for an embedded collection; unset for a single embedded row. */
  limit?: number;
}

export interface AggregatePlan {
  groupBy: { path: string; field: SimpleField }[];
  /** Columns sum and avg may be applied to. */
  summable: SimpleField[];
  /** Columns min and max may be applied to. */
  comparable: SimpleField[];
}

export interface PagePlan {
  defaultLimit: number;
  maxLimit: number;
}

export interface ResourcePlan<TContext = unknown> {
  model: Model;
  name: string;
  path: string;
  /** From the config, or the table's comment. */
  description?: string;
  operations: ReadonlySet<Operation>;
  /** Null when the model has no primary key, which leaves it collection-only. */
  identity: IdentityPlan | null;
  readFields: SimpleField[];
  writeFields: SimpleField[];
  /** Present when the aggregate operation is exposed. */
  aggregate?: AggregatePlan;
  filters: FilterPlan[];
  sorts: SortPlan[];
  defaultSort: string[];
  includes: IncludePlan[];
  includeMaxDepth: number;
  page: PagePlan;
  scope?: ScopeFn<TContext>;
  assign?: AssignFn<TContext>;
  authorize?: AuthorizeFn<TContext>;
  beforeWrite?: BeforeWriteFn<TContext>;
  afterRead?: AfterReadFn<TContext>;
}

export class ApiConfigError extends Error {
  issues: string[];

  constructor(issues: string[]) {
    super(`Invalid API configuration:\n${issues.map(issue => `  - ${issue}`).join('\n')}`);
    this.name = 'ApiConfigError';
    this.issues = issues;
  }
}

/**
 * The compiled policy. Both the OpenAPI document and the request handler read
 * only this, so the document can't describe a field the handler won't serve.
 */
export class ApiPlan<TContext = unknown> {
  readonly basePath: string;
  readonly resources: readonly ResourcePlan<TContext>[];
  readonly warnings: readonly string[];

  private byName = new Map<string, ResourcePlan<TContext>>();
  private byPath = new Map<string, ResourcePlan<TContext>>();

  constructor(
    basePath: string,
    resources: ResourcePlan<TContext>[],
    warnings: string[]
  ) {
    this.basePath = basePath;
    this.resources = resources;
    this.warnings = warnings;
    for (const resource of resources) {
      this.byName.set(resource.name, resource);
      this.byPath.set(resource.path, resource);
    }
  }

  resource(model: string | Model): ResourcePlan<TContext> | undefined {
    return this.byName.get(typeof model === 'string' ? model : model.name);
  }

  resourceAt(path: string): ResourcePlan<TContext> | undefined {
    return this.byPath.get(path);
  }
}

export function compilePlan<TContext = unknown>(
  schema: Schema,
  config: ApiConfig<TContext>
): ApiPlan<TContext> {
  const issues: string[] = [];
  const warnings: string[] = [];
  const defaults = config.defaults ?? {};

  const keys = Object.keys(config.resources);
  if (keys.length === 0) {
    issues.push('resources: at least one resource must be configured');
  }

  const models = new Map<string, { key: string; model: Model }>();
  for (const key of keys) {
    const model = schema.model(key);
    if (!model) {
      issues.push(`${key}: unknown model or table`);
      continue;
    }
    const seen = models.get(model.name);
    if (seen) {
      issues.push(`${key}: model ${model.name} is already configured as '${seen.key}'`);
      continue;
    }
    models.set(model.name, { key, model });
  }

  const resources: ResourcePlan<TContext>[] = [];
  const paths = new Map<string, string>();

  for (const { key, model } of models.values()) {
    const resource = compileResource(
      key,
      model,
      config.resources[key],
      defaults,
      models,
      issues,
      warnings
    );
    const owner = paths.get(resource.path);
    if (owner) {
      issues.push(`${key}: path '${resource.path}' is already used by '${owner}'`);
    } else {
      paths.set(resource.path, key);
    }
    resources.push(resource);
  }

  validateSchemaNames(resources, issues);

  if (issues.length) throw new ApiConfigError(issues);

  return new ApiPlan(normaliseBasePath(config.basePath), resources, warnings);
}

function compileResource<TContext>(
  key: string,
  model: Model,
  config: ResourceConfig<TContext>,
  defaults: ApiDefaults,
  models: Map<string, { key: string; model: Model }>,
  issues: string[],
  warnings: string[]
): ResourcePlan<TContext> {
  const sink: IssueSink = {
    add: message => issues.push(`${key}: ${message}`),
    count: () => issues.length,
  };

  const path = config.path ?? toKebabCase(model.pluralName);
  if (!/^[A-Za-z0-9][A-Za-z0-9._~-]*$/.test(path)) {
    sink.add(`path '${path}' is not a valid single URL segment`);
  }

  const operations = compileOperations(config.operations, sink);
  const identity = model.primaryKey
    ? { fields: [...model.primaryKey.fields], composite: model.primaryKey.fields.length > 1 }
    : null;
  if (!identity && operations.has('get')) {
    if (config.operations) {
      sink.add(`operation 'get' needs a primary key on ${model.table.name}`);
    } else {
      operations.delete('get');
      warnings.push(`${key}: no primary key on ${model.table.name}; serving the collection only`);
    }
  }

  // Resolved before the checks below because an embedded collection falls back
  // to the page size; its own validation runs last so messages stay in the
  // order the options are written.
  const page = resolvePage(config, defaults);

  const readFields = compileReadFields(model, config, sink, warnings, key);
  if (identity && operations.has('get')) {
    const hidden = identity.fields.filter(field => !readFields.includes(field));
    if (hidden.length) {
      warnings.push(
        `${key}: primary key ${hidden.map(field => `'${field.name}'`).join(', ')} is hidden` +
          ` from reads, so a client cannot build an item URL from a list entry`
      );
    }
  }
  const writeFields = compileWriteFields(model, config, operations, sink);
  const aggregate = compileAggregate(model, config, operations, identity, warnings, key, sink);
  const filters = compileFilters(model, config, defaults, operations, sink);
  const sorts = compileSorts(model, config, sink);
  const defaultSort = compileDefaultSort(model, config, sorts, sink);
  const includes = compileIncludes(
    model,
    config,
    defaults,
    models,
    page,
    { readFields, hasRowKey: !!model.keyField() },
    sink
  );
  const includeMaxDepth = compileIncludeMaxDepth(config, defaults, sink);
  validatePage(page, sink);

  const description = config.description ?? model.table.comment;

  return {
    model,
    name: model.name,
    path,
    ...(description ? { description } : {}),
    operations,
    identity,
    readFields,
    writeFields,
    ...(aggregate ? { aggregate } : {}),
    filters,
    sorts,
    defaultSort,
    includes,
    includeMaxDepth,
    page,
    scope: config.scope,
    assign: config.assign,
    authorize: config.authorize,
    beforeWrite: config.beforeWrite,
    afterRead: config.afterRead,
  };
}

/**
 * Every component schema the document will define must have its own name:
 * a model called Problem would silently take over the error schema, and a
 * model called UserCreate would collide with User's request body.
 */
function validateSchemaNames<TContext>(
  resources: ResourcePlan<TContext>[],
  issues: string[]
): void {
  const RESERVED_SCHEMAS = ['PageMeta', 'Problem'];
  const owners = new Map<string, string>();

  const claim = (name: string, owner: string, what: string) => {
    if (RESERVED_SCHEMAS.includes(name)) {
      issues.push(
        `${owner}: the ${what} would be named '${name}', which the document reserves; ` +
          'rename the model'
      );
      return;
    }
    const existing = owners.get(name);
    if (existing) {
      issues.push(
        `${owner}: the ${what} would be named '${name}', which collides with ${existing}; ` +
          'rename the model'
      );
      return;
    }
    owners.set(name, `${owner}'s ${what}`);
  };

  for (const resource of resources) {
    claim(resource.name, resource.name, 'row schema');
  }
  for (const resource of resources) {
    if (resource.operations.has('create')) {
      claim(`${resource.name}Create`, resource.name, 'create body schema');
    }
    if (resource.operations.has('update')) {
      claim(`${resource.name}Update`, resource.name, 'update body schema');
    }
  }
}

interface IssueSink {
  add(message: string): void;
  /** Total issues so far; lets a check skip a message that would be derivative. */
  count(): number;
}

function compileOperations(
  configured: Operation[] | undefined,
  sink: IssueSink
): Set<Operation> {
  if (!configured) return new Set(DEFAULT_OPERATIONS);
  if (configured.length === 0) {
    sink.add('operations must not be empty');
    return new Set();
  }
  const operations = new Set<Operation>();
  for (const operation of configured) {
    if (!OPERATIONS.includes(operation)) {
      sink.add(`unknown operation '${operation}'`);
      continue;
    }
    operations.add(operation);
  }
  return operations;
}

function compileReadFields<TContext>(
  model: Model,
  config: ResourceConfig<TContext>,
  sink: IssueSink,
  warnings: string[],
  key: string
): SimpleField[] {
  const all = model.fields.filter((field): field is SimpleField => field instanceof SimpleField);
  const requested = config.read?.fields ?? '*';
  const before = sink.count();

  let fields: SimpleField[];
  if (requested === '*') {
    fields = all;
    for (const field of all) {
      if (classifyColumn(field) === 'vector') {
        warnings.push(`${key}: read includes the vector column '${field.name}'`);
      }
    }
  } else {
    const selected = new Set<SimpleField>();
    for (const name of requested) {
      const field = resolveLocalField(model, name, sink, 'read');
      if (field) selected.add(field);
    }
    fields = all.filter(field => selected.has(field));
  }

  for (const name of config.read?.exclude ?? []) {
    const field = resolveLocalField(model, name, sink, 'read.exclude');
    if (field) fields = fields.filter(entry => entry !== field);
  }

  if (fields.length === 0 && sink.count() === before) {
    sink.add('read leaves no fields exposed');
  }
  return fields;
}

/**
 * Columns a client may set. Generated columns are never writable, and a kind
 * sqlex cannot take a value for is excluded even when named, because the write
 * would fail at the database instead of at the request.
 */
function compileWriteFields<TContext>(
  model: Model,
  config: ResourceConfig<TContext>,
  operations: ReadonlySet<Operation>,
  sink: IssueSink
): SimpleField[] {
  const writes = operations.has('create') || operations.has('update');
  if (!writes && !config.write) return [];

  const settable = model.fields.filter(
    (field): field is SimpleField =>
      field instanceof SimpleField &&
      !field.column.autoIncrement &&
      isWritable(classifyColumn(field))
  );
  const requested = config.write?.fields ?? '*';
  const before = sink.count();

  let fields: SimpleField[];
  if (requested === '*') {
    fields = settable;
  } else {
    const selected = new Set<SimpleField>();
    for (const name of requested) {
      const field = resolveLocalField(model, name, sink, 'write');
      if (!field) continue;
      if (!settable.includes(field)) {
        sink.add(`write '${name}' is not a column a client can set`);
        continue;
      }
      selected.add(field);
    }
    fields = settable.filter(field => selected.has(field));
  }

  for (const name of config.write?.exclude ?? []) {
    const field = resolveLocalField(model, name, sink, 'write.exclude');
    if (field) fields = fields.filter(entry => entry !== field);
  }

  if (!writes) {
    if (config.write) sink.add('write is configured but no write operation is exposed');
    return [];
  }

  if (fields.length === 0) {
    if (sink.count() === before) sink.add('write leaves no fields a client can set');
    return fields;
  }

  // A create that cannot supply a required column can only ever fail. With
  // `assign` in play the server may be the one supplying it — a tenant column
  // usually is exactly that — so the check defers to it, and a value assign
  // fails to provide still surfaces as a 422 from the database.
  if (operations.has('create') && !config.assign) {
    const missing = model.fields.filter(
      (field): field is SimpleField =>
        field instanceof SimpleField && isRequiredOnCreate(field) && !fields.includes(field)
    );
    if (missing.length) {
      sink.add(
        `create needs ${missing.map(field => `'${field.name}'`).join(', ')}, ` +
          'which the write policy does not allow'
      );
    }
  }

  return fields;
}

/**
 * What the aggregate route may compute. `count` over the resource's filters is
 * always available once the operation is exposed; grouping and the column
 * functions are granted by naming columns, like everything else.
 */
function compileAggregate<TContext>(
  model: Model,
  config: ResourceConfig<TContext>,
  operations: ReadonlySet<Operation>,
  identity: IdentityPlan | null,
  warnings: string[],
  key: string,
  sink: IssueSink
): AggregatePlan | undefined {
  if (!operations.has('aggregate')) {
    if (config.aggregate) {
      sink.add('aggregate is configured but the aggregate operation is not exposed');
    }
    return undefined;
  }

  // The aggregate route shares its shape with an item URL, so a key value that
  // could literally be 'aggregate' would be shadowed by it.
  if (
    identity &&
    identity.fields.length === 1 &&
    ['string', 'enum'].includes(classifyColumn(identity.fields[0]))
  ) {
    warnings.push(
      `${key}: the aggregate route shadows the ${model.name} whose key is the string 'aggregate'`
    );
  }

  const groupBy: { path: string; field: SimpleField }[] = [];
  const seen = new Set<string>();
  for (const name of config.aggregate?.groupBy ?? []) {
    const field = resolveLocalField(model, name, sink, 'aggregate.groupBy');
    if (!field || seen.has(field.name)) continue;
    seen.add(field.name);
    if (!isSortable(classifyColumn(field))) {
      sink.add(`aggregate.groupBy '${name}' is a ${classifyColumn(field)} column and cannot group rows`);
      continue;
    }
    groupBy.push({ path: field.name, field });
  }

  const summable: SimpleField[] = [];
  const comparable: SimpleField[] = [];
  for (const name of config.aggregate?.fields ?? []) {
    const field = resolveLocalField(model, name, sink, 'aggregate.fields');
    if (!field || summable.includes(field) || comparable.includes(field)) continue;
    if (field instanceof ForeignKeyField) {
      sink.add(`aggregate.fields '${name}' is a foreign key, which no function applies to`);
      continue;
    }
    const kind = classifyColumn(field);
    if (isSummable(kind)) summable.push(field);
    if (isSortable(kind)) comparable.push(field);
    if (!isSummable(kind) && !isSortable(kind)) {
      sink.add(`aggregate.fields '${name}' is a ${kind} column, which no function applies to`);
    }
  }

  return { groupBy, summable, comparable };
}

function compileFilters<TContext>(
  model: Model,
  config: ResourceConfig<TContext>,
  defaults: ApiDefaults,
  operations: ReadonlySet<Operation>,
  sink: IssueSink
): FilterPlan[] {
  const before = sink.count();
  const allowed = new Set(
    compileOperators(config.filter?.operators ?? defaults.operators, sink)
  );
  const operatorsRejected = sink.count() > before;

  const filters: FilterPlan[] = [];
  const seen = new Set<string>();
  for (const path of config.filter?.fields ?? []) {
    const resolved = resolvePath(model, path, sink, 'filter');
    if (!resolved || seen.has(resolved.path)) continue;
    seen.add(resolved.path);
    const kind = classifyColumn(resolved.field);
    const applicable = operatorsForKind(kind, isNullableField(resolved.field));
    const operators = API_FILTER_OPERATORS.filter(
      operator => allowed.has(operator) && applicable.includes(operator)
    );
    if (operators.length === 0) {
      if (!operatorsRejected) sink.add(`filter '${path}' (${kind}) has no usable operator`);
      continue;
    }
    // The request layer reads these for itself, so a filter of the same name
    // would be swallowed rather than applied.
    if (
      RESERVED_PARAMS.includes(resolved.path) ||
      (operations.has('aggregate') && AGGREGATE_PARAMS.includes(resolved.path))
    ) {
      sink.add(`filter '${resolved.path}' collides with the reserved parameter of that name`);
      continue;
    }
    filters.push({ path: resolved.path, field: resolved.field, kind, operators });
  }
  return filters;
}

function compileOperators(
  configured: ApiFilterOperator[] | undefined,
  sink: IssueSink
): readonly ApiFilterOperator[] {
  if (!configured) return DEFAULT_FILTER_OPERATORS;
  const operators: ApiFilterOperator[] = [];
  for (const operator of configured) {
    if (!API_FILTER_OPERATORS.includes(operator)) {
      sink.add(`unknown filter operator '${operator}'`);
      continue;
    }
    operators.push(operator);
  }
  return operators;
}

function compileSorts<TContext>(
  model: Model,
  config: ResourceConfig<TContext>,
  sink: IssueSink
): SortPlan[] {
  const sorts: SortPlan[] = [];
  const seen = new Set<string>();
  for (const path of config.sort?.fields ?? []) {
    const resolved = resolvePath(model, path, sink, 'sort');
    if (!resolved || seen.has(resolved.path)) continue;
    seen.add(resolved.path);
    const kind = classifyColumn(resolved.field);
    if (!isSortable(kind)) {
      sink.add(`sort '${path}' is a ${kind} column and cannot be ordered`);
      continue;
    }
    sorts.push({ path: resolved.path, field: resolved.field });
  }
  return sorts;
}

function compileDefaultSort<TContext>(
  model: Model,
  config: ResourceConfig<TContext>,
  sorts: SortPlan[],
  sink: IssueSink
): string[] {
  const sortable = new Set(sorts.map(sort => sort.path));
  const defaultSort: string[] = [];
  for (const entry of config.sort?.default ?? []) {
    const descending = entry.startsWith('-');
    const resolved = resolvePath(model, descending ? entry.slice(1) : entry, sink, 'sort.default');
    if (!resolved) continue;
    if (!sortable.has(resolved.path)) {
      sink.add(`sort.default '${entry}' is not one of the sortable fields`);
      continue;
    }
    defaultSort.push(descending ? `-${resolved.path}` : resolved.path);
  }
  return defaultSort;
}

interface IncludeContext {
  readFields: SimpleField[];
  /** A single-column key, which a reverse relation needs to group its rows by. */
  hasRowKey: boolean;
}

function compileIncludes<TContext>(
  model: Model,
  config: ResourceConfig<TContext>,
  defaults: ApiDefaults,
  models: Map<string, { key: string; model: Model }>,
  page: PagePlan,
  { readFields, hasRowKey }: IncludeContext,
  sink: IssueSink
): IncludePlan[] {
  const includes: IncludePlan[] = [];
  const seen = new Set<string>();
  for (const name of config.include?.relations ?? []) {
    if (name.includes('.')) {
      sink.add(`include '${name}' must be a single relation; nesting comes from the request`);
      continue;
    }
    const field = model.field(name);
    if (!field) {
      sink.add(`include '${name}' is not a field of ${model.name}`);
      continue;
    }

    let target: Model;
    let kind: 'one' | 'many';
    if (field instanceof ForeignKeyField) {
      target = field.referencedField.model;
      kind = 'one';
    } else if (field instanceof RelatedField) {
      if (field.throughField) {
        target = field.throughField.referencedField.model;
        kind = 'many';
      } else {
        target = field.referencingField.model;
        kind = field.referencingField.isUnique() ? 'one' : 'many';
      }
    } else {
      sink.add(`include '${name}' is not a relation`);
      continue;
    }

    if (!models.has(target.name)) {
      sink.add(`include '${name}' targets ${target.name}, which is not an exposed resource`);
      continue;
    }

    // Expanding a foreign key would hand back the row behind a column the read
    // policy hides, so the two have to agree.
    if (field instanceof ForeignKeyField && !readFields.includes(field)) {
      sink.add(`include '${name}' is not readable, so it cannot be expanded`);
      continue;
    }

    // A reverse relation is resolved by grouping rows under this model's key,
    // which a composite or absent primary key cannot provide.
    if (kind === 'many' && !hasRowKey) {
      sink.add(
        `include '${name}' is a collection, which needs a single-column primary key on ${model.table.name}`
      );
      continue;
    }

    if (seen.has(field.name)) continue;
    seen.add(field.name);

    const limit = config.include?.limit ?? defaults.includeLimit ?? page.defaultLimit;
    includes.push({
      name: field.name,
      field,
      target,
      kind,
      ...(kind === 'many' ? { limit } : {}),
    });
  }
  return includes;
}

function compileIncludeMaxDepth<TContext>(
  config: ResourceConfig<TContext>,
  defaults: ApiDefaults,
  sink: IssueSink
): number {
  const depth =
    config.include?.maxDepth ?? defaults.includeMaxDepth ?? DEFAULT_INCLUDE_MAX_DEPTH;
  if (!Number.isInteger(depth) || depth < 1) {
    sink.add(`include.maxDepth must be a positive integer, got ${depth}`);
    return DEFAULT_INCLUDE_MAX_DEPTH;
  }
  return depth;
}

function resolvePage<TContext>(
  config: ResourceConfig<TContext>,
  defaults: ApiDefaults
): PagePlan {
  return {
    defaultLimit: config.page?.defaultLimit ?? defaults.page?.defaultLimit ?? DEFAULT_PAGE_LIMIT,
    maxLimit: config.page?.maxLimit ?? defaults.page?.maxLimit ?? DEFAULT_MAX_PAGE_LIMIT,
  };
}

function validatePage(page: PagePlan, sink: IssueSink): void {
  for (const [name, value] of [
    ['page.defaultLimit', page.defaultLimit],
    ['page.maxLimit', page.maxLimit],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) {
      sink.add(`${name} must be a positive integer, got ${value}`);
    }
  }
  if (page.defaultLimit > page.maxLimit) {
    sink.add(
      `page.defaultLimit (${page.defaultLimit}) exceeds page.maxLimit (${page.maxLimit})`
    );
  }
}

function resolveLocalField(
  model: Model,
  name: string,
  sink: IssueSink,
  where: string
): SimpleField | undefined {
  if (name.includes('.')) {
    sink.add(`${where} '${name}' must be a field of ${model.name}`);
    return undefined;
  }
  const field = model.field(name);
  if (!(field instanceof SimpleField)) {
    sink.add(`${where} '${name}' is not a column of ${model.name}`);
    return undefined;
  }
  return field;
}

/**
 * Resolves a field name or a dotted path across foreign keys, returning the
 * path rewritten with canonical field names so column aliases don't produce two
 * spellings of one parameter.
 */
function resolvePath(
  model: Model,
  path: string,
  sink: IssueSink,
  where: string
): { path: string; field: SimpleField } | undefined {
  const segments = path.split('.');
  const canonical: string[] = [];
  let current = model;

  for (let i = 0; i < segments.length - 1; i++) {
    const field = current.field(segments[i]);
    if (!(field instanceof ForeignKeyField)) {
      sink.add(`${where} '${path}': '${segments[i]}' is not a foreign key of ${current.name}`);
      return undefined;
    }
    canonical.push(field.name);
    current = field.referencedField.model;
  }

  const last = segments[segments.length - 1];
  const field = current.field(last);
  if (!(field instanceof SimpleField)) {
    sink.add(`${where} '${path}': '${last}' is not a column of ${current.name}`);
    return undefined;
  }
  canonical.push(field.name);

  return { path: canonical.join('.'), field };
}

function normaliseBasePath(basePath?: string): string {
  if (!basePath) return '/';
  const trimmed = basePath.replace(/\/+$/, '');
  if (!trimmed) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function toKebabCase(name: string): string {
  return name
    .replace(/_/g, '-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}
