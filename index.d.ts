export type Value = string | number | boolean | Date | null;

export enum DataType {
  BOOLEAN,
  INT,
  FLOAT,
  CHAR,
  TEXT,
  DATE,
  DATETIME,
  BINARY
}

export interface ColumnInfo {
  name: string;
  type: DataType;
  size?: number;
  nullable?: boolean;
  autoIncrement?: boolean;
  default?: Value;
}

export interface FieldInfo extends ColumnInfo {
  title: string;
  comment: string;
  value?: Value;
}
