import { Table } from './database';
import { Record } from './record';
import { ForeignKeyField, RelatedField, Field, SimpleField, getLeafModel, Model } from './schema';
import { Document, Value } from './types';
import { deepCopy } from './utils';
export interface RecordConfig {
  [key: string]: string | string[];
}

function append(
  table: Table,
  data: Document,
  configx: LoadingConfig
): Record {
  const db = table.db;
  const model = table.model;
  const row = table.append();
  const defaultMap: Map<Record, Document> = new Map();
  const rowMap: Map<string, Record> = new Map();

  const { fields, defaults, attrs } = configx;

  row.__path = '';

  for (const key in data) {
    const value = data[key];

    if (value === undefined) continue;

    if (key in fields) {
      const setField = selector => {
        let _model = model;
        let _row = row;
        let _defaults = defaults;

        const names = selector.split('.');

        for (let i = 0; i < names.length - 1; i++) {
          _defaults = _defaults && (_defaults[names[i]] as Document);
          const path = names.slice(0, i + 1).join('.');
          const row = rowMap.get(path);
          if (row) {
            _row = row;
          } else {
            _row  = getRecordField(_row, _model.field(names[i]));
            _row.__path = path;
            rowMap.set(path, _row);
            if (_model.field(names[i]) instanceof RelatedField && _defaults) {
              defaultMap.set(_row, _defaults);
            }
          }
          _model = _row.__table.model;
        }

        const field = _model.field(names[names.length - 1]);

        if (field instanceof ForeignKeyField) {
          _row[names[names.length - 1]] = value || null;
        } else {
          _row[names[names.length - 1]] = value;
        }
      }

      if (Array.isArray(fields[key])) {
        for (const name of fields[key]) {
          setField(name);
        }
      } else {
        setField(fields[key]);
      }
    } else {
      // "*": "categoryAttributes[name,value]"
      if (!attrs) {
        throw Error(`Unknown field: ${key}`);
      }
      const { field } = attrs;
      const table = db.table(field.referencingField.model);
      let record = table.append();
      record[field.referencingField.name] = row;

      if (attrs.value) {
        record[attrs.key] = key;
        record[attrs.value] = value;
      } else {
        if (!field.throughField) {
          record[attrs.key] = value;
        } else {
          const referencedField = field.throughField.referencedField;
          const referencedTable = db.table(referencedField.model);
          const referencedRecord = referencedTable.append();
          referencedRecord[attrs.key] = value;
          record[field.throughField.name] = referencedRecord;
          record = referencedRecord;
        }
      }

      const _defaults = defaults && (defaults[field.name] as Document);
      if (_defaults) {
        setDefaults(record, _defaults);
      }
    }
  }

  if (defaults) {
    setDefaults(row, defaults);
    defaultMap.forEach((defaults, row) => {
      setDefaults(row, defaults);
    });
  }

  return row;
}

function getRecordField(row: Record, field: Field): Record {
  const db = row.__table.db;

  if (field instanceof ForeignKeyField) {
    if (!row[field.name]) {
      row[field.name] = db.table(field.referencedField).append();
    }
    return row[field.name];
  } else if (field instanceof RelatedField) {
    if (field.throughField) {
      const record = db
        .table(field.throughField.referencedField.model)
        .append();
      const bridge = db.table(field.referencingField.model).append();
      bridge[field.referencingField.name] = row;
      bridge[field.throughField.name] = record;
      return record;
    } else {
      const table = db.table(field.referencingField.model);
      const record = table.append();
      record[field.referencingField.name] = row;
      return record;
    }
  }

  throw Error(`Invalid field: ${field && field.fullname}`);
}

function setDefaults(row: Record, defaults: Document) {
  for (const name in defaults) {
    const field = row.__table.model.field(name);
    const value = defaults[name];

    if (field instanceof ForeignKeyField) {
      if (row[name] === undefined) {
        if (value === null) {
          row[name] = null;
          continue;
        }
        row[name] = row.__table.db.table(field.referencedField.model).append();
      }
      if (typeof value === 'object' && !(value instanceof Date)) {
        setDefaults(row[name], value as Document);
      } else {
        row[name].__setPrimaryKey(value);
      }
    } else if (field instanceof SimpleField) {
      if (row[name] === undefined) {
        row[name] = value;
      }
    }
  }
}

export function parseRelatedOption(spec: string) {
  // "categoryAttributes[name,value]"
  const [name, optional] = spec.split('[');

  if (optional) {
    const parts = optional.replace(/\]\s*$/, '').split(',');
    return {
      name,
      key: parts[0].trim(),
      value: parts[1] && parts[1].trim()
    };
  }

  return {
    name,
    key: 'name',
    value: 'value'
  };
}

export async function loadTable(
  table: Table,
  config: LoadingConfig,
  data: Document | Document[]
): Promise<any> {
  const db = table.db;

  if (Array.isArray(data)) {
    const rows = [];
    for (const row of data) {
      rows.push(append(table, row, config));
    }
    const { complete } = await db.flush();
    const _id = [];
    for (const row of rows) {
      const key = config.buildSurrogateKey(table, row);
      _id.push(key);
    }
    return { complete, _id };
  }

  const row = append(table, data, config);
  const { complete } = await db.flush();
  const key = config.buildSurrogateKey(table, row);

  return { complete, _id: key };
}

