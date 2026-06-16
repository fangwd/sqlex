export interface Database {
  name: string;
  tables: Table[];
}

export interface Table {
  name: string;
  columns: Column[];
  constraints: Constraint[];
}

export type ScalarValue = string | number | boolean | Date | null;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type Value = ScalarValue;

export type DocumentValue = Value | JsonValue | Value[] | JsonValue[] | Document | Document[];

/**
 * A reference to a row by its primary key. Foreign-key fields on a generated
 * row type resolve to this for the common case of a single `id` column.
 */
export interface Identifiable<T extends string | number = number> {
  id: T;
}

export type Document = {
  [key: string]: DocumentValue;
};

export type AnyDocument = { [key: string]: any };

export type FilterOperator =
  | 'lt'
  | 'le'
  | 'ge'
  | 'gt'
  | 'ne'
  | 'in'
  | 'notIn'
  | 'like'
  | 'ilike'
  | 'null'
  | 'some'
  | 'none'
  | 'exists';

export type FilterValue<T> =
  | T
  | T[]
  | null
  | (NonNullable<T> extends object ? FilterShape<NonNullable<T>> | ScalarValue : never);

export type FilterShape<TRow extends object = Document> = {
  [K in keyof TRow & string]?: FilterValue<TRow[K]>;
} & {
  [K in keyof TRow & string as `${K}_${FilterOperator}`]?: FilterValue<TRow[K]>;
} & {
  and?: FilterShape<TRow> | FilterShape<TRow>[];
  or?: FilterShape<TRow> | FilterShape<TRow>[];
  not?: FilterShape<TRow> | FilterShape<TRow>[];
};

export type SelectFieldSpec<TRow extends object = Document> =
  | '*'
  | (keyof TRow & string)
  | {
      [K in keyof TRow & string]?: SelectFieldSpec<any> | RelatedSelectOptions<any>;
    };

export interface RelatedSelectOptions<TRow extends object = Document> {
  fields?: SelectFieldSpec<TRow> | string | string[];
  where?: FilterShape<TRow> | FilterShape<TRow>[];
  offset?: number;
  limit?: number;
  orderBy?: string | string[];
  groupBy?: string[];
  having?: FilterShape<any> | FilterShape<any>[];
}

export type SelectFields<TRow extends object = Document> =
  | '*'
  | (keyof TRow & string)
  | string
  | string[]
  | SelectFieldSpec<TRow>;

export interface MutationOptions<TReturn extends object = Document> {
  returning?: SelectFields<TReturn>;
}

export interface ParentMutation<
  TFilter extends object = Document,
  TCreate extends object = Document,
  TUpdate extends object = Partial<TCreate>
> {
  connect?: TFilter;
  create?: TCreate;
  update?: TUpdate;
}

export interface RelatedUpsert<
  TCreate extends object = Document,
  TUpdate extends object = Partial<TCreate>
> {
  create: TCreate;
  update?: TUpdate;
}

export interface RelatedUpdate<
  TFilter extends object = Document,
  TUpdate extends object = Document
> {
  where?: TFilter;
  data: TUpdate;
}

export interface RelatedMutation<
  TFilter extends object = Document,
  TCreate extends object = Document,
  TUpdate extends object = Partial<TCreate>
> {
  connect?: TFilter | TFilter[];
  create?: TCreate | TCreate[];
  upsert?: RelatedUpsert<TCreate, TUpdate> | RelatedUpsert<TCreate, TUpdate>[];
  update?: TUpdate | RelatedUpdate<TFilter, TUpdate> | Array<TUpdate | RelatedUpdate<TFilter, TUpdate>>;
  delete?: TFilter | TFilter[];
  disconnect?: TFilter | TFilter[];
  set?: TCreate | TCreate[];
}

export interface TableSpec<
  TRow extends object = Document,
  TCreate extends object = Partial<TRow>,
  TUpdate extends object = Partial<TCreate>,
  TFilter extends object = FilterShape<TRow>,
  TInsert extends object = TCreate
> {
  row: TRow;
  create: TCreate;
  update: TUpdate;
  filter: TFilter;
  insert: TInsert;
}

export type AnyTableSpec = TableSpec<AnyDocument, AnyDocument, AnyDocument, AnyDocument, AnyDocument>;
export type LooseTableSpec = TableSpec<Document, Document, Document, Document, Document>;
export type TableMap = { [key: string]: AnyTableSpec };

type IsAny<T> = 0 extends (1 & T) ? true : false;

export type TableRow<TSpec> = IsAny<TSpec> extends true
  ? Document
  : TSpec extends TableSpec<infer TRow, any, any, any, any> ? TRow : Document;
export type TableCreate<TSpec> = IsAny<TSpec> extends true
  ? Document
  : TSpec extends TableSpec<any, infer TCreate, any, any, any> ? TCreate : Document;
export type TableUpdate<TSpec> = IsAny<TSpec> extends true
  ? Document
  : TSpec extends TableSpec<any, any, infer TUpdate, any, any> ? TUpdate : Document;
export type TableFilter<TSpec> = IsAny<TSpec> extends true
  ? Document
  : TSpec extends TableSpec<any, any, any, infer TFilter, any> ? TFilter : Document;
export type TableInsert<TSpec> = IsAny<TSpec> extends true
  ? Document
  : TSpec extends TableSpec<any, any, any, any, infer TInsert> ? TInsert : Document;

export interface UserDefinedType {
  type: 'enum';
  name: string;
  values: string[];
};

export interface Column {
  name: string;
  type: string;
  size?: number;
  nullable?: boolean;
  autoIncrement?: boolean;
  default?: Value;
  userDefinedType?: UserDefinedType;
}

export interface Constraint {
  name?: string;
  columns: string[];
  primaryKey?: boolean;
  unique?: boolean;
  references?: ReferencedConstraint;
  isVirtual?: boolean;
}

export interface ReferencedConstraint extends Constraint {
  table: string;
}
