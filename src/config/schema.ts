export interface Schema {
  tablePrefix?: RegExp;
  models: Model[];
}

export interface ClosureTable {
  name: string;
  fields?: {
    ancestor: string;
    descendant: string;
    depth: string;
  };
}

export interface Model {
  name?: string;
  table?: string;
  fields?: Field[];
  pluralName?: string;
  closureTable?: ClosureTable;
}

export interface Field {
  name?: string;
  column?: string;
  relatedName?: string;
  throughField?: string;
  userType?: string;
}

export const DEFAULT_SCHEMA: Schema = { models: [] };
export const DEFAULT_MODEL: Model = { fields: [] };
export const DEFAULT_FIELD: Field = {};

export const DEFAULT_CLOSURE_TABLE_FIELDS = {
  ancestor: 'ancestor',
  descendant: 'descendant',
  depth: 'depth'
};
