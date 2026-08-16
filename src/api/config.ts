import { Filter } from '../database';
import { Document } from '../types';

/** Operations a resource can expose. */
export type Operation = 'list' | 'get' | 'create' | 'update' | 'delete' | 'aggregate';

export const OPERATIONS: readonly Operation[] = [
  'list',
  'get',
  'create',
  'update',
  'delete',
  'aggregate',
];

/** Reads are exposed when `operations` is not given; writes are opted into. */
export const DEFAULT_OPERATIONS: readonly Operation[] = ['list', 'get'];

/** Filter operators usable in a request, a subset of the sqlex filter language. */
export type ApiFilterOperator =
  | 'eq'
  | 'ne'
  | 'lt'
  | 'le'
  | 'ge'
  | 'gt'
  | 'in'
  | 'notIn'
  | 'like'
  | 'ilike'
  | 'null';

export const API_FILTER_OPERATORS: readonly ApiFilterOperator[] = [
  'eq',
  'ne',
  'lt',
  'le',
  'ge',
  'gt',
  'in',
  'notIn',
  'like',
  'ilike',
  'null',
];

/**
 * Operators allowed when a resource doesn't name its own. `like`/`ilike` are
 * excluded: a leading-wildcard pattern on an unindexed column is a scan, so it
 * has to be asked for.
 */
export const DEFAULT_FILTER_OPERATORS: readonly ApiFilterOperator[] = [
  'eq',
  'ne',
  'lt',
  'le',
  'ge',
  'gt',
  'in',
  'notIn',
  'null',
];

/** A filter ANDed into every read of a resource. */
export type ScopeFn<TContext> = (context: TContext) => Filter | Promise<Filter>;

/**
 * Values the server sets on a write, keyed by field name. They are applied
 * after the body is validated and override anything the client sent, so a
 * tenant column comes from the request's identity rather than from the
 * client's say-so.
 *
 * `operation` distinguishes the two writes, so one function can stamp a
 * created-at on create and a modified-at on update without touching the other.
 */
export type AssignFn<TContext> = (
  context: TContext,
  operation: 'create' | 'update'
) => Document | Promise<Document>;

/**
 * Whether this request may perform the operation at all. Row-level access
 * belongs to `scope`; this gates the operation itself — an admin may change
 * products but not close the shop — and a refusal is a `403`.
 */
export type AuthorizeFn<TContext> = (
  context: TContext,
  operation: Operation
) => boolean | Promise<boolean>;

export interface WriteEvent {
  operation: 'create' | 'update' | 'delete';
  /** What would be written: the validated body with `assign` applied. */
  data: Document;
  /** The validated body as the client sent it, before `assign`. */
  body: Document;
  /** The stored row, as sqlex returns it, for update and delete. */
  row?: Document;
}

/**
 * Value-level rules, running after validation and `assign`, and for update and
 * delete inside the write's transaction with the current row in hand. Returning
 * a document replaces the data; throwing an ApiError refuses the write with
 * that status.
 */
export type BeforeWriteFn<TContext> = (
  context: TContext,
  write: WriteEvent
) => void | Document | Promise<void | Document>;

/**
 * Transforms a row as it is served — after serialisation, so wire shapes are
 * what it sees — wherever the row appears: lists, items, embedded relations and
 * write responses. Returning a document replaces the row. It changes values;
 * the shape stays the document's business.
 */
export type AfterReadFn<TContext> = (
  context: TContext,
  row: Document
) => void | Document | Promise<void | Document>;

export interface ReadSelection {
  /** Field names, or '*' for every column. Defaults to '*'. */
  fields?: string[] | '*';
  exclude?: string[];
}

export interface WriteSelection {
  /** Field names, or '*' for every column a client may set. */
  fields?: string[] | '*';
  exclude?: string[];
}

export interface AggregateSelection {
  /** Columns rows may be grouped by. */
  groupBy?: string[];
  /** Columns the aggregate functions may be applied to. */
  fields?: string[];
}

export interface FilterSelection {
  /** Field names, or dotted paths across foreign keys (`user.email`). */
  fields?: string[];
  operators?: ApiFilterOperator[];
}

export interface SortSelection {
  /** Field names, or dotted paths across foreign keys. */
  fields?: string[];
  /** Applied when the request doesn't sort; `-name` for descending. */
  default?: string[];
}

export interface IncludeSelection {
  /** Relation field names on this model, one hop each. */
  relations?: string[];
  /** Maximum number of hops in an `include` path. */
  maxDepth?: number;
  /** Row cap for an embedded collection. */
  limit?: number;
}

export interface PageOptions {
  defaultLimit?: number;
  maxLimit?: number;
}

export interface ResourceConfig<TContext = unknown> {
  /** Route segment. Defaults to the kebab-case plural model name. */
  path?: string;
  /** Shown in the document; defaults to the table's comment, where one exists. */
  description?: string;
  operations?: Operation[];
  read?: ReadSelection;
  write?: WriteSelection;
  aggregate?: AggregateSelection;
  filter?: FilterSelection;
  sort?: SortSelection;
  include?: IncludeSelection;
  page?: PageOptions;
  scope?: ScopeFn<TContext>;
  assign?: AssignFn<TContext>;
  authorize?: AuthorizeFn<TContext>;
  beforeWrite?: BeforeWriteFn<TContext>;
  afterRead?: AfterReadFn<TContext>;
}

/** Settings shared by every resource; each is overridable per resource. */
export interface ApiDefaults {
  operators?: ApiFilterOperator[];
  includeMaxDepth?: number;
  includeLimit?: number;
  page?: PageOptions;
}

export interface ApiConfig<TContext = unknown> {
  basePath?: string;
  /** Keyed by model name or table name. A model absent here is not exposed. */
  resources: { [model: string]: ResourceConfig<TContext> };
  defaults?: ApiDefaults;
}

export const DEFAULT_PAGE_LIMIT = 50;
export const DEFAULT_MAX_PAGE_LIMIT = 200;
export const DEFAULT_INCLUDE_MAX_DEPTH = 2;
