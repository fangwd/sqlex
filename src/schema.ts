import * as types from './types';
import {
  Schema as SchemaConfig,
  Model as ModelConfig,
  Field as FieldConfig,
  DEFAULT_SCHEMA as DEFAULT_SCHEMA_CONFIG,
  DEFAULT_MODEL as DEFAULT_MODEL_CONFIG,
  DEFAULT_FIELD as DEFAULT_FIELD_CONFIG,
  DEFAULT_CLOSURE_TABLE_FIELDS
} from './config';
import { pluralise, toPascalCase, toCamelCase, lcfirst } from './utils';
import { sort } from './mock';

export class Schema {
  database: types.Database;
  config: SchemaConfig;
  models: Model[] = [];
  tablePrefix?: RegExp;

  private modelMap: Map<string, Model>;

  constructor(database: types.Database, config?: SchemaConfig) {
    this.database = database;
    this.config = { ...DEFAULT_SCHEMA_CONFIG, ...config };
    this.modelMap = new Map();

    if (this.config.tablePrefix) {
      this.tablePrefix = new RegExp(this.config.tablePrefix);
    }

    for (const table of database.tables) {
      const model = new Model(
        this,
        table,
        this.getModelConfig(this.deprefix(table.name))
      );
      this.addModel(model);
    }

    for (const model of this.models) {
      model.resolveConstraints();
    }

    for (const model of this.models) {
      model.resolveRelatedFields();
    }
  }

  get sort()  {
    return sort(this.models);
  };

  deprefix(name: string): string {
    return this.tablePrefix ? name.replace(this.tablePrefix, '') : name;
  }

  private getModelConfig(name: string) {
    return this.config.models.find(config => config.table === name);
  }

  private addModel(model: Model) {
    if (this.modelMap.has(model.name)) {
      throw Error(`Duplicate model name: ${model.name}`);
    }

    this.models.push(model);
    this.modelMap.set(model.name, model);

    if (model.table.name !== model.name) {
      if (this.modelMap.has(model.table.name)) {
        throw Error(`Duplicate name: ${model.table.name})`);
      }
      this.modelMap.set(model.table.name, model);
    }
  }

  model(name: string): Model | undefined {
    return this.modelMap.get(name);
  }
}

interface Table extends types.Table {
  shortName: string;
}

export class Model {
  schema: Schema;
  name: string;
  fields: Field[] = [];
  table: Table;
  config: ModelConfig;
  primaryKey!: UniqueKey;
  uniqueKeys: UniqueKey[] = [];
  pluralName: string;

  private fieldMap: Map<string, Field>;

  constructor(schema: Schema, table: types.Table, config?: ModelConfig) {
    this.schema = schema;
    this.table = { ...table, shortName: schema.deprefix(table.name) };
    this.config = { ...DEFAULT_MODEL_CONFIG, ...config };
    this.name = this.config.name || toPascalCase(this.table.shortName);
    this.pluralName =
      this.config.pluralName || toCamelCase(pluralise(this.table.shortName));
    this.fieldMap = new Map();

    const references: { [key: string]: types.Constraint } = {};

    for (const index of table.constraints) {
      if (index.references) {
        if (index.columns.length > 1) {
          throw Error('Composite foreign keys are not supported');
        }
        references[index.columns[0]] = index;
      }
    }

    for (const column of table.columns) {
      const config = this.getFieldConfig(column);
      const field = references[column.name]
        ? new ForeignKeyField(this, column, config)
        : new SimpleField(this, column, config);
      this.addField(field);
    }
  }

  private getFieldConfig(column: types.Column) {
    return (
      (this.config.fields &&
        this.config.fields.find(field => field.column === column.name)) ||
      DEFAULT_FIELD_CONFIG
    );
  }

  field(fullname: string): Field | undefined {
    if (fullname.indexOf('.') > -1) {
      const name = fullname.split('.');
      let model:Model = this;
      for (let i = 0; i < name.length - 1; i++) {
        const field = model.field(name[i]);
        if (field instanceof ForeignKeyField) {
          model = field.referencedField.model;
        }
        else {
          throw Error(`Invalid field: ${name.join('.')}`)
        }
      }
      return model.field(name[name.length-1]);
    }
    return this.fieldMap.get(fullname);
  }

