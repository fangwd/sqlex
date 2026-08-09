import {
  Database,
  Table,
  Filter,
  toDocument,
  getUniqueFields
} from './database';
import { Record, FieldValue, runtimeOf } from './record';

import { Connection, Row } from './engine';
import { encodeFilter } from './filter';
import { SimpleField, ForeignKeyField, RelatedField } from './schema';
import { Document, Value } from './types';

export enum FlushMethod {
  INSERT,
  UPDATE,
  DELETE
}

export class FlushState {
  method: FlushMethod = FlushMethod.INSERT;
  dirty: Set<string> = new Set();
  deleted: boolean = false;
  merged: Record | null = null;
  selected?: boolean = false;
  clone(): FlushState {
    const state = new FlushState();
    state.method = this.method;
    state.dirty = new Set(this.dirty);
    state.deleted = this.deleted;
    state.merged = null;
    state.selected = false;
    return state;
  }
  json() {
    return {
      method: FlushMethod[this.method],
      dirty: [...this.dirty],
      deleted: this.deleted,
      merged: this.merged ? runtimeOf(this.merged).repr() : null,
      selected: this.selected
    };
  }
}

class FlushContext {
  connection: Connection;
  visited: Set<Record> = new Set();
  promises: Promise<unknown>[] = [];

  constructor(connection: Connection) {
    this.connection = connection;
  }
}

function collectParentFields(
  record: Record,
  context: FlushContext,
  perfect: number
) {
  if (!runtimeOf(record).isDirty() || context.visited.has(record)) return;

  context.visited.add(record);

  runtimeOf(record).state.dirty.forEach(key => {
    const value = runtimeOf(record).data[key];
    if (value instanceof Record) {
      if (runtimeOf(value).isFlushable(perfect)) {
        // assert runtimeOf(value).state.method === FlushMethod.INSERT
        const promise = _persist(context.connection, value);
        context.promises.push(promise);
      } else {
        collectParentFields(value, context, perfect);
      }
    }
  });
}

export function flushRecord(
  connection: Connection,
  record: Record
): Promise<Record> {
  return flush();

  async function flush(): Promise<Record> {
    while (true) {
      let context = new FlushContext(connection);
      collectParentFields(record, context, 1);
      if (context.promises.length > 0) {
        await Promise.all(context.promises);
        continue;
      }

      if (runtimeOf(record).isFlushable(0)) {
        await _persist(connection, record);
        if (!runtimeOf(record).isDirty()) return record;
        continue;
      }

      context = new FlushContext(connection);
      collectParentFields(record, context, 0);
      if (context.promises.length === 0) {
        throw Error('Loops in record fields');
      }
      await Promise.all(context.promises);
    }
  }
}

/**
 * Flushes a *flushable* record to disk, updating its dirty fields or setting
 * __state.deleted to true after.
 *
 * @param record Record to be flushed to disk
 */
async function _persist(
  connection: Connection,
  record: Record
): Promise<Record> {
  const method = runtimeOf(record).state.method;
  const model = runtimeOf(record).table.model;
  const filter = getUniqueFields(model, runtimeOf(record).data as Document)!;
  if (method === FlushMethod.DELETE) {
    await runtimeOf(record).table._delete(connection, filter);
    runtimeOf(record).state.deleted = true;
    return record;
  }

  const fields = runtimeOf(record).fields();

  if (method === FlushMethod.UPDATE) {
    const result = await runtimeOf(record).table._update(
      connection,
      fields,
      filter
    );
    if ((result.affectedRowCount || result.affectedRows) > 0) {
      runtimeOf(record).removeDirty(Object.keys(fields));
      return record;
    }
    throw Error('Row does not exist');
  }

  await connection._query('SAVEPOINT sp');
  try {
    const id = await runtimeOf(record).table._insert(connection, fields);
    if (runtimeOf(record).primaryKey() === undefined) {
      runtimeOf(record).setPrimaryKey(id);
    }
    runtimeOf(record).removeDirty(Object.keys(fields));
    runtimeOf(record).state.method = FlushMethod.UPDATE;
    runtimeOf(record).inserted = true;
    await connection._query('RELEASE SAVEPOINT sp');
    return record;
  } catch (error) {
    if (!isIntegrityError(error)) throw error;
    await connection._query('ROLLBACK TO SAVEPOINT sp');

    if (Object.keys(fields).length === 1) {
      const name = Object.keys(fields)[0];
      if (runtimeOf(record).table.model.field(name)!.uniqueKey!.primary) {
        runtimeOf(record).removeDirty(name);
        return record;
      }
    }

    const row = await runtimeOf(record).table._get(connection, filter);
    if (!row) {
      // Not a visible unique-key conflict (e.g. a lock error that matched the
      // integrity pattern); surface the original error.
      throw error;
    }
    if (runtimeOf(record).primaryKey() === undefined) {
      const value = row[model.primaryKey.fields[0].name];
      runtimeOf(record).setPrimaryKey(value as Value);
    }
    if (runtimeOf(record).insertOnly) {
      runtimeOf(record).state.dirty.clear();
      runtimeOf(record).state.method = FlushMethod.UPDATE;
      runtimeOf(record).state.selected = true;
      return record;
    }
    for (const key in row) {
      if (fields[key] === runtimeOf(record).table.model.valueOf(row, key)) {
        runtimeOf(record).removeDirty(key);
        delete fields[key];
      }
    }
    if (Object.keys(fields).length > 0 && runtimeOf(record).isDirty()) {
      await runtimeOf(record).table._update(connection, fields, filter);
      runtimeOf(record).removeDirty(Object.keys(fields));
    }
    return record;
  }
}

