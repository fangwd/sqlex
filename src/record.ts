import { Table, _toCamel, isEmpty, getUniqueFields } from './database';
import {
  SimpleField,
  ForeignKeyField,
  UniqueKey,
  RelatedField,
  isValue
} from './schema';
import { FlushState, FlushMethod, flushRecord } from './flush';
import { Row } from './engine';
import { copyRecord, CopyOptions } from './copy';
import { Document, Value } from './types';

export type FieldValue = Value | Record;

const runtimes = new WeakMap<Record, RecordRuntime>();

/** @internal */
export function runtimeOf(record: Record): RecordRuntime {
  const runtime = runtimes.get(record);
  if (!runtime) throw Error('Record is not initialized');
  return runtime;
}

function parentKey(value: unknown, field: ForeignKeyField): Value | undefined {
  if (value instanceof Record) {
    return runtimeOf(value).value(field.referencedField.name);
  }
  if (isValue(value)) return value as Value;
  return value
    ? field.referencedField.model.valueOf(value as Document, field.referencedField.name)
    : undefined;
}

function sameParent(
  current: unknown,
  value: unknown,
  field: ForeignKeyField
): boolean {
  if (current === value) return true;
  const lhs = parentKey(current, field);
  const rhs = parentKey(value, field);
  if (lhs != null && rhs != null) return lhs == rhs;
  // Without both keys, a conflict can only be established between two
  // distinct record instances. Data values (null placeholders, scalars,
  // plain objects) merge last-wins, as resolved by Table.append.
  return !(current instanceof Record && value instanceof Record);
}

const RecordProxy: ProxyHandler<Record> = {
  set(record, name, value) {
    if (typeof name !== 'string') {
      return Reflect.set(record, name, value);
    }
    if (value === undefined) {
      throw Error(`Assigning undefined to ${name}`);
    }

    const runtime = runtimeOf(record);
    const model = runtime.table.model;
    const field = model.field(name);
    if (field instanceof ForeignKeyField) {
      const current = runtime.data[name];
      // Unsaved records are write-once graph nodes; persisted records may
      // point a foreign key at a different parent.
      if (
        current !== undefined &&
        !runtime.state.selected &&
        !sameParent(current, value, field)
      ) {
        const key = `${runtime.table.name}.${name}`;
        throw Error(
          `Reassigning ${key}: ${parentKey(current, field)} ` +
          `(new: ${parentKey(value, field)})`
        );
      }

      if (value instanceof Record || value === null) {
        runtime.data[name] = value;
      } else {
        const referencedModel = field.referencedField.model;
        let removeDirty = false;
        if (typeof value !== 'object') {
          value = { [referencedModel.keyField()!.name]: value };
          removeDirty = true;
        }
        const parent = runtime.table.db.table(referencedModel).append(value);
        runtime.data[name] = parent;
        if (removeDirty) {
          runtimeOf(parent).removeDirty(referencedModel.keyField()!.name);
        }
      }
      runtime.state.dirty.add(name);
    } else if (field instanceof SimpleField) {
      runtime.data[name] = _toCamel(value, field);
      runtime.state.dirty.add(name);
    } else if (field instanceof RelatedField) {
      runtime.data[name] = value;
    } else {
      throw Error(`Invalid field: ${model.name}.${name}`);
    }
    return true;
  },

  get(record, name, receiver) {
    if (typeof name === 'string') {
      const member = Reflect.get(record, name, receiver);
      if (typeof member === 'function') return member;

      const runtime = runtimeOf(record);
      const field = runtime.table.model.field(name);
      if (field instanceof SimpleField) {
        // Class-field initializers land on the target as own properties;
        // model data always lives in the runtime.
        return runtime.data[name];
      }
      if (field instanceof RelatedField) {
        let recordSet = runtime.related[name];
        if (!recordSet) {
          recordSet = new RecordSet(receiver, field);
          runtime.related[name] = recordSet;
        }
        return recordSet;
      }
      return member;
    }
    return Reflect.get(record, name, receiver);
  }
};

export class Record {
  constructor(table: Table) {
    const runtime = new RecordRuntime(this, table);
    runtimes.set(this, runtime);
    const proxy = new Proxy(this, RecordProxy);
    runtime.record = proxy;
    runtimes.set(proxy, runtime);
    return proxy;
  }

  get(name: string): FieldValue | undefined {
    return runtimeOf(this).data[name];
  }

  async save(): Promise<this> {
    const runtime = runtimeOf(this);
    if (!runtime.isDirty()) return this;
    await using connection = await runtime.table.db.pool.getConnection();
    return await connection.transaction(() => flushRecord(connection, this));
  }

  update(data: Row = {}): Promise<this> {
    Object.assign(this, data);
    runtimeOf(this).state.method = FlushMethod.UPDATE;
    return this.save();
  }