  keyField(): SimpleField | undefined {
    return this.primaryKey && this.primaryKey.fields.length === 1
      ? this.primaryKey.fields[0]
      : undefined;
  }

  keyValue(row: types.Document): types.Value | undefined {
    const keyField = this.keyField();
    return keyField ? this.valueOf(row, keyField.name) : undefined;
  }

  valueOf(
    row: types.Document,
    name: string | SimpleField
  ): types.Value | undefined {
    if (!row) return undefined;
    const field = typeof name === 'string' ? this.field(name) : name;
    if (field === undefined) throw Error(`Bad field: ${name}`);
    let value = row[field.name];
    if (field instanceof ForeignKeyField) {
      let key = field;
      while (value !== undefined && !isValue(value)) {
        key = key.referencedField as ForeignKeyField;
        value = (value as types.Document)[key.name];
      }
    }
    return value as types.Value;
  }

  checkUniqueKey(
    row: types.Document,
    reject?: (value: any) => boolean
  ): UniqueKey | null {
    if (!row) return null;

    reject = reject || (value => value === undefined);

    let uniqueKey: UniqueKey | null = this.primaryKey;
    for (const field of uniqueKey.fields) {
      let value = row[field.name];
      if (value === undefined) {
        value = row[field.name + '__in'];
      }
      if (reject(value)) {
        uniqueKey = null;
        break;
      }
    }

    if (!uniqueKey) {
      for (const key of this.uniqueKeys) {
        if (!key.primary) {
          let missing;
          for (const field of key.fields) {
            if (reject(row[field.name])) {
              missing = field;
              break;
            }
          }
          if (!missing) {
            uniqueKey = key;
            break;
          }
        }
      }
    }

    if (!uniqueKey) {
      for (const name in row) {
        const field = this.field(name);
        if (field instanceof RelatedField) {
          const model = field.referencingField.model;
          if (model.checkUniqueKey(row[name] as types.Document)) {
            // Table._modify()
            return this.primaryKey;
          }
        }
      }
    }

    return uniqueKey;
  }

  getForeignKeyCount(model: Model): number {
    let count = 0;
    for (const field of this.fields) {
      if (field instanceof ForeignKeyField) {
        if (field.referencedField.model === model) {
          count++;
        }
      }
    }
    return count;
  }

  getOtherForeignKeyField(field: ForeignKeyField): ForeignKeyField | undefined {
    const model = field.referencedField.model;
    for (const item of this.fields) {
      if (item instanceof ForeignKeyField) {
        if (item.referencedField.model === model) {
          if (item !== field) {
            return item;
          }
        }
      }
    }
  }

  getForeignKeyOf(model: Model): ForeignKeyField | null {
    for (const field of this.fields) {
      if (field instanceof ForeignKeyField) {
        if (field.referencedField.model === model) {
          return field;
        }
      }
    }
    return null;
  }

  resolveConstraints() {
    for (const index of this.table.constraints) {
      if (index.primaryKey || index.unique) {
        const fields = index.columns.map(name => {
          const field = this.field(name);
          if (!field) {
            throw Error(`Bad field name: ${this.name}::${name}`);
          }
          return field;
        });
        const uniqueKey = new UniqueKey(fields, index.primaryKey);
        for (const field of fields) {
          field.uniqueKey = uniqueKey;
        }
        this.uniqueKeys.push(uniqueKey);
        if (index.primaryKey) {
          this.primaryKey = uniqueKey;
        }
      }

      if (index.references) {
        const field = this.field(index.columns[0]);
        if (field instanceof ForeignKeyField) {
          const referencedTable = this.schema.model(index.references.table);
          if (!referencedTable) {
            throw Error(`Table ${index.references.table} does not exists`);
          }
          const columnName = index.references.columns[0];
          const referencedField = referencedTable.field(columnName);
          if (referencedField instanceof SimpleField) {
            field.referencedField = referencedField;
          } else {
            throw Error(`Bad referenced field: ${columnName}`);
          }
        }
      }
    }

    if (!this.primaryKey) {
      throw Error(`No primary key defined: ${this.table.name}`);
    }
  }