export function recordConfigToDocument(
  table: Table,
  config: RecordConfig
): Document {
  const result = {};

  for (const name in config) {
    let selector: string;

    if (Array.isArray(config[name])) {
      selector = config[name][0];
    } else {
      selector = config[name] as string;
    }

    let names = selector.split('.');
    let model = table.model;
    let fields = result;

    for (let i = 0; i < names.length - 1; i++) {
      const field = model.field(names[i]);
      if (field instanceof ForeignKeyField) {
        model = field.referencedField.model;
      } else {
        const related = field as RelatedField;
        if (related.throughField) {
          model = related.throughField.referencedField.model;
        } else {
          model = related.referencingField.model;
        }
      }
      if (field instanceof RelatedField) {
        if (!fields[field.name]) {
          fields[field.name] = { fields: {} };
        }
        fields = fields[field.name].fields;
      } else {
        if (!fields[field.name]) {
          fields[field.name] = {};
        }
        fields = fields[field.name];
      }
    }

    fields[names[names.length - 1]] = names[names.length - 1];
  }

  return result;
}

export function mapDocument(doc: Document, config: RecordConfig): Document[] {
  const result = [];
  for (const entry of flatten(doc)) {
    const item = {};
    for (const name in config) {
      const path = Array.isArray(config[name]) ? config[name][0] : config[name];
      if (entry[path as string] !== undefined) {
        item[name] = entry[path as string];
      }
    }
    result.push(item);
  }
  return result;
}

function flatten(doc: Document) {
  let result = [{}];

  for (const name in doc) {
    const value = doc[name];
    if (Array.isArray(value)) {
      const next = [];
      if (value.length > 0) {
        for (const val of value) {
          const docs = flatten(val as Document);
          for (const doc of docs) {
            for (const res of result) {
              const ent = { ...res };
              for (const key in doc) {
                ent[`${name}.${key}`] = doc[key];
              }
              next.push(ent);
            }
          }
        }
        result = next;
      } else {
        // Keep
      }
    } else if (value && typeof value === 'object' && !(value instanceof Date)) {
      const docs = flatten(value as Document);
      const next = [];
      for (const doc of docs) {
        for (const res of result) {
          const ent = { ...res };
          for (const key in doc) {
            ent[`${name}.${key}`] = doc[key];
          }
          next.push(ent);
        }
      }
      result = next;
    } else {
      for (const entry of result) {
        entry[name] = value;
      }
    }
  }

  return result;
}

export interface LoadingOptions {
  fields: RecordConfig;
  defaults?: Document;
  keys?: string[];
}

export class LoadingConfig {
  fields: RecordConfig;
  defaults: Document;
  attrs?: {
    field: RelatedField;
    key: string;
    value: string;
  };
  fieldMap: Map<string, SimpleField>; // selector -> field
  surrogateKeys: string[];

  constructor(public model: Model, config: LoadingOptions) {
    const { fields, defaults } = config;

    this.fields = deepCopy(fields);
    this.defaults = defaults || {};

    if ('*' in fields) {
      this.initAttrs(fields['*'] as string);
    }

    this.initFieldMap();
    this.initKeys(config.keys);
  }

  getField(selector: string): SimpleField {
    let names = selector.split('.');
    let model = this.model;
    for (let i = 0; i < names.length - 1; i++) {
      const field = model.field(names[i]);
      if (field instanceof ForeignKeyField) {
        model = field.referencedField.model;
      } else {
        const related = field as RelatedField;
        if (related.throughField) {
          model = related.throughField.referencedField.model;
        } else {
          model = related.referencingField.model;
        }
      }
    }
    const field = model.field(names[names.length - 1]);
    if (!(field instanceof SimpleField)) {
      throw Error(`Bad field selector: ${selector}`);
    }
    return field;
  }

  initFieldMap() {
    this.fieldMap = new Map();
    for (const name in this.fields) {
      const path = this.fields[name];
      const selector = Array.isArray(path) ? path[0] : path;
      if (selector.indexOf('[') < 0) {
        this.fieldMap.set(selector, this.getField(selector));
      }
    }
  }

  private nextSurrogateKeyId = 1;
  private addSurrogateKey(selector: string|string[]) {
    if (Array.isArray(selector)) {
      selector = selector.join('.');
    }
    const field = this.fieldMap.get(selector);
    if (!field) {
      const key = `__${this.nextSurrogateKeyId}`;
      this.fields[key] = selector;
      this.surrogateKeys.push(key);
      this.nextSurrogateKeyId++;
      this.fieldMap.set(selector, this.getField(selector));
    }
    else {
      this.surrogateKeys.push(selector);
      this.fields[selector] = selector;
    }
  }

