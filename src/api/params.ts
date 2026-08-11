import { Document, DocumentValue, JsonValue, Value } from '../types';
import { ForeignKeyField, SimpleField } from '../schema';
import { classifyColumn, isRequiredOnCreate, isNullableField } from './column';
import { ApiFilterOperator } from './config';
import { ApiError, ProblemError } from './errors';
import { ApiPlan, FilterPlan, IncludePlan, ResourcePlan } from './plan';

/** A requested relation, and anything requested under it. */
export interface IncludeNode {
  include: IncludePlan;
  children: IncludeNode[];
}

export interface ReadRequest {
  where: Document;
  fields: SimpleField[];
  includes: IncludeNode[];
  orderBy: string[];
  limit: number;
  offset: number;
  total: boolean;
  /** An opaque page mark from a previous response's meta.next. */
  cursor?: string;
}

export type AggregateFunction = 'sum' | 'avg' | 'min' | 'max';

export interface AggregateRequest {
  where: Document;
  groupBy: SimpleField[];
  count: boolean;
  functions: { [fn in AggregateFunction]: SimpleField[] };
  limit: number;
  offset: number;
}

/** Query parameters the request layer claims for itself. */
export const RESERVED_PARAMS: readonly string[] = [
  'sort',
  'include',
  'fields',
  'limit',
  'offset',
  'total',
  'cursor',
];

/** Parameters the aggregate route additionally claims. */
export const AGGREGATE_PARAMS: readonly string[] = [
  'groupBy',
  'count',
  'sum',
  'avg',
  'min',
  'max',
];

const RESERVED = new Set(RESERVED_PARAMS);
const AGGREGATE_RESERVED = new Set([...RESERVED_PARAMS, ...AGGREGATE_PARAMS]);

export function parseReadRequest<TContext>(
  plan: ApiPlan<TContext>,
  resource: ResourcePlan<TContext>,
  params: URLSearchParams
): ReadRequest {
  const errors: ProblemError[] = [];
  // Every parameter is read once, so a repeated one would have half of what was
  // asked for silently dropped; a list of values belongs in one `_in`.
  for (const name of new Set(params.keys())) {
    if (params.getAll(name).length > 1) {
      errors.push({ parameter: name, detail: 'given more than once' });
    }
  }

  const request: ReadRequest = {
    where: parseFilters(resource, params, RESERVED, errors),
    fields: parseFields(resource, params, errors),
    includes: parseIncludes(plan, resource, params, errors),
    orderBy: parseSort(resource, params, errors),
    ...parsePage(resource, params, errors),
  };

  const cursor = params.get('cursor');
  if (cursor !== null) {
    // A cursor already names a position; an offset from it has no meaning.
    if (params.get('offset') !== null) {
      errors.push({ parameter: 'cursor', detail: 'cannot be combined with offset' });
    } else if (cursor === '') {
      errors.push({ parameter: 'cursor', detail: 'expected a cursor from meta.next' });
    } else {
      request.cursor = cursor;
    }
  }

  if (errors.length) throw ApiError.badRequest(errors);
  return request;
}