  isClosureField(field: ForeignKeyField) {
    const closureTable = field.referencedField.model.config.closureTable;
    if (closureTable && closureTable.name === field.model.table.name) {
      const fields = closureTable.fields || DEFAULT_CLOSURE_TABLE_FIELDS;
      return field.name === fields.ancestor || field.name === fields.descendant;
    }
    return false;
  }

  resolveRelatedFields() {
    for (const field of this.fields) {
      if (field instanceof ForeignKeyField && !this.isClosureField(field)) {
        const relatedField = new RelatedField(field);
        relatedField.model.addField(relatedField);
        field.relatedField = relatedField;
      }
    }
  }

  private addField(field: Field) {
    if (this.fieldMap.has(field.name)) {
      throw Error(`Duplicate field name: ${field.fullname}`);
    }

    this.fields.push(field);
    this.fieldMap.set(field.name, field);

    if (field instanceof SimpleField) {
      const column = field.column;
      if (column.name !== field.name) {
        if (this.fieldMap.has(column.name)) {
          throw Error(`Duplicate field name: ${column.name}`);
        }
        this.fieldMap.set(column.name, field);
      }
    }
  }

  alias(field:string) {
    return this.table.name;
  }
}

export class Field {
  name: string;
  model: Model;
  config: FieldConfig;

  uniqueKey?: UniqueKey;

  constructor(name: string, model: Model, config: FieldConfig) {
    this.name = name;
    this.model = model;
    this.config = config;
  }

  isUnique(): boolean {
    return this.uniqueKey ? this.uniqueKey.fields.length == 1 : false;
  }

  get fullname(): string {
    return `${this.model.name}::${this.name}`;
  }
}

export class SimpleField extends Field {
  formula?: string;
  column: types.Column;

  constructor(model: Model, column: types.Column, config: FieldConfig) {
    super(config.name || toCamelCase(column.name), model, config);
    this.column = column;
  }
}

export class ComputedField extends Field {
  formula: any; // string or parsed expression
  constructor(model: Model, formula: any, name: string) {
    super(name, model, {});
    this.formula = formula;
  }
}

export class ForeignKeyField extends SimpleField {
  referencedField!: SimpleField;
  relatedField?: RelatedField;

  constructor(model: Model, column: types.Column, config: FieldConfig) {
    super(model, column, config);
    if (!this.config.name) {
      const match = /(.+?)(?:_id|Id)/.exec(column.name);
      if (match) {
        this.name = toCamelCase(match[1]);
      }
    }
  }
}

export class RelatedField extends Field {
  referencingField: ForeignKeyField;
  throughField?: ForeignKeyField;

  constructor(field: ForeignKeyField) {
    const model = field.referencedField.model;
    const config = field.config;
    super(config.relatedName || '', model, config);
    this.referencingField = field;

    let throughFieldName = config.throughField;

    if (throughFieldName === undefined) {
      const model = this.referencingField.model;
      if (model.fields.length <= 3) {
        let other: ForeignKeyField | undefined, extra: Field | undefined;
        for (const uniqueKey of model.uniqueKeys) {
          if (uniqueKey.fields.length === 2) {
            for (const field of model.fields) {
              if (this.referencingField === field) continue;
              if (field instanceof ForeignKeyField) {
                other = field;
              } else if (!field.uniqueKey || !(field.uniqueKey as UniqueKey).primary) {
                extra = field;
                break;
              }
            }
          }
        }
        if (!extra && other) {
          throughFieldName = other.name;
        }
      }
    }

    if (throughFieldName) {
      const throughField = field.model.field(throughFieldName);
      if (throughField instanceof ForeignKeyField) {
        this.throughField = throughField;
      } else {
        throw Error(`Field ${throughFieldName} is not a foreign key`);
      }
    }

    if (!this.name) {
      if (this.throughField) {
        if (field.model.getForeignKeyCount(this.model) === 1) {
          this.name = this.throughField.referencedField.model.pluralName;
        } else {
          this.name =
            this.throughField.name +
            toPascalCase(this.throughField.referencedField.model.pluralName);
        }
      } else if (field.isUnique()) {
        this.name = lcfirst(field.model.name);
      } else {
        if (field.model.getForeignKeyCount(this.model) === 1) {
          this.name = field.model.pluralName;
        } else {
          this.name = field.name + toPascalCase(field.model.pluralName);
        }
      }
    }
  }

