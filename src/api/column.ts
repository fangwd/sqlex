import { SimpleField } from '../schema';
import { ApiFilterOperator } from './config';

export type ColumnKind =
  | 'string'
  | 'enum'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'datetime'
  | 'date'
  | 'time'
  | 'json'
  | 'vector'
  | 'unknown';

/**
 * Maps a column's SQL type to the kind the API layer reasons about. Unlike
 * `getTypeName` in print.ts this never throws: an unrecognised type yields
 * 'unknown' so one exotic column can't stop a whole API from starting.
 */
export function classifyColumn(field: SimpleField): ColumnKind {
  if (field.column.userDefinedType?.type === 'enum') return 'enum';

  const type = field.column.type;
  if (/^vector/i.test(type)) return 'vector';
  if (/^json/i.test(type)) return 'json';
  if (/^bool/i.test(type)) return 'boolean';
  // MySQL reports an enum column as data_type 'enum' with no userDefinedType,
  // so the values aren't known here, only that it behaves like a string.
  if (/^enum/i.test(type)) return 'enum';
  if (/^(datetime|timestamp)/i.test(type)) return 'datetime';
  if (/^date/i.test(type)) return 'date';
  if (/^time/i.test(type)) return 'time';
  if (/^(tiny|small|medium|big)?int|^(big|small)?serial|^long/i.test(type)) return 'integer';
  if (/^(float|double|real|decimal|numeric)/i.test(type)) return 'number';
  if (/char|text|string|uuid/i.test(type)) return 'string';
  return 'unknown';
}

const ORDERED: ApiFilterOperator[] = ['eq', 'ne', 'lt', 'le', 'ge', 'gt', 'in', 'notIn'];
const TEXTUAL: ApiFilterOperator[] = ['eq', 'ne', 'in', 'notIn', 'like', 'ilike'];

/**
 * Operators that make sense for a column, before the configured allow-list is
 * applied. An empty result means the column can't be filtered at all.
 */
export function operatorsForKind(kind: ColumnKind, nullable: boolean): ApiFilterOperator[] {
  let operators: ApiFilterOperator[];
  switch (kind) {
    case 'string':
    case 'enum':
      operators = [...TEXTUAL];
      break;
    case 'integer':
    case 'number':
    case 'datetime':
    case 'date':
      operators = [...ORDERED];
      break;
    case 'boolean':
      operators = ['eq', 'ne'];
      break;
    // Filtering into a json document needs its own path syntax, which the
    // request layer doesn't parse yet. A time column is left out for a
    // different reason: the engines neither store nor return one consistently
    // (see tests/api-types.test.ts), so a comparison could match the wrong
    // rows. Ordering by one is still fine.
    case 'time':
    case 'json':
    case 'vector':
    case 'unknown':
      return [];
  }
  if (nullable) operators.push('null');
  return operators;
}

export function isSortable(kind: ColumnKind): boolean {
  return kind !== 'vector' && kind !== 'json' && kind !== 'unknown';
}

/** Whether sum and avg make sense for a column. */
export function isSummable(kind: ColumnKind): boolean {
  return kind === 'integer' || kind === 'number';
}

/**
 * Whether a client may set a column. A time column is excluded for the same
 * reason it cannot be filtered: sqlex builds a Date from the value, which needs
 * a full timestamp, and the engines disagree on what comes back.
 */
export function isWritable(kind: ColumnKind): boolean {
  return kind !== 'time' && kind !== 'unknown';
}

/** Whether a create must supply the column: NOT NULL with nothing to fall back on. */
export function isRequiredOnCreate(field: SimpleField): boolean {
  return (
    !field.column.autoIncrement &&
    field.column.default === undefined &&
    !isNullableField(field)
  );
}

/** Mirrors `isNullable` in print.ts: a primary key is never nullable. */
export function isNullableField(field: SimpleField): boolean {
  return field.column.nullable !== false && !field.uniqueKey?.primary;
}
