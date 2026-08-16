import { Database, SelectOptions } from '../database';
import { Connection } from '../engine';
import { ForeignKeyField, SimpleField } from '../schema';
import { Document, DocumentValue, Value } from '../types';
import { dateToString } from '../utils';
import { classifyColumn } from './column';
import { CursorEntry, cursorFilter, cursorSpec, decodeCursor, encodeCursor, orderByOf } from './cursor';
import { ApiError, writeError } from './errors';
import { AggregateRequest, IncludeNode, ReadRequest } from './params';
import { ApiPlan, ResourcePlan } from './plan';

export interface PageMeta {
  limit: number;
  offset?: number;
  total?: number;
  /** The cursor naming the next page, present while there is one. */
  next?: string;
}

export interface ListResult {
  data: Document[];
  meta: PageMeta;
}

export async function readList<TContext>(
  db: Database,
  plan: ApiPlan<TContext>,
  resource: ResourcePlan<TContext>,
  request: ReadRequest,
  context: TContext
): Promise<ListResult> {
  const table = db.table(resource.model);
  const where = await scoped(resource, request.where, context);

  // The total order behind cursor pagination: the sort plus the primary key.
  // When it exists the query follows it and fetches one row beyond the page,
  // whose presence is what says there is a next page.
  const spec = cursorSpec(resource, request.orderBy);
  const options: SelectOptions = {
    where,
    limit: spec ? request.limit + 1 : request.limit,
    offset: request.offset,
  };
  if (spec) options.orderBy = orderByOf(spec);
  else if (request.orderBy.length) options.orderBy = request.orderBy;

  let thunk;
  if (request.cursor !== undefined) {
    if (!spec) {
      throw ApiError.badRequest([
        { parameter: 'cursor', detail: 'this sort order cannot be paginated by cursor' },
      ]);
    }
    const values = decodeCursor(spec, request.cursor);
    thunk = () => cursorFilter(table, spec, values);
  }

  const rows = await table.select<Document>(
    await fieldSpec(plan, resource, request.fields, request.includes, context, spec),
    options,
    thunk
  );
  await enforceReferenceScopes(db, plan, request.includes, rows, context);

  const meta: PageMeta = { limit: request.limit };
  if (request.cursor === undefined) meta.offset = request.offset;
  if (spec && rows.length > request.limit) {
    rows.length = request.limit;
    meta.next = encodeCursor(spec, rows[rows.length - 1]);
  }
  if (request.total) meta.total = await table.count(where);

  return {
    data: await Promise.all(
      rows.map(row => serialiseRow(plan, resource, request.fields, request.includes, row, context))
    ),
    meta,
  };
}

/** Runs an aggregate through the same scope every read gets. */
export async function readAggregate<TContext>(
  db: Database,
  resource: ResourcePlan<TContext>,
  request: AggregateRequest,
  context: TContext
): Promise<ListResult> {
  const table = db.table(resource.model);
  const where = await scoped(resource, request.where, context);

  const expressions: string[] = [];
  const groupBy: string[] = [];
  for (const field of request.groupBy) {
    expressions.push(field.name);
    groupBy.push(field.name);
  }
  if (request.count) expressions.push('count(*) as __count');
  for (const [fn, fields] of Object.entries(request.functions)) {
    for (const field of fields) {
      expressions.push(`${fn}(${field.name}) as __${fn}_${field.name}`);
    }
  }

  const options: SelectOptions = { where, limit: request.limit, offset: request.offset };
  if (groupBy.length) {
    options.groupBy = groupBy;
    // Grouped rows come back in a stable order, so their pages are stable too.
    options.orderBy = groupBy;
  }

  const rows = await table.select<Document>(expressions, options);

  const data = rows.map(row => {
    const entry: Document = {};
    if (request.groupBy.length) {
      const group: Document = {};
      for (const field of request.groupBy) {
        group[field.name] = serialiseValue(field, row[field.name] as DocumentValue);
      }
      entry.group = group;
    }
    // count comes back as a string from postgres, so it is made a number here;
    // sum and avg follow, since an exact total no longer has the column's scale.
    if (request.count) entry.count = Number(row.__count);
    for (const [fn, fields] of Object.entries(request.functions)) {
      if (!fields.length) continue;
      const values: Document = {};
      for (const field of fields) {
        const value = row[`__${fn}_${field.name}`] as DocumentValue;
        values[field.name] =
          value === null || value === undefined
            ? null
            : fn === 'sum' || fn === 'avg'
            ? Number(value)
            : serialiseValue(field, value);
      }
      entry[fn] = values;
    }
    return entry;
  });

  return { data, meta: { limit: request.limit, offset: request.offset } };
}

