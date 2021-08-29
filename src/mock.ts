import { Database, Table } from './database';
import { DataType, getTypeName } from './print';
import { ForeignKeyField, getReferencingFields, Model, RelatedField, SimpleField } from './schema';
import { Document, Value } from './types';
import { Record } from './record';

export async function mock(table: Table, data: Document, save?: boolean): Promise<Record>;
export async function mock(table: Table, data: Document[], save?: boolean): Promise<Record[]>;
export async function mock(table: Table, data: Document | Document[], save = true) {
  if (Array.isArray(data)) {
    const records = [];
    for (const entry of data) {
      records.push(_mock(table, entry));
    }
    if (save || save === undefined) {
      await table.db.flush();
    }
    return records;
  }

  const record = _mock(table, data);
  if (save || save === undefined) {
    await table.db.flush();
  }

  return record;
}

function _mock(table: Table, data: Document): Record {
  const record = table.append({});
  setFields(record, data);
  return record;
}

function setFields(record: Record, data: Document) {
  const db = record.__table.db;
  const model = record.__table.model;

  for (const field of model.fields) {
    const value = data[field.name];
    if (field instanceof SimpleField) {
      if (value === undefined) {
        if (field.column.autoIncrement) {
          continue;
        }
        if (field.column.nullable) {
          record[field.name] = null;
        } else if (field instanceof ForeignKeyField) {
          record[field.name] = _mock(db.table(field.referencedField), {});
        } else {
          record[field.name] = getValue(getTypeName(field.column.type));
        }
      } else {
        if (field instanceof ForeignKeyField) {
          if (value === null || value instanceof Record) {
            record[field.name] = value;
          } else {
            const table = db.table(field.referencedField);
            record[field.name] = _mock(table, value as Document);
          }
        } else {
          record[field.name] = value;
        }
      }
    } else if (Array.isArray(value)) {
      const related = field as RelatedField;
      if (related.throughField) {
        const table = db.table(related.throughField.referencedField.model);
        const mapping = db.table(related.throughField.model);
        for (const entry of value) {
          const actual = _mock(table, (entry as Document) || {});
          _mock(mapping, {
            [related.referencingField.name]: record,
            [related.throughField.name]: actual,
          });
        }
      } else {
        const field = related.referencingField;
        const table = db.table(field);
        for (const entry of value) {
          const data = { ...((entry as Document) || {}), [field.name]: record };
          _mock(table, data as Document);
        }
      }
    }
  }

  for (const key in data) {
    if (!model.field(key)) {
      throw Error(`Field ${model.name}.${key} does not exist`);
    }
  }
}

const _next = {
  number: 1,
  string: 1,
  boolean: 1,
};

function getValue(type: DataType): Date | number | string | boolean {
  switch (type) {
    case 'Date':
      return new Date();
    case 'number':
      return _next.number++;
    case 'string':
      return (_next.string++).toString(16);
    case 'boolean':
      return _next.boolean++ % 2 == 0;
  }
}

function sort(models: Model[]) {
  const sorted = new Set<Model>();
  const setNulls = new Set<ForeignKeyField>();
  const refsMap = new Map<Model, ForeignKeyField[]>();
  while (true) {
    let resolved = 0;
    let conflicts = 0;
    for (const model of models) {
      if (!sorted.has(model)) {
        let refs = refsMap.get(model);
        if (!refs) {
          refs = getReferencingFields(model);
          refsMap.set(model, refs);
        }
        let resolve = true;
        for (const ref of refs) {
          if (!sorted.has(ref.model) && ref.model !== model) {
            if (ref.column.nullable) {
              setNulls.add(ref);
            } else {
              resolve = false;
              break;
            }
          }
        }
        if (resolve) {
          sorted.add(model);
          resolved++;
        } else {
          conflicts++;
        }
      }
    }
    if (resolved === 0) {
      if (conflicts === 0) {
        break;
      }
      const names = models.filter((model) => !sorted.has(model)).map((model) => model.name);
      throw Error(`Failed to sort models: ${names.join(', ')}`);
    }
  }
  return { models: [...sorted], fields: [...setNulls] };
}

export async function cleanup(db: Database) {
  const { models, fields } = sort(db.schema.models);
  for (const key of fields) {
    const table = db.table(key.model);
    const pk = key.model.primaryKey.name();
    const range: Value[] = [];
    for (const record of table.recordList) {
      range.push(record[pk]);
    }
    if (range.length > 0) {
      await table.update({ [key.name]: null }, { [pk]: range });
    }
  }

  for (const model of models) {
    const table = db.table(model);
    const pk = model.primaryKey.name();
    const range: Value[] = [];
    for (const record of table.recordList) {
      range.push(record[pk]);
    }
    if (range.length > 0) {
      await table.delete({ [pk]: range });
    }
  }
  db.clear();
}