  delete(): Promise<any> {
    const runtime = runtimeOf(this);
    const filter = getUniqueFields(runtime.table.model, runtime.data as Document);
    return runtime.table.delete(filter).then(result => {
      runtime.state.deleted = true;
      return result;
    });
  }

  async refresh(): Promise<this> {
    const runtime = runtimeOf(this);
    const row = await runtime.table.get<Document>(runtime.filter());
    if (!row) throw Error(`${runtime.repr()} no longer exists`);

    runtime.data = {};
    for (const field of runtime.table.model.fields) {
      const value = row[field.name];
      if (value === undefined) continue;
      if (
        field instanceof ForeignKeyField &&
        value &&
        typeof value === 'object' &&
        runtime.hydrate
      ) {
        const table = runtime.table.db.table(field.referencedField.model);
        runtime.data[field.name] = runtime.hydrate(table, value as Document) as Record;
      } else {
        runtime.data[field.name] = value as FieldValue;
      }
    }
    runtime.state = new FlushState();
    runtime.state.method = FlushMethod.UPDATE;
    runtime.state.selected = true;
    return this;
  }

  copy(data: Document, options?: CopyOptions) {
    return copyRecord(this, data, options);
  }

  toJSON(): Document {
    return runtimeOf(this).toJSON();
  }
}

// Records keep their data outside the instance, so without this hook
// console.log prints `{}`.
Object.defineProperty(Record.prototype, Symbol.for('nodejs.util.inspect.custom'), {
  value(this: Record) {
    return this.toJSON();
  },
  writable: true,
  configurable: true,
});

export type DynamicRecord = Record & { [key: string]: any };

/** @internal */
export class RecordRuntime {
  record: Record;
  data: { [key: string]: FieldValue } = {};
  state = new FlushState();
  related: { [key: string]: RecordSet } = {};
  inserted = false;
  connect = false;
  // On unique-key conflict, adopt the existing row instead of updating it.
  insertOnly = false;
  path?: string;
  hydrate?: (table: Table, row: Document) => Record | Document;

  constructor(record: Record, readonly table: Table) {
    this.record = record;
  }

  isDirty(): boolean {
    return this.state.dirty.size > 0;
  }

  disconnect() {
    for (const key of Object.keys(this.data)) {
      const value = this.data[key];
      if (value instanceof Record) {
        const runtime = runtimeOf(value);
        if (runtime.connect && runtime.state.selected) {
          delete this.data[key];
          this.state.dirty.delete(key);
        }
      }
    }
  }

  isFlushable(perfect?: number): boolean {
    if (perfect !== undefined && perfect < 0) return true;
    if (this.state.merged) return false;
    if (this.state.selected && this.connect) return false;

    if (!this.table.model.checkUniqueKey(this.data as Document, isEmpty)) {
      if (
        this.table.model.uniqueKeys.length > 1 ||
        !this.table.model.primaryKey.autoIncrement()
      ) {
        return false;
      }
    } else if (this.state.method === FlushMethod.DELETE) {
      return true;
    }

    let flushable = 0;
    this.state.dirty.forEach(key => {
      if (!isEmpty(this.data[key])) flushable++;
    });
    if (flushable === 0) return false;
    return perfect ? flushable === this.state.dirty.size : true;
  }

  fields(): Row {
    const fields: Row = {};
    this.state.dirty.forEach(key => {
      if (!isEmpty(this.data[key])) fields[key] = this.value(key);
    });
    return fields;
  }

  removeDirty(keys: string | string[]) {
    for (const key of typeof keys === 'string' ? [keys] : keys) {
      this.state.dirty.delete(key);
    }
  }

  isInserted(): boolean {
    return this.state.merged
      ? runtimeOf(this.state.merged).isInserted()
      : this.inserted;
  }

  value(name: string): Value {
    const value = this.data[name];
    if (value instanceof Record) {
      let parent = runtimeOf(value);
      while (parent.state.merged) parent = runtimeOf(parent.state.merged);
      return parent.primaryKey();
    }
    return value as Value;
  }

  primaryKey(): Value {
    const name = this.table.model.primaryKey.fields[0].name;
    const value = this.data[name];
    return value instanceof Record ? runtimeOf(value).primaryKey() : value;
  }

  isPrimaryKeyDirty(): boolean {
    const name = this.table.model.primaryKey.fields[0].name;
    return this.state.dirty.has(name);
  }

  setPrimaryKey(value: Value) {
    const name = this.table.model.primaryKey.fields[0].name;
    this.data[name] = value;
  }

  filter(): Row {
    const data = Object.keys(this.data).reduce((result, name) => {
      result[name] = this.value(name);
      return result;
    }, {} as Row);
    return getUniqueFields(this.table.model, data)!;
  }