  initKeys(keys?: string[]) {
    this.surrogateKeys = [];
    if (keys && keys.length > 0) {
      for (const selector of keys) {
        this.addSurrogateKey(selector);
      }
    } else {
      const { path } = getLeafModel(this.model, Object.values(this.fields));
      const names = [];
      for (let i = 0; i < path.length; i++) {
        const field = path[i];
        names.push(field.name);
        if (field instanceof RelatedField) {
          if (field.throughField) {
            if (this.surrogateKeys.length === 0) {
              this.addSurrogateKey(this.model.keyField().name);
            }
            names.push(field.throughField.referencedField.model.keyField().name);
            this.addSurrogateKey(names)
            names.pop();
          } else if (i === path.length - 1) {
            const model = field.referencingField.model;
            names.push(model.keyField().name);
            this.addSurrogateKey(names)
            names.pop();
          }
        }
      }
      if (this.surrogateKeys.length === 0) {
        this.addSurrogateKey(this.model.keyField().name);
      }
    }
  }

  initAttrs(config: string) {
    const model = this.model;
    const option = parseRelatedOption(config);
    const field = model.field(option.name);
    if (!(field instanceof RelatedField)) {
      throw Error(`Invalid field: ${model.name}.${option.name}`);
    }
    this.attrs = {
      field,
      key: option.key,
      value: option.value,
    };
  }

  encodeSurrogateKey(row: { [key: string]: any }) {
    const values = this.surrogateKeys.map((key) => row[key]);
    this.surrogateKeys.forEach((key) => delete row[key]);
    row['_id'] = values.join(';');
    return row;
  }

  decodeSurrogateKey(key: string): Array<{selector: string, field: SimpleField, value: string}> {
    const values = key.split(';');
    return this.surrogateKeys.map((key, index) => {
      const value = values[index];
      if (value) {
        const field = this.fieldMap.get(this.fields[key] as string)!;
        return { selector: this.fields[key] as string, field, value };
      }
      return null;
    });
  }

  buildSurrogateKey(table: Table, row: Record) {
    const selectors = this.surrogateKeys.map((key) => this.fields[key] as string);
    const values = [];

    for (const selector of selectors) {
      const names = selector.split('.');
      let record = row;
      let model = table.model;
      for (let i = 0; i < names.length - 1; i++) {
        const field = model.field(names[i]);
        if (field instanceof ForeignKeyField) {
          record = record[field.name];
          model = field.referencedField.model;
        } else {
          const related = field as RelatedField;

          model = related.referencingField.model;

          const records = findReferencingRecords(
            table.db.table(model),
            related.referencingField,
            record
          );

          if (records.length > 1) {
            throw Error(`Multiple referencing records in ${model.name}`);
          }

          record = records[0];

          if (related.throughField) {
            record = record[related.throughField.name] as Record;
            model = related.throughField.referencedField.model;
          }
        }
      }

      values.push(record[names[names.length - 1]]);
    }

    return values.join(';');
  }
}

function findReferencingRecords(table: Table, field: ForeignKeyField, parent: Record) {
  const result: Record[] = [];
  for (const record of table.recordList) {
    const value = record[field.name];
    if (value === parent) {
      result.push(record);
    }
  }
  return result;
}

export function decodeSurrogateKey(
  table: Table,
  options: RecordConfig | string[],
  value: string
) {
  const config = new LoadingConfig(table.model, {
    fields: Array.isArray(options) ? {} : options,
    keys: Array.isArray(options) ? options : [],
  });
  const decoded = config.decodeSurrogateKey(value);
  const filter: { [key: string]: Document | Value } = {};
  const rows: Array<{ table: Table; key: { field: string; value: Value } }> = [];
  let model = table.model;
  for (const entry of decoded) {
    if (entry) {
      const { selector, field, value } = entry;
      const keys = selector.split('.');
      let current = filter;
      for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!current[key]) {
          current[key] = {};
        }
        current = current[key] as { [key: string]: Document | Value };
      }
      current[field.name] = value;
      model = field.model;
      rows.push({ table: table.db.table(model), key: { field: field.name, value } });
    }
  }
  return { filter, rows };
}

export function getDefaultSurrogateKeyFields(
  table: Table,
  options: RecordConfig | string[],
): Array<{table: string, field: string, selector: string}>{
  const config = new LoadingConfig(table.model, {
    fields: Array.isArray(options) ? {} : options,
    keys: Array.isArray(options) ? options : [],
  });
  const result = [];
  for (const key of config.surrogateKeys) {
    const selector = config.fields[key] as string;
    const field = config.fieldMap.get(selector);
    result.push({
      table: table.db.table(field.model).name,
      field: field.name,
      selector
    })
  }
  return result;
}

export function surrogateKeyToFields(
  table: Table,
  options: RecordConfig | string[],
  value: string
) {
  const config = new LoadingConfig(table.model, {
    fields: Array.isArray(options) ? {} : options,
    keys: Array.isArray(options) ? options : [],
  });
  const decoded = config.decodeSurrogateKey(value);
  const fields: { [key: string]: string } = {};
  const values: { [key: string]: Value } = {};
  let i = 1;
  for (const entry of decoded) {
    if (entry) {
      const { selector, field, value }  = entry;
      const key = `__${i}`;
      fields[key] = selector;
      values[key] = value;
    }
    i++;
  }
  return { fields, values };
}