/** Validates a request against what the aggregate policy grants. */
export function parseAggregateRequest<TContext>(
  resource: ResourcePlan<TContext>,
  params: URLSearchParams
): AggregateRequest {
  const errors: ProblemError[] = [];
  for (const name of new Set(params.keys())) {
    if (params.getAll(name).length > 1) {
      errors.push({ parameter: name, detail: 'given more than once' });
    }
  }

  const aggregate = resource.aggregate ?? { groupBy: [], summable: [], comparable: [] };

  const groupBy: SimpleField[] = [];
  for (const name of listParam(params, 'groupBy')) {
    const entry = aggregate.groupBy.find(candidate => candidate.path === name);
    if (!entry) {
      errors.push({ parameter: 'groupBy', detail: `'${name}' is not a groupable column` });
      continue;
    }
    if (!groupBy.includes(entry.field)) groupBy.push(entry.field);
  }

  const functions: AggregateRequest['functions'] = { sum: [], avg: [], min: [], max: [] };
  for (const fn of ['sum', 'avg', 'min', 'max'] as const) {
    const allowed = fn === 'sum' || fn === 'avg' ? aggregate.summable : aggregate.comparable;
    for (const name of listParam(params, fn)) {
      const field = allowed.find(candidate => candidate.name === name);
      if (!field) {
        errors.push({ parameter: fn, detail: `'${name}' is not a column ${fn} can be applied to` });
        continue;
      }
      if (!functions[fn].includes(field)) functions[fn].push(field);
    }
  }

  let count = false;
  const rawCount = params.get('count');
  if (rawCount !== null) {
    if (rawCount === 'true' || rawCount === '1') count = true;
    else if (rawCount === 'false' || rawCount === '0') count = false;
    else errors.push({ parameter: 'count', detail: `expected true or false, got '${rawCount}'` });
  }
  // With nothing asked for, counting is the only sensible answer.
  if (!count && Object.values(functions).every(fields => fields.length === 0)) count = true;

  const request: AggregateRequest = {
    where: parseFilters(resource, params, AGGREGATE_RESERVED, errors),
    groupBy,
    count,
    functions,
    ...parsePage(resource, params, errors),
  };
  if (errors.length) throw ApiError.badRequest(errors);
  return request;
}

function listParam(params: URLSearchParams, name: string): string[] {
  const raw = params.get(name);
  if (raw === null) return [];
  return raw.split(',').filter(entry => entry !== '');
}

/** The identity of a single row, taken from the path. */
export function parseIdentity<TContext>(
  resource: ResourcePlan<TContext>,
  segment: string
): Document {
  const fields = resource.identity?.fields ?? [];
  const values = segment.split(',');
  if (values.length !== fields.length) {
    throw ApiError.badRequest([
      {
        parameter: 'path',
        detail: `expected ${fields.length} comma-separated key ${
          fields.length === 1 ? 'value' : 'values'
        }, got ${values.length}`,
      },
    ]);
  }

  const errors: ProblemError[] = [];
  const filter: Document = {};
  fields.forEach((field, index) => {
    let raw: string;
    try {
      raw = decodeURIComponent(values[index]);
    } catch {
      errors.push({ parameter: field.name, detail: 'is not valid percent-encoding' });
      return;
    }
    const value = coerce(field, raw, field.name, errors);
    if (value !== undefined) filter[field.name] = value;
  });
  if (errors.length) throw ApiError.badRequest(errors);
  return filter;
}

function parseFilters<TContext>(
  resource: ResourcePlan<TContext>,
  params: URLSearchParams,
  reserved: Set<string>,
  errors: ProblemError[]
): Document {
  const where: Document = {};
  const byName = new Map<string, { filter: FilterPlan; operator: ApiFilterOperator }>();
  for (const filter of resource.filters) {
    for (const operator of filter.operators) {
      byName.set(operator === 'eq' ? filter.path : `${filter.path}_${operator}`, {
        filter,
        operator,
      });
    }
  }

  for (const name of new Set(params.keys())) {
    if (reserved.has(name)) continue;
    const entry = byName.get(name);
    if (!entry) {
      errors.push({ parameter: name, detail: rejection(name, resource, byName) });
      continue;
    }
    const raw = params.get(name) ?? '';
    const value = filterValue(entry.filter, entry.operator, raw, name, errors);
    if (value !== undefined) {
      assign(where, entry.filter.path, entry.operator, value);
    }
  }

  return where;
}

/**
 * Explains an unusable parameter: naming a column that exists but was not made
 * filterable is a different mistake from naming one that does not exist.
 */