function flushTable(
  connection: Connection,
  table: Table,
  perfect?: number
): Promise<number> {
  if (table.recordList.length === 0) {
    return Promise.resolve(0);
  }

  const states: { data: { [key: string]: FieldValue }; state: FlushState }[] = [];

  for (let i = 0; i < table.recordList.length; i++) {
    const record = table.recordList[i];
    states.push({
      data: { ...runtimeOf(record).data },
      state: runtimeOf(record).state.clone()
    });
  }

  return _flushTable(connection, table, perfect).catch(error => {
    for (let i = 0; i < table.recordList.length; i++) {
      const record = table.recordList[i];
      if (runtimeOf(record).isDirty()) {
        const state = states[i];
        runtimeOf(record).data = { ...state.data };
        runtimeOf(record).state = state.state.clone();
      }
    }
    throw error;
  });
}

function _flushTable(
  connection: Connection,
  table: Table,
  perfect?: number
): Promise<number> {
  mergeRecords(table);
  const filter: Record[] = [];
  const nameSet: Set<string> = new Set();
  const recordSet: Set<Record> = new Set();

  for (const record of table.recordList) {
    if (
      runtimeOf(record).isDirty() &&
      runtimeOf(record).isFlushable(perfect) &&
      !runtimeOf(record).state.selected &&
      (!(runtimeOf(record).connect && runtimeOf(record).state.selected))
    ) {
      const entry = runtimeOf(record).filter();
      if (entry) {
        for (const name in entry) {
          nameSet.add(name);
        }
        runtimeOf(record).state.dirty.forEach(name => nameSet.add(name));
        filter.push(record);
      }
      recordSet.add(record);
    }
  }

  const dialect = table.db.pool;
  const model = table.model;

  if (model.keyField()) {
    nameSet.add(model.keyField()!.name);
  }

  function _select(): Promise<any> {
    if (filter.length === 0) return Promise.resolve();
    const fields = model.fields.filter(field => nameSet.has(field.name));
    const columns = fields.map(field => dialect.escapeId((field as SimpleField).column.name));
    const from = dialect.escapeId(model.table.name);
    const where = encodeFilter(
      filter.map(r => runtimeOf(r).filter()),
      table.model,
      dialect,
      table.db.operatorMap,
      table.db.jsonFilterOptions
    );
    const query = `select ${columns.join(',')} from ${from} where ${where}`;
    return connection._query(query).then(rows => {
      const map = makeMapTable(table);
      rows.forEach((row: Row) => map.append(toDocument(row, table.model)));
      for (const record of table.recordList) {
        if (!runtimeOf(record).isDirty()) continue;
        const existing = map._mapGet(record);
        if (existing) {
          runtimeOf(record).updateState(existing);
        }
      }
      for (const record of filter) {
        if (runtimeOf(record).connect) {
          runtimeOf(record).state.selected = true;
        }
      }
    });
  }

  let insertCount = 0;
  let updateCount = 0;

  function _insert() {
    interface MapEntry {
      names: string[];
      records: Record[];
    }

    const nameMap: Map<string, MapEntry> = new Map();

    insertCount = 0;

    const shouldInsert = (record: Record) => {
      return (
        recordSet.has(record) &&
        runtimeOf(record).isDirty() &&
        runtimeOf(record).isFlushable(perfect) &&
        runtimeOf(record).state.method === FlushMethod.INSERT
      );
    };

    const getNames = (record: Record) => {
      const names = [];

      for (const name of runtimeOf(record).state.dirty) {
        if (runtimeOf(record).value(name) !== undefined) {
          names.push(name);
        }
      }

      return names;
    };

    for (const record of table.recordList) {
      if (!shouldInsert(record)) continue;

      insertCount++;

      const names = getNames(record);
      const key = names.join('-');
      const me = nameMap.get(key);

      if (me) {
        me.records.push(record);
      } else {
        nameMap.set(key, { names, records: [record] });
      }
    }

    const promises = [];

    for (const entry of nameMap.values()) {
      promises.push(
        _insertRecords(connection, table, entry.names, entry.records)
      );
    }

    return Promise.all(promises).then(results => {
      let i = 0;
      for (const entry of nameMap.values()) {
        let id = results[i++];
        if (connection.dialect === 'sqlite3' || connection.dialect === 'generic') {
          // sqlite3 returns the "last" inserted id
          for (let j = entry.records.length - 1; j >= 0; j--) {
            const record = entry.records[j];
            if (model.primaryKey.autoIncrement()) {
              runtimeOf(record).setPrimaryKey(id--);
            }
            runtimeOf(record).state.selected = true;
            runtimeOf(record).state.method = FlushMethod.UPDATE;
            runtimeOf(record).inserted = true;
          }
        } else {
          for (const record of entry.records) {
            if (model.primaryKey.autoIncrement()) {
              runtimeOf(record).setPrimaryKey(id++);
            }
            runtimeOf(record).state.selected = true;
            runtimeOf(record).state.method = FlushMethod.UPDATE;
            runtimeOf(record).inserted = true;
          }
        }
      }
    });
  }

  function _update() {
    const promises = [];
    for (const record of table.recordList) {
      if (!runtimeOf(record).isDirty() || !runtimeOf(record).isFlushable(perfect)) continue;
      if (runtimeOf(record).state.method !== FlushMethod.UPDATE) continue;
      const fields = runtimeOf(record).fields();
      runtimeOf(record).removeDirty(Object.keys(fields));
      promises.push(table._update(connection, fields, runtimeOf(record).filter()));
    }
    if ((updateCount = promises.length) > 0) {
      return Promise.all(promises);
    }
  }

  return _select()
    .then(() => _insert())
    .then(() => _update())
    .then(() => {
      return filter.length + insertCount + updateCount;
    });
}