export async function readItem<TContext>(
  db: Database,
  plan: ApiPlan<TContext>,
  resource: ResourcePlan<TContext>,
  identity: Document,
  request: ReadRequest,
  context: TContext,
  connection?: Connection
): Promise<Document | undefined> {
  const table = db.table(resource.model);
  // A select with a limit rather than get(), because the scope filter is ANDed
  // in and get() only accepts a filter that is on its own a unique key.
  const rows = await table.select<Document>(
    await fieldSpec(plan, resource, request.fields, request.includes, context),
    { where: await scoped(resource, identity, context), limit: 1 },
    undefined,
    connection
  );
  if (!rows[0]) return undefined;
  await enforceReferenceScopes(db, plan, request.includes, rows, context);
  return serialiseRow(plan, resource, request.fields, request.includes, rows[0], context);
}

/**
 * Adds the resource's scope to a filter. The two are wrapped in `and` rather
 * than merged, so a client filter containing `or` cannot widen the result past
 * the scope.
 *
 * An empty object is no restriction at all — the super-user case — and an
 * empty array is its opposite: a list of alternatives that came out empty
 * admits nothing, so a lookup that found no accessible tenants fails closed.
 */
async function scoped<TContext>(
  resource: ResourcePlan<TContext>,
  where: Document,
  context: TContext
): Promise<Document> {
  if (!resource.scope) return where;
  const scope = await resource.scope(context);

  let filter: Document;
  if (Array.isArray(scope)) {
    filter = scope.length ? { or: scope } : denyAll(resource);
  } else if (Object.keys(scope).length === 0) {
    return where;
  } else {
    filter = scope;
  }

  if (!Object.keys(where).length) return filter;
  return { and: [filter, where] };
}

/**
 * A filter no row satisfies, built from a column being both null and not null,
 * which every engine evaluates without special syntax.
 */
function denyAll<TContext>(resource: ResourcePlan<TContext>): Document {
  const field =
    resource.model.keyField() ??
    resource.model.fields.find((entry): entry is SimpleField => entry instanceof SimpleField);
  const name = field ? field.name : 'id';
  return { and: [{ [`${name}_null`]: true }, { [`${name}_null`]: false }] };
}

/**
 * The sqlex select spec. Every column is selected by default, so a field is
 * dropped by naming it with a falsy value; relations are added by name. Hidden
 * columns are therefore never even queried, not merely filtered out of the
 * response.
 *
 * An embedded relation is filtered by its own resource's scope: reaching rows
 * through another resource must not see more than reading them directly would.
 * A foreign-key expansion cannot take a filter, so scoped references are
 * handled after the read by enforceReferenceScopes.
 */
async function fieldSpec<TContext>(
  plan: ApiPlan<TContext>,
  resource: ResourcePlan<TContext>,
  fields: SimpleField[],
  includes: IncludeNode[],
  context: TContext,
  cursor?: CursorEntry[]
): Promise<Document> {
  const spec: Document = {};

  for (const field of resource.model.fields) {
    if (field instanceof SimpleField && !fields.includes(field)) {
      // A sort column stays selected even when the response leaves it out,
      // because the next-page cursor is built from its values; the serialiser
      // walks only the requested fields, so it never reaches the client.
      if (cursor?.some(entry => entry.field === field)) continue;
      spec[field.name] = false;
    }
  }

  for (const node of includes) {
    const target = plan.resource(node.include.target);
    if (!target) continue;
    const nested = await fieldSpec(plan, target, target.readFields, node.children, context);
    if (node.include.field instanceof ForeignKeyField) {
      spec[node.include.name] = nested;
    } else {
      const options: Document = { fields: nested };
      if (node.include.limit !== undefined) options.limit = node.include.limit;
      if (target.scope) {
        const where = await scoped(target, {}, context);
        // An unrestricted scope resolves to nothing to filter by.
        if (Object.keys(where).length) options.where = where;
      }
      spec[node.include.name] = options;
    }
  }

  return spec;
}