  getTypeName(plural?: boolean) {
    const model = this.referencingField.model;
    if (this.referencingField.isUnique() && plural) {
      throw Error(`No plural type for ${this.referencingField.name}.`);
    }
    if (this.throughField) {
      return plural
        ? toPascalCase(this.throughField.referencedField.model.pluralName)
        : this.throughField.referencedField.model.name;
    }
    if (model.getForeignKeyCount(this.model) === 1) {
      return `${this.model.name}${plural ? pluralise(model.name) : model.name}`;
    }
    return (
      toPascalCase(this.referencingField.name) +
      (plural ? toPascalCase(model.pluralName) : model.name)
    );
  }
}

export class UniqueKey {
  fields: SimpleField[];
  primary: boolean;

  constructor(fields: Field[], primary: boolean = false) {
    this.fields = fields as SimpleField[];
    this.primary = primary;
  }

  name() {
    return this.fields.map(field => field.name).join('-');
  }

  autoIncrement() {
    return this.fields.length === 1 && this.fields[0].column.autoIncrement;
  }
}

export function isValue(value: any): boolean {
  if (value === null) return true;

  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') {
    return true;
  }

  return value instanceof Date;
}

export function getReferencingFields(model: Model): ForeignKeyField[] {
  const fields = [];
  for (const entry of model.schema.models) {
    for (const field of entry.fields) {
      if (field instanceof ForeignKeyField) {
        if (field.referencedField.model === model) {
          fields.push(field);
        }
      }
    }
  }
  return fields;
}

export function setModelName(config: SchemaConfig, model: Model, name: string) {
  const re = new RegExp(
    `(\\b|[^A-Za-z0-9])${model.table.shortName}(\\b|[^A-Za-z0-9])`
  );
  for (const field of getReferencingFields(model)) {
    if (re.test(field.column.name)) {
      const modelConfig = getModelConfig(config, field.model);
      if (re.test(field.column.name)) {
        const s = field.column.name.replace(re, `$1${name}$2`);
        // cf. ForeignKeyField::constructor
        setFieldName(
          modelConfig,
          field,
          lcfirst(toCamelCase(s.replace(/_id$/, '')))
        );
      }
    }
  }
  const modelConfig = getModelConfig(config, model);
  modelConfig.name = name;
  modelConfig.pluralName = lcfirst(pluralise(name));
}

function getModelConfig(config: SchemaConfig, model: Model) {
  config.models = config.models || [];
  let entry = config.models.find(
    config => config.table === model.table.shortName
  );
  if (!entry) {
    entry = {
      table: model.table.shortName
    };
    config.models.push(entry);
  }
  return entry;
}

function setFieldName(config: ModelConfig, field: SimpleField, name: string) {
  if (!config.fields) {
    config.fields = [
      {
        column: field.column.name,
        name
      }
    ];
  } else {
    const entry = config.fields.find(
      entry => entry.column === field.column.name
    );
    if (!entry) {
      config.fields.push({
        column: field.column.name,
        name
      });
    } else {
      entry.name = name;
    }
  }
}

export class LeafModel {
  constructor(public model: Model, public path: (ForeignKeyField | RelatedField)[]) {}
}

export function getLeafModel(model: Model, selectors: (string | string[])[]) {
  let result: LeafModel | undefined;

  const setResult = (base?: LeafModel) => {
    if (!base) {
      return;
    }
    if (!result) {
      result = base;
    } else if (result.model !== base.model) {
      const field = getBridgeField(result.model, base.model);
      if (!field) {
        console.error(model.name, selectors);
        throw Error(`Bad row construct: ${result.model.name}, ${base.model.name}`);
      }
      if (field.model !== result.model) {
        result = base;
      }
    }
  };

  for (const selector of selectors) {
    if (selector.indexOf('[') >= 0) {
      // attrs
      continue;
    }
    if (Array.isArray(selector)) {
      for (const entry of selector) {
        setResult(_getLeafModel(model, entry));
      }
    } else {
      setResult(_getLeafModel(model, selector));
    }
  }

  return result || new LeafModel(model, []);
}