function mergeRecords(table: Table) {
  const model = table.model;

  const map = model.uniqueKeys.reduce<{ [key: string]: { [key: string]: Record } }>(
    (map, uc) => {
      map[uc.name()] = {};
      return map;
    },
    {}
  );

  for (const record of table.recordList) {
    if (runtimeOf(record).state.merged) continue;
    for (const uc of model.uniqueKeys) {
      const value = runtimeOf(record).uniqueValue(uc);
      if (value === undefined) continue;
      const existing = map[uc.name()][value as string];
      if (existing) {
        if (existing === record) {
          throw Error(`Duplicate unique constraint: ${uc.name()} (table ${table.name})`);
        }
        if (!runtimeOf(record).state.merged) {
          runtimeOf(record).state.merged = existing;
        } else if (runtimeOf(record).state.merged !== existing) {
          throw Error(`Inconsistent`);
        }
      } else {
        map[uc.name()][value as string] = record;
      }
    }
    if (runtimeOf(record).state.merged) {
      runtimeOf(record).merge();
    }
  }
}

function flushDatabaseA(connection: Connection, db: Database): Promise<void> {
  return new Promise((resolve, reject) => {
    function _flush() {
      const promises = db.tableList.map(table =>
        flushTable(connection, table, 1)
      );
      Promise.all(promises)
        .then(results => {
          if (results.reduce((a, b) => a + b, 0) === 0) {
            resolve();
          } else {
            _flush();
          }
        })
        .catch(error => reject(error));
    }
    _flush();
  });
}

export function flushDatabaseB(connection: Connection, db: Database, allowPartial: boolean): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let waiting = 0;
    function _flush() {
      const promises = db.tableList.map(table => flushTable(connection, table));
      Promise.all(promises)
        .then(results => {
          const count = results.reduce((a, b) => a + b, 0);
          if (count === 0 && db.getDirtyCount() > 0) {
            if (waiting++ > db.tableList.length) {
              if (!allowPartial) {
                dumpDirtyRecords(db);
                throw Error('Circular references/Incomplete data');
              }
              else {
                resolve(false);
                return;
              }
            }
          } else {
            waiting = 0;
          }
          if (db.getDirtyCount() > 0) {
            _flush();
          } else {
            resolve(true);
          }
        })
        .catch(error => reject(error));
    }
    _flush();
  });
}