/**
 * Holds expanded foreign keys to their target's scope. The expansion itself is
 * a join sqlex cannot filter per relation, so afterwards the rows the scope
 * does not admit are reduced back to the bare reference a request without the
 * include would have received: the parent legitimately holds the key, but not
 * the row behind it.
 */
async function enforceReferenceScopes<TContext>(
  db: Database,
  plan: ApiPlan<TContext>,
  includes: IncludeNode[],
  rows: Document[],
  context: TContext
): Promise<void> {
  for (const node of includes) {
    const target = plan.resource(node.include.target);
    if (!target) continue;

    // An unrestricted scope resolves to nothing to withhold.
    const restriction =
      node.include.field instanceof ForeignKeyField && target.scope
        ? await scoped(target, {}, context)
        : {};
    if (Object.keys(restriction).length) {
      const key = (node.include.field as ForeignKeyField).referencedField;
      const expanded = rows.filter(row => isExpandedRow(row[node.include.name]));
      const values = [
        ...new Set(
          expanded.map(row => (row[node.include.name] as Document)[key.name] as Value)
        ),
      ].filter(value => value !== null && value !== undefined);

      if (values.length) {
        const admitted = await db.table(target.model).select<Document>(
          [key.name],
          { where: { and: [restriction, { [`${key.name}_in`]: values }] } }
        );
        const allowed = new Set(admitted.map(row => row[key.name] as Value));
        for (const row of expanded) {
          const value = (row[node.include.name] as Document)[key.name] as Value;
          if (!allowed.has(value)) {
            row[node.include.name] = { [key.name]: value };
          }
        }
      }
    }

    if (node.children.length) {
      const next: Document[] = [];
      for (const row of rows) {
        const value = row[node.include.name];
        if (Array.isArray(value)) {
          for (const entry of value) {
            if (isExpandedRow(entry)) next.push(entry as Document);
          }
        } else if (isExpandedRow(value)) {
          next.push(value as Document);
        }
      }
      if (next.length) await enforceReferenceScopes(db, plan, node.children, next, context);
    }
  }
}

/** An embedded row, as opposed to a bare {key} reference, null, or a scalar. */
function isExpandedRow(value: DocumentValue | undefined): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    Object.keys(value as Document).length > 1
  );
}

/**
 * Builds the response object from a row, walking the policy rather than the
 * row, so a column the policy does not expose cannot appear even if the query
 * returned it. Each resource's afterRead runs on its own rows at every level,
 * over the serialised shape, so a redaction cannot be reached around through an
 * include or a write response.
 */
async function serialiseRow<TContext>(
  plan: ApiPlan<TContext>,
  resource: ResourcePlan<TContext>,
  fields: SimpleField[],
  includes: IncludeNode[],
  row: Document,
  context: TContext
): Promise<Document> {
  const result: Document = {};

  for (const field of fields) {
    const value = row[field.name];
    if (value === undefined) continue;
    result[field.name] =
      field instanceof ForeignKeyField && !includes.some(node => node.include.name === field.name)
        ? reference(field, value)
        : serialiseValue(field, value);
  }

  for (const node of includes) {
    const target = plan.resource(node.include.target);
    if (!target) continue;
    const value = row[node.include.name];
    if (value === undefined) continue;
    if (value === null) {
      result[node.include.name] = null;
      continue;
    }
    const serialise = (entry: Document) =>
      serialiseRow(plan, target, target.readFields, node.children, entry, context);
    result[node.include.name] = Array.isArray(value)
      ? await Promise.all((value as Document[]).map(serialise))
      : await serialise(value as Document);
  }

  if (resource.afterRead) {
    return (await resource.afterRead(context, result)) ?? result;
  }
  return result;
}

