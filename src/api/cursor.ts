import { Table } from '../database';
import { ForeignKeyField, SimpleField } from '../schema';
import { Document, Value } from '../types';
import { ApiError } from './errors';
import { ResourcePlan } from './plan';

/** One sort entry a cursor walks: a local column and its direction. */
export interface CursorEntry {
  path: string;
  field: SimpleField;
  desc: boolean;
}

/**
 * The total order a cursor pages through: the requested sort with the primary
 * key appended as a tiebreaker, so two rows can never compare equal. Undefined
 * when no such order exists — the model has no primary key, or the sort crosses
 * a relation, whose value a page row does not carry.
 */
export function cursorSpec<TContext>(
  resource: ResourcePlan<TContext>,
  orderBy: string[]
): CursorEntry[] | undefined {
  if (!resource.identity) return undefined;

  const entries: CursorEntry[] = [];
  for (const entry of orderBy) {
    const desc = entry.startsWith('-');
    const path = desc ? entry.slice(1) : entry;
    if (path.includes('.')) return undefined;
    const field = resource.model.field(path);
    if (!(field instanceof SimpleField)) return undefined;
    entries.push({ path, field, desc });
  }

  // The tiebreakers follow the direction of the last requested entry, so a
  // plain descending sort pages backwards through the key as well.
  const desc = entries.length ? entries[entries.length - 1].desc : false;
  for (const field of resource.identity.fields) {
    if (!entries.some(entry => entry.field === field)) {
      entries.push({ path: field.name, field, desc });
    }
  }

  // The cursor carries the value of every column it orders by. Minting one for
  // a column the read policy hides would leak that value through the otherwise
  // opaque cursor, so pagination falls back to offset instead. Sorting by a
  // hidden column is still allowed; only the cursor is withheld. See the read
  // invariant at the top of runner.ts.
  if (entries.some(entry => !resource.readFields.includes(entry.field))) {
    return undefined;
  }

  return entries;
}

export function orderByOf(spec: CursorEntry[]): string[] {
  return spec.map(entry => (entry.desc ? `-${entry.path}` : entry.path));
}

/** The cursor naming a row: its values under the spec, fingerprinted to it. */
export function encodeCursor(spec: CursorEntry[], row: Document): string {
  const values = spec.map(entry => {
    let value = row[entry.field.name];
    // A foreign key reads back as a reference object carrying the key.
    if (entry.field instanceof ForeignKeyField && value && typeof value === 'object') {
      value = (value as Document)[entry.field.referencedField.name];
    }
    if (value instanceof Date) return value.toISOString();
    return value ?? null;
  });
  return Buffer.from(JSON.stringify([fingerprint(spec), values])).toString('base64url');
}

/**
 * Decodes a client-supplied cursor against the request's sort. The fingerprint
 * ties a cursor to the order it was minted under, so a page cannot continue
 * under a different sort; values are held to scalars so nothing structured
 * reaches the SQL builder.
 */
export function decodeCursor(spec: CursorEntry[], cursor: string): Value[] {
  const reject = (): never => {
    throw ApiError.badRequest([
      { parameter: 'cursor', detail: 'not a cursor from this sort order' },
    ]);
  };

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch {
    return reject();
  }
  if (!Array.isArray(decoded) || decoded.length !== 2) return reject();
  const [mark, values] = decoded as [unknown, unknown];
  if (mark !== fingerprint(spec)) return reject();
  if (!Array.isArray(values) || values.length !== spec.length) return reject();
  for (const value of values) {
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
      return reject();
    }
  }
  return values as Value[];
}

/**
 * The keyset filter selecting rows after the cursor under the spec's order:
 * rows beating the first column, or tying it and beating the second, and so on.
 * Values pass through the table's own escaping, so a tampered cursor can only
 * ever change which page comes back. Nulls follow sqlex's comparison order,
 * where an ascending null sorts before every value.
 */
export function cursorFilter(table: Table, spec: CursorEntry[], values: Value[]): string {
  return build(table, spec, values, 0) ?? '';
}

function build(
  table: Table,
  spec: CursorEntry[],
  values: Value[],
  index: number
): string | undefined {
  const entry = spec[index];
  const value = values[index];
  // Qualified with the table, whose alias in a sqlex select is its own name,
  // so a joined include cannot make the column ambiguous.
  const encoder = table.db.pool;
  const column =
    `${encoder.escapeId(table.model.table.name)}.${encoder.escapeId(entry.field.column.name)}`;
  const escaped = value === null ? 'null' : table.escapeValue(entry.field, value);

  let where: string | undefined;
  if (entry.desc) {
    if (value !== null) where = `${column} is null or ${column} < ${escaped}`;
  } else if (value === null) {
    where = `${column} is not null`;
  } else {
    where = `${column} > ${escaped}`;
  }

  if (index + 1 === spec.length) return where;

  const rest = build(table, spec, values, index + 1);
  const equal = value === null ? `${column} is null` : `${column} = ${escaped}`;
  return where ? `(${where}) or (${equal} and (${rest}))` : `${equal} and (${rest})`;
}

function fingerprint(spec: CursorEntry[]): string {
  return orderByOf(spec).join(',');
}