export interface FlushOptions {
  afterBegin?: (c: Connection) => Promise<any>;
  beforeCommit?: (c: Connection) => Promise<any>;
  replaceRecordsIn?: string[];
  allowPartial?: boolean;
}

export function flushDatabase(
  connection: Connection,
  db: Database,
  options: FlushOptions = {}
): Promise<boolean> {
  let { afterBegin, beforeCommit, allowPartial } = options;

  afterBegin = afterBegin || ((c: Connection) => Promise.resolve());
  beforeCommit = beforeCommit || ((c: Connection) => Promise.resolve());

  return new Promise((resolve, reject) => {
    let perfect = true;
    const _flush = () => {
      connection.transaction(() => {
        afterBegin(connection)
          .then(() =>
            (perfect ? flushDatabaseA(connection, db) : Promise.resolve()).then(
              () =>
                flushDatabaseB(connection, db, allowPartial ?? false).then((complete) => {
                  const replace = options.replaceRecordsIn
                    ? replaceRecordsIn(connection, db, options.replaceRecordsIn)
                    : Promise.resolve();
                  replace.then(() =>
                    beforeCommit(connection).then(() =>
                      connection.commit().then(() => resolve(complete))
                    )
                  );
                })
            )
          )
          .catch((error: unknown) => {
            connection.rollback().then(() => {
              if (perfect && isIntegrityError(error)) {
                perfect = false;
                setTimeout(_flush, Math.random() * 1000);
              } else if (isRetryable(error)) {
                setTimeout(_flush, Math.random() * 1000);
              } else {
                reject(Error(error as string));
              }
            });
          });
      });
    };
    _flush();
  });
}

function errorText(error: unknown): string {
  const { message, error: nested } = (error ?? {}) as { message?: string; error?: string };
  return message || nested || '';
}

function isIntegrityError(error: unknown) {
  // postgres: duplicate key value violates unique constraint "order_pkey"
  return /\bDuplicate\b|UNIQUE constraint|\blocked\b/i.test(errorText(error));
}

function isRetryable(error: unknown) {
  const { message } = (error ?? {}) as { message?: string };
  return /\b(Deadlock|locked)\b/i.test(message || '');
}

export function dumpDirtyRecords(db: Database, all: boolean = false) {
  type Dump = ReturnType<ReturnType<typeof runtimeOf>['dump']>;
  const tables: { [key: string]: Dump[] } = {};
  for (const table of db.tableList) {
    const records: Dump[] = [];
    for (const record of table.recordList) {
      if ((runtimeOf(record).isDirty() && !runtimeOf(record).state.merged) || all) {
        records.push(runtimeOf(record).dump());
      }
    }
    if (records.length > 0) {
      tables[table.model.name] = records;
    }
  }
  console.log(JSON.stringify(tables, null, 4))
}

function makeMapTable(table: Table) {
  return table.db.clone().table(table.model);
}

/**
 * Inserts a list of records sharing the same set of dirty fields
 */
export function _insertRecords(
  connection: Connection,
  table: Table,
  names: string[],
  records: Record[]
): Promise<number> {
  const escape = table.db.pool.escapeId;
  const model = table.model;

  const fields = names.map(name => model.field(name) as SimpleField);
  const columns = fields.map(field => escape(field.column.name)).join(',');

  const values = [];

  for (const record of records) {
    const value = [];
    for (const field of fields) {
      value.push(table.escapeValue(field, runtimeOf(record).value(field.name)));
      runtimeOf(record).removeDirty(field.name);
    }
    values.push(`(${value.join(',')})`);
  }

  const into = escape(table.name);
  const query = `insert into ${into} (${columns}) values ${values.join(',')}`;
  return connection._query(query, table.model.keyField()!.column.name);
}