/** An unexpanded foreign key comes back carrying only the referenced key. */
function reference(field: ForeignKeyField, value: DocumentValue): DocumentValue {
  if (value === null) return null;
  const key = field.referencedField;
  if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
    const inner = (value as Document)[key.name];
    return inner === undefined ? null : { [key.name]: serialiseValue(key, inner) };
  }
  return { [key.name]: serialiseValue(key, value) };
}

function serialiseValue(field: SimpleField, value: DocumentValue): DocumentValue {
  if (value === null || value === undefined) return null;

  // postgres pads char(n) values with spaces, which reach here unnormalised
  // when a row was read raw, as an aggregate's are.
  if (typeof value === 'string' && /^(bp)?char$/i.test(field.column.type)) {
    return value.replace(/ +$/, '');
  }

  switch (classifyColumn(field)) {
    case 'number':
      // An exact decimal is a string on the wire; only sqlite hands back a
      // number, and JSON cannot carry its precision.
      return /^(decimal|numeric)/i.test(field.column.type) ? decimalString(field, value) : value;
    case 'date':
      return value instanceof Date ? dateOnly(value) : value;
    case 'datetime':
      return value instanceof Date ? value.toISOString() : value;
    default:
      return value;
  }
}

/**
 * mysql and postgres return an exact decimal already rendered to the column's
 * scale; sqlite returns a number, whose default rendering would drop trailing
 * zeros and make the same row read differently per engine.
 */
function decimalString(field: SimpleField, value: DocumentValue): string {
  const { scale } = field.column;
  if (typeof value === 'number' && scale !== undefined && Number.isFinite(value)) {
    return value.toFixed(scale);
  }
  return String(value);
}

/**
 * A date column holds no time, so the driver builds it as midnight in some
 * zone: UTC for mysql and sqlite, local for postgres. Reading the parts of
 * whichever zone that was keeps the calendar day intact, which plain JSON
 * serialisation would not.
 */
function dateOnly(value: Date): string {
  const utcMidnight =
    value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0;
  return dateToString(value, utcMidnight);
}


/**
 * Creates a row and returns it as a read would. The write and the check that
 * follows it share one transaction, so a row that the scope would not admit is
 * rolled back rather than left behind.
 */
export async function createRow<TContext>(
  db: Database,
  plan: ApiPlan<TContext>,
  resource: ResourcePlan<TContext>,
  data: Document,
  context: TContext
): Promise<{ row: Document; identity: Document }> {
  const body = data;
  const stamps = resource.assign ? await resource.assign(context, 'create') : {};
  data = { ...data, ...stamps };
  data = await beforeWrite(resource, context, 'create', data, body);
  return write(() =>
    db.transaction(async connection => {
      const table = db.table(resource.model);
      await assertReferencesAdmitted(db, plan, resource, data, body, stamps, context, connection);
      const created = await table.create<Document>(data, undefined, connection);
      const identity = identityOf(resource, created);
      const row = await readItem(db, plan, resource, identity, bareRequest(resource), context, connection);
      if (!row) throw outsideScope('created row');
      return { row, identity };
    })
  );
}

export async function updateRow<TContext>(
  db: Database,
  plan: ApiPlan<TContext>,
  resource: ResourcePlan<TContext>,
  identity: Document,
  data: Document,
  context: TContext
): Promise<Document> {
  const body = data;
  const stamps = resource.assign ? await resource.assign(context, 'update') : {};
  data = { ...data, ...stamps };
  return write(() =>
    db.transaction(async connection => {
      const table = db.table(resource.model);
      const where = await scoped(resource, identity, context);

      // Only rows the scope admits are touched, and the row has to be there
      // before the write so that a missing one is not reported as a rejection.
      const existing = await table.select<Document>('*', { where, limit: 1 }, undefined, connection);
      if (!existing.length) throw ApiError.notFound(missing(resource, identity));

      // With the current row in hand, and inside the transaction, so a refusal
      // leaves nothing behind.
      data = await beforeWrite(resource, context, 'update', data, body, existing[0]);

      await assertReferencesAdmitted(db, plan, resource, data, body, stamps, context, connection);
      await table.update(data, where, connection);

      const row = await readItem(db, plan, resource, identity, bareRequest(resource), context, connection);
      if (!row) throw outsideScope('change');
      return row;
    })
  );
}