function rejection<TContext>(
  name: string,
  resource: ResourcePlan<TContext>,
  byName: Map<string, unknown>
): string {
  const base = name.replace(/_(ne|lt|le|ge|gt|in|notIn|like|ilike|null)$/, '');
  const filterable = resource.filters.some(filter => filter.path === base);
  if (filterable) {
    const allowed = [...byName.keys()].filter(key => key === base || key.startsWith(`${base}_`));
    return `'${name}' is not an available operator on '${base}'; use one of ${allowed.join(', ')}`;
  }
  return `'${name}' is not a filterable parameter`;
}

/**
 * Places a value in the filter, nesting through foreign keys because sqlex
 * expresses a filter across a relation as a nested object rather than a dotted
 * key. Several filters on one path merge into the same object.
 */
function assign(
  where: Document,
  path: string,
  operator: ApiFilterOperator,
  value: Value | Value[]
): void {
  const segments = path.split('.');
  let target = where;
  for (const segment of segments.slice(0, -1)) {
    const existing = target[segment];
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      target = existing as Document;
    } else {
      const nested: Document = {};
      target[segment] = nested;
      target = nested;
    }
  }
  const last = segments[segments.length - 1];
  target[operator === 'eq' ? last : `${last}_${operator}`] = value;
}

function filterValue(
  filter: FilterPlan,
  operator: ApiFilterOperator,
  raw: string,
  parameter: string,
  errors: ProblemError[]
): Value | Value[] | undefined {
  if (operator === 'null') {
    const value = coerceBoolean(raw);
    if (value === undefined) {
      errors.push({ parameter, detail: `expected true or false, got '${raw}'` });
      return undefined;
    }
    return value;
  }

  if (operator === 'like' || operator === 'ilike') {
    return raw;
  }

  if (operator === 'in' || operator === 'notIn') {
    const parts = raw.split(',');
    if (raw === '') {
      errors.push({ parameter, detail: 'expected at least one value' });
      return undefined;
    }
    const values: Value[] = [];
    for (const part of parts) {
      const value = coerce(filter.field, part, parameter, errors);
      if (value === undefined) return undefined;
      values.push(value);
    }
    return values;
  }

  return coerce(filter.field, raw, parameter, errors);
}

/**
 * Turns a query-string value into something the column accepts, rejecting
 * anything malformed here so it never reaches sqlex, which would raise a plain
 * Error and turn a client mistake into a 500.
 */
function coerce(
  field: SimpleField,
  raw: string,
  parameter: string,
  errors: ProblemError[]
): Value | undefined {
  const target = referenced(field);
  const kind = classifyColumn(target);
  const reject = (expected: string): undefined => {
    errors.push({ parameter, detail: `expected ${expected}, got '${raw}'` });
    return undefined;
  };

  switch (kind) {
    case 'integer': {
      if (!/^-?\d+$/.test(raw)) return reject('an integer');
      const value = Number(raw);
      return Number.isSafeInteger(value) ? value : reject('an integer within 2^53');
    }
    case 'number': {
      // An exact decimal stays a string so its precision survives the trip.
      if (isDecimal(target)) {
        return /^-?\d+(\.\d+)?$/.test(raw) ? raw : reject('a decimal number');
      }
      const value = Number(raw);
      return Number.isFinite(value) ? value : reject('a number');
    }
    case 'boolean': {
      const value = coerceBoolean(raw);
      return value === undefined ? reject('true or false') : value;
    }
    case 'datetime':
    case 'date': {
      const value = new Date(raw);
      return Number.isNaN(value.getTime()) ? reject(`a ${kind}`) : value;
    }
    case 'enum': {
      const values = target.column.userDefinedType?.values;
      if (values?.length && !values.includes(raw)) {
        return reject(`one of ${values.join(', ')}`);
      }
      return raw;
    }
    case 'string':
      return raw;
    case 'time':
    case 'json':
    case 'vector':
    case 'unknown':
      return reject('a filterable column');
  }
}

function coerceBoolean(raw: string): boolean | undefined {
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return undefined;
}