  uniqueValue(key: UniqueKey): string | undefined | null {
    const values = [];
    for (const field of key.fields) {
      const value = this.value(field.name);
      if (value === undefined) return undefined;
      if (value === null) return null;
      values.push(_toCamel(value, field) + '');
    }
    return JSON.stringify(values).toLocaleLowerCase();
  }

  merge() {
    let root = runtimeOf(this.state.merged!);
    while (root.state.merged) root = runtimeOf(root.state.merged);
    this.state.dirty.forEach(name => {
      root.data[name] = this.data[name];
      root.state.dirty.add(name);
    });
  }

  updateState(existing: Record) {
    const existingRuntime = runtimeOf(existing);
    if (!this.primaryKey()) this.setPrimaryKey(existingRuntime.primaryKey());

    for (const name in existingRuntime.data) {
      if (!this.state.dirty.has(name)) continue;
      if (this.value(name) == existingRuntime.value(name)) {
        this.state.dirty.delete(name);
      }
    }
    if (this.isDirty() && this.state.method === FlushMethod.INSERT) {
      this.state.method = FlushMethod.UPDATE;
    }
    this.state.selected = true;
  }

  toJSON(): Document {
    const result: Document = {};
    for (const field of this.table.model.fields) {
      const value = this.value(field.name);
      if (field instanceof RelatedField && Array.isArray(value)) {
        const items = (value as Record[]).map(record => runtimeOf(record).toJSON());
        for (const item of items) delete item[field.referencingField.name];
        result[field.name] = items;
      } else if (value !== undefined) {
        result[field.name] = value;
      }
    }
    return result;
  }

  dump() {
    const data: { __missing?: string[]; [key: string]: unknown } = {
      __state: this.state.json(),
      __missing: [],
      __flushable: this.isFlushable()
    };
    for (const field of this.table.model.fields) {
      let name = field.name;
      const value = this.data[name];
      if (value !== undefined) {
        if (this.state.merged) {
          name = '!' + name;
        } else if (this.state.dirty.has(name)) {
          name = '*' + name;
        }
        data[name] = value instanceof Record ? runtimeOf(value).repr() : value;
      } else if (field instanceof SimpleField) {
        const { autoIncrement, nullable, default: defaultValue } = field.column;
        if (!nullable && !autoIncrement && defaultValue === undefined) {
          data.__missing!.push(field.name);
        }
      }
    }
    if (data.__missing!.length === 0) delete data.__missing;
    return data;
  }

  repr(): string {
    const model = this.table.model;
    const value = this.data[model.keyField()!.name];
    return value === undefined || isValue(value)
      ? `${model.name}(${value})`
      : `${model.name}(${runtimeOf(value as Record).repr()})`;
  }
}

export class RecordSet<T extends Record = Record> {
  record: Record;
  field: RelatedField;

  constructor(record: Record, field: RelatedField) {
    this.record = record;
    this.field = field;
  }

  async all(): Promise<T[]> {
    const runtime = runtimeOf(this.record);
    const loaded = runtime.data[this.field.name];
    if (Array.isArray(loaded)) {
      return loaded as T[];
    }
    const where = runtime.filter();
    if (!where) {
      throw Error(
        `${runtime.repr()}: cannot load relations before unique fields are set`
      );
    }
    const rows = await runtime.table.select<Document>(
      { [this.field.name]: '*' },
      { where, limit: 1 }
    );
    const values = (rows[0]?.[this.field.name] || []) as Document[];
    const table = runtime.table.db.table(this.field.referencingField.model);
    return values.map(value =>
      runtime.hydrate
        ? runtime.hydrate(table, value)
        : value
    ) as T[];
  }

  // user.groups.add(admin)
  add(record: T) {
    const runtime = runtimeOf(this.record);
    const data = {
      [this.field.name]: { upsert: { create: runtimeOf(record).data } }
    };
    return runtime.table.modify(data as Document, runtime.filter());
  }

  // user.groups.replaceWith([admin, customer])
  set(records: T[]) {
    const data = {
      [this.field.name]: {
        set: records.map(record => runtimeOf(record).data),
      },
    };
    const runtime = runtimeOf(this.record);
    return runtime.table.modify(data as Document, runtime.filter());
  }

  replaceWith(records: T[]) {
    return this.set(records);
  }

  clear() {
    return this.set([]);
  }

  // user.groups.remove(admin)
  remove(record: T) {
    const runtime = runtimeOf(this.record);
    const data = {
      [this.field.name]: { delete: [runtimeOf(record).filter()] }
    };
    return runtime.table.modify(data, runtime.filter());
  }
}

export function getModel(table: Table, bulk: boolean = false) {
  return Object.assign(
    function (data: Document) {
      if (bulk) return table.append(data);
      const record = new Record(table) as DynamicRecord;
      Object.assign(record, data);
      return record;
    },
    { table, fields: table.model.fields }
  );
}