export async function replaceRecord(
  connection: Connection,
  table: Table,
  doc: Document
): Promise<Record> {
  const record = table.append();

  for (const name in doc) {
    const field = table.model.field(name);
    if (field instanceof SimpleField) {
      record[name] = doc[name];
    }
  }

  await flushTable(connection, table, -1);

  table.clear();

  for (const name in doc) {
    const field = table.model.field(name);

    if (field instanceof RelatedField) {
      const childRecords = [];

      const referencingTable = table.db.table(field.referencingField.model);
      const value = runtimeOf(record).primaryKey();

      const mapTable = await _buildMapTable(connection, referencingTable, {
        [field.referencingField.name]: value
      });

      const matchedSet = new Set();
      const batched = [];

      for (const item of doc[name] as Document[]) {
        const data = {
          ...item,
          [field.referencingField.name]: value
        };
        let batch = true;
        for (const key in item) {
          if (Array.isArray(item[key])) {
            batch = false;
            break;
          }
        }
        if (batch) {
          batched.push(data);
        } else {
          const childRecord = await replaceRecord(
            connection,
            referencingTable,
            data
          );
          matchedSet.add(mapTable._mapGet(childRecord));
          childRecords.push(childRecord);
        }
      }

      const tempTable = table.db.clone().table(referencingTable.name);

      batched.forEach(item => tempTable.append(item));

      await flushTable(connection, tempTable, -1);

      for (const childRecord of tempTable.recordList) {
        matchedSet.add(mapTable._mapGet(childRecord));
        childRecords.push(childRecord);
      }

      record[field.name] = childRecords;

      const values: Value[] = [];

      for (const record of mapTable.recordList) {
        if (!matchedSet.has(record)) {
          values.push(runtimeOf(record).primaryKey());
        }
      }

      if (values.length > 0) {
        await referencingTable._delete(connection, {
          [referencingTable.model.primaryKey.name()]: values
        });
      }
    }
  }

  return record;
}

async function _buildMapTable(
  connection: Connection,
  table: Table,
  filter: Filter
): Promise<Table> {
  const model = table.model;
  const dialect = table.db.pool;
  const fields = model.fields.filter(field => field.uniqueKey);
  const columns = fields.map(field => (field as SimpleField).column.name);
  const from = dialect.escapeId(model.table.name);
  const where = encodeFilter(
    filter,
    table.model,
    dialect,
    table.db.operatorMap,
    table.db.jsonFilterOptions
  );
  const query = `select ${columns.join(',')} from ${from} where ${where}`;
  const rows = await connection._query(query);
  const mapTable = makeMapTable(table);
  rows.forEach((row: Row) => mapTable.append(toDocument(row, table.model)));
  return mapTable;
}

async function replaceRecordsIn(
  connection: Connection,
  db: Database,
  names: string[]
) {
  if (names.length === 0) return;

  const table = db.table(names[0]);

  const values = table.recordList
    .filter(record => !runtimeOf(record).isInserted())
    .map(record => runtimeOf(record).primaryKey());

  if (values.length === 0) return;

  const nameSet: Set<string> = new Set();
  for (let i = 1; i < names.length; i++) {
    nameSet.add(names[i]);
  }

  const referencingTables = _getReferencingTables(table);
  for (const referencingTable of referencingTables) {
    if (nameSet.has(referencingTable.table.model.table.shortName)) {
      await _deleteRecords(
        connection,
        referencingTable.table,
        referencingTable.field,
        values,
        nameSet
      );
    }
  }
}

async function _deleteRecords(
  connection: Connection,
  table: Table,
  field: ForeignKeyField,
  values: Value[],
  nameSet: Set<string>
) {
  const ids = table.recordList.map(record => runtimeOf(record).primaryKey());

  const filter = {
    [field.name]: values,
    not: { [table.model.keyField()!.name + '_in']: ids }
  };

  const selfField = table.model.fields.find(
    field =>
      field instanceof ForeignKeyField &&
      field.referencedField.model === table.model
  ) as ForeignKeyField | undefined;

  if (selfField) {
    await table._deleteLeaves(connection, filter, selfField);
  } else {
    await table._delete(connection, filter);
  }

  values = table.recordList
    .filter(record => !runtimeOf(record).isInserted())
    .map(record => runtimeOf(record).primaryKey());

  if (values.length === 0) return;

  const referencingTables = _getReferencingTables(table);

  for (const referencingTable of referencingTables) {
    if (nameSet.has(referencingTable.table.model.table.shortName)) {
      await _deleteRecords(
        connection,
        referencingTable.table,
        referencingTable.field,
        values,
        nameSet
      );
    }
  }
}

interface ReferencingTableInfo {
  table: Table;
  field: ForeignKeyField;
}

function _getReferencingTables(table: Table): ReferencingTableInfo[] {
  const referencingTables = [];
  for (const model of table.model.schema.models) {
    if (model === table.model) continue;
    const referencingTable = table.db.table(model);
    for (const field of model.fields) {
      if (field instanceof ForeignKeyField) {
        const referencedTable = table.db.table(field.referencedField.model);
        if (referencedTable === table) {
          referencingTables.push({ table: referencingTable, field });
        }
      }
    }
  }
  return referencingTables;
}