function parseFields<TContext>(
  resource: ResourcePlan<TContext>,
  params: URLSearchParams,
  errors: ProblemError[]
): SimpleField[] {
  const raw = params.get('fields');
  if (raw === null) return resource.readFields;

  const names = raw.split(',').filter(name => name !== '');
  if (!names.length) {
    errors.push({ parameter: 'fields', detail: 'expected at least one column' });
    return resource.readFields;
  }

  const selected: SimpleField[] = [];
  for (const name of names) {
    const field = resource.readFields.find(entry => entry.name === name);
    if (!field) {
      errors.push({ parameter: 'fields', detail: `'${name}' is not a readable column` });
      continue;
    }
    if (!selected.includes(field)) selected.push(field);
  }
  return selected.length ? selected : resource.readFields;
}

function parseIncludes<TContext>(
  plan: ApiPlan<TContext>,
  resource: ResourcePlan<TContext>,
  params: URLSearchParams,
  errors: ProblemError[]
): IncludeNode[] {
  const raw = params.get('include');
  if (raw === null) return [];

  const roots: IncludeNode[] = [];
  for (const path of raw.split(',').filter(entry => entry !== '')) {
    const segments = path.split('.');
    if (segments.length > resource.includeMaxDepth) {
      errors.push({
        parameter: 'include',
        detail: `'${path}' is deeper than the limit of ${resource.includeMaxDepth}`,
      });
      continue;
    }

    let current = resource;
    let siblings = roots;
    for (const segment of segments) {
      const include = current.includes.find(entry => entry.name === segment);
      if (!include) {
        errors.push({
          parameter: 'include',
          detail: `'${segment}' is not an includable relation of ${current.name}`,
        });
        break;
      }
      const target = plan.resource(include.target);
      if (!target) break;

      let node = siblings.find(entry => entry.include === include);
      if (!node) {
        node = { include, children: [] };
        siblings.push(node);
      }
      siblings = node.children;
      current = target;
    }
  }
  return roots;
}

function parseSort<TContext>(
  resource: ResourcePlan<TContext>,
  params: URLSearchParams,
  errors: ProblemError[]
): string[] {
  const raw = params.get('sort');
  if (raw === null) return resource.defaultSort;

  const orderBy: string[] = [];
  for (const entry of raw.split(',').filter(value => value !== '')) {
    const descending = entry.startsWith('-');
    const path = descending ? entry.slice(1) : entry;
    if (!resource.sorts.some(sort => sort.path === path)) {
      errors.push({ parameter: 'sort', detail: `'${path}' is not a sortable column` });
      continue;
    }
    orderBy.push(entry);
  }
  return orderBy.length ? orderBy : resource.defaultSort;
}

function parsePage<TContext>(
  resource: ResourcePlan<TContext>,
  params: URLSearchParams,
  errors: ProblemError[]
): { limit: number; offset: number; total: boolean } {
  const limit = parseCount(params.get('limit'), 'limit', resource.page.defaultLimit, errors);
  const offset = parseCount(params.get('offset'), 'offset', 0, errors);
  const rawTotal = params.get('total');
  let total = false;
  if (rawTotal !== null) {
    const value = coerceBoolean(rawTotal);
    if (value === undefined) {
      errors.push({ parameter: 'total', detail: `expected true or false, got '${rawTotal}'` });
    } else {
      total = value;
    }
  }

  return {
    // A limit over the maximum is clamped rather than rejected, so a client
    // asking for everything gets a page instead of an error.
    limit: Math.min(limit, resource.page.maxLimit),
    offset,
    total,
  };
}

function parseCount(
  raw: string | null,
  parameter: string,
  fallback: number,
  errors: ProblemError[]
): number {
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw)) {
    errors.push({ parameter, detail: `expected a whole number, got '${raw}'` });
    return fallback;
  }
  const value = Number(raw);
  if (parameter === 'limit' && value < 1) {
    errors.push({ parameter, detail: 'expected at least 1' });
    return fallback;
  }
  return value;
}

/** A foreign key is addressed by the value of the column it points at. */
function referenced(field: SimpleField): SimpleField {
  return field instanceof ForeignKeyField ? field.referencedField : field;
}

