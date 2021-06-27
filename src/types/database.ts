export interface Database {
  name: string;
  tables: Table[];
}

export interface Table {
  name: string;
  columns: Column[];
  constraints: Constraint[];
}

export type Value = string | number | boolean | Date | null;

export type Document = {
  [key: string]: Value | Value[] | Document | Document[];
};

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
}

export interface ReferencedConstraint extends Constraint {
  table: string;
}