function _getLeafModel(model: Model, selector: string): LeafModel | undefined {
  const names = selector.split('.');
  const path = [];
  let length = 0;
  let result: Model | undefined;
  let current = model;
  for (let i = 0; i < names.length; i++) {
    const field = current.field(names[i]);
    if (!field) {
      throw Error(`Not found: ${current.name}::${names[i]} (${model.name}: ${selector})`);
    }
    if (field instanceof RelatedField) {
      path.push(field);
      if (field.throughField) {
        current = field.throughField.referencedField.model;
        //result = field.throughField.model;
        result = current;
      } else {
        current = field.referencingField.model;
        result = current;
      }
      length = path.length;
    } else if (field instanceof ForeignKeyField) {
      path.push(field);
      current = field.referencedField.model;
    }
  }
  path.splice(length);
  return result ? new LeafModel(result, path) : undefined;
}

function getBridgeField(left: Model, right: Model) {
  for (const field of left.fields) {
    if (field instanceof RelatedField) {
      if (field.throughField) {
        if (field.throughField.model === right) {
          return field.throughField;
        }
      } else if (field.referencingField.model === right) {
        return field.referencingField;
      }
    } else if (field instanceof ForeignKeyField) {
      if (field.referencedField.model === right) {
        return field;
      }
    }
  }
}

function rewriteSelector(from: Model, to: LeafModel, selector: string) {
  const prefix = getRewritePrefix(to);
  if (prefix.length > 0) {
    const names = selector.split('.');
    let model = from;
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const field = model.field(name);
      if (field instanceof ForeignKeyField) {
        model = field.referencedField.model;
      } else if (field instanceof RelatedField) {
        if (field.throughField) {
          if (field.throughField.model === to.model) {
            names.splice(0, i + 1);
            names.unshift(field.throughField.name);
            return names.join('.');
          }
        } else if (field.referencingField.model === to.model) {
          names.splice(0, i + 1);
          return names.join('.');
        }
        model = field.throughField
          ? field.throughField.referencedField.model
          : field.referencingField.model;
      }
    }
    return simplifySelector(prefix, from, names);
  }
  return selector;
}

function getRewritePrefix(base: LeafModel): BridgeField[] {
  const { path } = base;
  const prefix = [];

  for (let i = path.length - 1; i >= 0; i--) {
    const field = path[i];
    if (field instanceof RelatedField) {
      prefix.push(field.referencingField);
    } else {
      prefix.push(field.relatedField);
    }
  }

  return prefix;
}

function simplifySelector(simplified: BridgeField[], model: Model, selector: string[]) {
  const modelMap = new Map<Model, number>();
  for (let i = 0; i < simplified.length; i++) {
    modelMap.set(getBridgedModel(simplified[i]), i);
  }
  let current = model;
  for (let i = 0; i < selector.length - 1; i++) {
    const field = current.field(selector[i]) as BridgeField;
    const next = getBridgedModel(field);

    if (modelMap.has(next)) {
      const index = modelMap.get(next);
      simplified.splice(index + 1);
      for (let i = index + 1; i < simplified.length; i++) {
        modelMap.delete(simplified[i].model);
      }
    } else {
      simplified.push(field);
      modelMap.set(field.model, simplified.length);
    }
    current = next;
  }
  const names = simplified.map((f) => f.name);
  names.push(selector[selector.length - 1]);
  return names.join('.');
}

type BridgeField = ForeignKeyField | RelatedField;

function getBridgedModel(field: ForeignKeyField | RelatedField) {
  if (field instanceof ForeignKeyField) {
    return field.referencedField.model;
  }
  return field.throughField
    ? field.throughField.referencedField.model
    : field.referencingField.model;
}