function isDecimal(field: SimpleField): boolean {
  return /^(decimal|numeric)/i.test(field.column.type);
}


/**
 * Validates a request body against the write policy. Values are checked here so
 * nothing malformed reaches sqlex, and a relation is only accepted as a key
 * value: an object would be taken as a nested mutation and written without ever
 * having been authorised.
 */
export function parseWriteBody<TContext>(
  resource: ResourcePlan<TContext>,
  body: unknown,
  mode: 'create' | 'update'
): Document {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw ApiError.badRequest([{ parameter: 'body', detail: 'expected a JSON object' }]);
  }

  const errors: ProblemError[] = [];
  const given = body as { [key: string]: unknown };
  const data: Document = {};

  for (const name of Object.keys(given)) {
    const field = resource.writeFields.find(entry => entry.name === name);
    if (!field) {
      errors.push({ parameter: name, detail: `'${name}' is not a writable column` });
      continue;
    }
    const value = writeValue(field, given[name], name, errors);
    if (value !== undefined) data[name] = value;
  }

  if (mode === 'create') {
    for (const field of resource.writeFields) {
      // Only a column that was left out is missing; one whose value was rejected
      // has already been reported, and saying both would be noise.
      if (isRequiredOnCreate(field) && !(field.name in given)) {
        errors.push({ parameter: field.name, detail: `'${field.name}' is required` });
      }
    }
  } else if (Object.keys(data).length === 0 && !errors.length) {
    errors.push({ parameter: 'body', detail: 'expected at least one column to change' });
  }

  if (errors.length) throw ApiError.badRequest(errors);
  return data;
}

function writeValue(
  field: SimpleField,
  value: unknown,
  parameter: string,
  errors: ProblemError[]
): DocumentValue | undefined {
  const reject = (expected: string): undefined => {
    errors.push({ parameter, detail: `expected ${expected}` });
    return undefined;
  };

  if (value === null) {
    return isNullableField(field) ? null : reject('a value, because the column is not nullable');
  }

  // A foreign key is set by the value of the column it points at. An object
  // here would be a nested create or connect, which is not supported.
  if (field instanceof ForeignKeyField) {
    if (typeof value === 'object') return reject('a key value, not an object');
    return writeValue(field.referencedField, value, parameter, errors);
  }

  const kind = classifyColumn(field);
  switch (kind) {
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value)
        ? value
        : reject('a whole number');
    case 'number':
      if (/^(decimal|numeric)/i.test(field.column.type)) {
        // The wire type is a string, but a number is unambiguous too.
        if (typeof value === 'number') return value;
        return typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)
          ? value
          : reject('a decimal, as a string or a number');
      }
      return typeof value === 'number' && Number.isFinite(value) ? value : reject('a number');
    case 'boolean':
      return typeof value === 'boolean' ? value : reject('true or false');
    case 'string':
      if (typeof value !== 'string') return reject('a string');
      return field.column.size && value.length > field.column.size
        ? reject(`at most ${field.column.size} characters`)
        : value;
    case 'enum': {
      if (typeof value !== 'string') return reject('a string');
      const values = field.column.userDefinedType?.values;
      return values?.length && !values.includes(value)
        ? reject(`one of ${values.join(', ')}`)
        : value;
    }
    case 'datetime':
    case 'date': {
      if (typeof value !== 'string') return reject(`a ${kind} as a string`);
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? reject(`a valid ${kind}`) : parsed;
    }
    case 'vector': {
      if (!Array.isArray(value) || value.some(entry => typeof entry !== 'number')) {
        return reject('an array of numbers');
      }
      const dimensions = field.column.dimensions;
      return dimensions !== undefined && value.length !== dimensions
        ? reject(`${dimensions} numbers`)
        : (value as number[]);
    }
    case 'json':
      return value as JsonValue;
    case 'time':
    case 'unknown':
      return reject('a writable column');
  }
}