export async function deleteRow<TContext>(
  db: Database,
  plan: ApiPlan<TContext>,
  resource: ResourcePlan<TContext>,
  identity: Document,
  context: TContext
): Promise<void> {
  await write(() =>
    db.transaction(async connection => {
      const table = db.table(resource.model);
      const where = await scoped(resource, identity, context);
      const existing = await table.select<Document>('*', { where, limit: 1 }, undefined, connection);
      if (!existing.length) throw ApiError.notFound(missing(resource, identity));
      await beforeWrite(resource, context, 'delete', {}, {}, existing[0]);
      await table.delete(where, connection);
    })
  );
}

/**
 * A client-named reference must point at a row its target's scope admits:
 * writing a relationship to another tenant's row is refused just as reading
 * one is withheld. Only references the client itself supplied are checked —
 * an `assign` stamp is the developer speaking, like the scope itself — and
 * the refusal carries the same message as a dangling reference, so it does
 * not confirm that the row exists.
 */
async function assertReferencesAdmitted<TContext>(
  db: Database,
  plan: ApiPlan<TContext>,
  resource: ResourcePlan<TContext>,
  data: Document,
  body: Document,
  stamps: Document,
  context: TContext,
  connection: Connection
): Promise<void> {
  for (const field of resource.model.fields) {
    if (!(field instanceof ForeignKeyField)) continue;
    if (!(field.name in body) || field.name in stamps) continue;
    const value = data[field.name];
    if (value === null || value === undefined) continue;

    const target = plan.resource(field.referencedField.model);
    if (!target?.scope) continue;
    const restriction = await scoped(target, {}, context);
    if (!Object.keys(restriction).length) continue;

    const key = field.referencedField;
    const admitted = await db.table(target.model).select<Document>(
      [key.name],
      { where: { and: [restriction, { [key.name]: value as Value }] }, limit: 1 },
      undefined,
      connection
    );
    if (!admitted.length) {
      throw ApiError.unprocessable('A referenced row does not exist, or is still referenced');
    }
  }
}

/** Runs the resource's value-level rules; a returned document replaces the data. */
async function beforeWrite<TContext>(
  resource: ResourcePlan<TContext>,
  context: TContext,
  operation: 'create' | 'update' | 'delete',
  data: Document,
  body: Document,
  row?: Document
): Promise<Document> {
  if (!resource.beforeWrite) return data;
  return (await resource.beforeWrite(context, { operation, data, body, row })) ?? data;
}

/** Runs a write, translating a refused one into the status that describes it. */
async function write<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const translated = writeError(error);
    if (translated) throw translated;
    throw error;
  }
}

function outsideScope(what: string): ApiError {
  return ApiError.unprocessable(`The ${what} would fall outside the rows this request can reach`);
}

function missing<TContext>(resource: ResourcePlan<TContext>, identity: Document): string {
  const values = Object.values(identity).map(value => String(value)).join(', ');
  return `No ${resource.name} with ${Object.keys(identity).join(', ')} ${values}`;
}

/** The row's own identity, for reading it back after a write. */
function identityOf<TContext>(resource: ResourcePlan<TContext>, row: Document): Document {
  const identity: Document = {};
  for (const field of resource.identity?.fields ?? []) {
    const value = row[field.name];
    identity[field.name] =
      value && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value)
        ? ((value as Document)[
            (field as unknown as { referencedField?: SimpleField }).referencedField?.name ?? 'id'
          ] ?? null)
        : (value ?? null);
  }
  return identity;
}

/** A write reads its row back under the resource's own policy, nothing narrower. */
function bareRequest<TContext>(resource: ResourcePlan<TContext>): ReadRequest {
  return {
    where: {},
    fields: resource.readFields,
    includes: [],
    orderBy: [],
    limit: 1,
    offset: 0,
    total: false,
  };
}
