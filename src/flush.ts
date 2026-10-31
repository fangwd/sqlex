import {
  Database,
  Table,
  Filter,
  toDocument,
  getUniqueFields,
  _toCamel
} from './database';
import { Record, runRecordAttempt, runtimeOf, withoutRecordAttempt } from './record';

import { Connection, Row } from './engine';
import { encodeFilter } from './filter';
import { SimpleField, ForeignKeyField, RelatedField, UniqueKey } from './schema';
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
  copy(): FlushState {
    const state = new FlushState();
    state.method = this.method;
    state.dirty = new Set(this.dirty);
    state.deleted = this.deleted;
    state.merged = this.merged;
    state.selected = this.selected;
    return state;
  }
  clone(): FlushState {
    const state = this.copy();
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
  const filter = getUniqueFields(model, runtimeOf(record).data as Document);
  if (method === FlushMethod.DELETE) {
    await runtimeOf(record).table._delete(connection, filter!);
    runtimeOf(record).state.deleted = true;
    return record;
  }

  const fields = runtimeOf(record).fields();

  if (method === FlushMethod.UPDATE) {
    const result = await runtimeOf(record).table._update(
      connection,
      fields,
      filter!
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

    // Without a unique key value there is no way to locate the winning row
    // (a database-only unique index, for example); surface the real error
    // rather than masking it with a bad lookup.
    if (filter === undefined) throw error;
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

  return _flushTable(connection, table, perfect);
}

/**
 * Hook callbacks can add records to table lists and maps. Save those public
 * collections before invoking a hook so a failed transaction restores them.
 * Ordinary flush work uses RecordAttempt instead of this snapshot.
 */
function snapshot(db: Database): () => void {
  const tables = db.tableList.map(table => ({
    table,
    recordList: [...table.recordList],
    recordMap: Object.fromEntries(Object.entries(table.recordMap).map(([key, map]) => [key, { ...map }])),
    records: table.recordList.map(record => {
      const runtime = runtimeOf(record);
      return { runtime, data: { ...runtime.data }, state: runtime.state.clone(), inserted: runtime.inserted };
    })
  }));
  return () => {
    for (const { table, recordList, recordMap, records } of tables) {
      table.recordList = [...recordList];
      table.recordMap = Object.fromEntries(Object.entries(recordMap).map(([key, map]) => [key, { ...map }]));
      for (const { runtime, data, state, inserted } of records) {
        runtime.data = { ...data };
        runtime.state = state.clone();
        runtime.inserted = inserted;
      }
    }
  };
}

/** Records whose existing rows one flush lookup statement resolves. */
export const SELECT_BATCH_SIZE = 1000;

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

  async function _select(): Promise<void> {
    const pending = filter.filter(record =>
      runtimeOf(record).isDirty() && !runtimeOf(record).state.selected);
    if (pending.length === 0) return;
    const fields = model.fields.filter(field => nameSet.has(field.name));
    const columns = fields.map(field => dialect.escapeId((field as SimpleField).column.name));
    const from = dialect.escapeId(model.table.name);
    const map = makeMapTable(table);
    // One OR term per record: a single statement for tens of thousands of
    // records makes the database's planning time grow far faster than linearly.
    for (let start = 0; start < pending.length; start += SELECT_BATCH_SIZE) {
      const where = encodeFilter(
        pending.slice(start, start + SELECT_BATCH_SIZE).map(r => runtimeOf(r).filter()),
        table.model,
        dialect,
        table.db.operatorMap,
        table.db.jsonFilterOptions
      );
      const rows = await connection._query(`select ${columns.join(',')} from ${from} where ${where}`);
      rows.forEach((row: Row) => map.append(toDocument(row, table.model)));
    }
    for (const record of pending) {
      if (!runtimeOf(record).isDirty()) continue;
      const existing = map._mapGet(record);
      if (existing) {
        runtimeOf(record).updateState(existing);
      }
    }
    for (const record of pending) {
      if (runtimeOf(record).connect) {
        runtimeOf(record).state.selected = true;
      }
    }
  }

  let insertCount = 0;
  let updateCount = 0;
  let postgresCount = 0;

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
        const result = results[i++];
        if (Array.isArray(result)) {
          entry.records.forEach((record, j) => {
            if (model.primaryKey.autoIncrement()) {
              runtimeOf(record).setPrimaryKey(result[j]);
            }
            runtimeOf(record).state.selected = true;
            runtimeOf(record).state.method = FlushMethod.UPDATE;
            runtimeOf(record).inserted = true;
          });
          continue;
        }
        let id = result as number;
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

  return flushPostgresKeys(connection, table, recordSet, perfect)
    .then(count => {
      postgresCount = count;
      return _select();
    })
    .then(() => _insert())
    .then(() => _update())
    .then(() => {
      return filter.length + insertCount + updateCount + postgresCount;
    });
}

/**
 * Resolve the common PostgreSQL case with a single declared natural key. The
 * insert arbiter closes the select/insert race. RETURNING tells us which rows
 * this attempt inserted; a separate statement reads the rows it did not insert
 * after a competing transaction has committed. This also preserves the exact
 * meaning of RecordRuntime.inserted without relying on PostgreSQL system
 * columns or a particular server version.
 *
 * Record state changes stay in the RecordAttempt until COMMIT. Records with a
 * supplied primary key and complex tables stay on the existing path.
 */
async function flushPostgresKeys(
  connection: Connection,
  table: Table,
  recordSet: Set<Record>,
  perfect?: number
): Promise<number> {
  if (connection.dialect !== 'postgres') return 0;
  const model = table.model;
  const naturalKeys = model.uniqueKeys.filter(key => !key.primary);
  if (!model.keyField() || !model.primaryKey.autoIncrement() || naturalKeys.length !== 1) return 0;
  const key = naturalKeys[0];
  const groups = new Map<string, { names: string[]; records: Record[] }>();
  for (const record of table.recordList) {
    const runtime = runtimeOf(record);
    if (!recordSet.has(record) || runtime.state.method !== FlushMethod.INSERT ||
        runtime.connect || runtime.state.selected || !runtime.isFlushable(perfect) ||
        runtime.primaryKey() !== undefined) continue;
    if (key.fields.some(field => runtime.value(field.name) == null)) continue;
    const names = [...new Set([...key.fields.map(field => field.name), ...Object.keys(runtime.fields())])].sort();
    const groupName = `${runtime.insertOnly ? 'only:' : 'write:'}${names.join('\0')}`;
    let group = groups.get(groupName);
    if (!group) {
      group = { names, records: [] };
      groups.set(groupName, group);
    }
    group.records.push(record);
  }

  let count = 0;
  for (const [, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const { names } = group;
    const fields = names.map(name => model.field(name) as SimpleField);
    const sorted = group.records.sort((a, b) => keyOfRecord(a, key).localeCompare(keyOfRecord(b, key)));
    for (let start = 0; start < sorted.length; start += SELECT_BATCH_SIZE) {
      const records = sorted.slice(start, start + SELECT_BATCH_SIZE);
      const byKey = new Map(records.map(record => [keyOfRecord(record, key), record]));
      // A batch with duplicate arbiter keys would raise a cardinality error if
      // updated in one statement. mergeRecords normally eliminates these, but
      // leave unusual key encodings on the legacy path instead of mis-mapping.
      if (byKey.size !== records.length) continue;
      const column = (field: SimpleField) => connection.escapeId(field.column.name);
      const values = records.map(record => `(${fields.map(field =>
        table.escapeValue(field, runtimeOf(record).value(field.name))).join(',')})`);
      const sql = `insert into ${connection.escapeId(table.name)} ` +
        `(${fields.map(column).join(',')}) values ${values.join(',')} ` +
        `on conflict (${key.fields.map(column).join(',')}) do nothing ` +
        `returning ${[model.keyField()!, ...key.fields].map(column).join(',')}`;
      const inserted = await postgresWrite(connection, sql) as Row[];
      const remaining = new Map(byKey);
      for (const row of inserted) {
        const doc = toDocument(row, model);
        const record = remaining.get(keyOfDocument(doc, key, model));
        if (!record) throw Error(`Cannot match inserted ${table.name} row by unique key`);
        const runtime = runtimeOf(record);
        runtime.setPrimaryKey(model.keyValue(doc)!);
        runtime.removeDirty(names);
        runtime.state.selected = true;
        runtime.state.method = FlushMethod.UPDATE;
        runtime.inserted = true;
        remaining.delete(keyOfRecord(record, key));
      }
      if (remaining.size > 0) {
        const updates: { record: Record; fields: Document }[] = [];
        const selectFields = [...new Set([model.keyField()!.name, ...names])]
          .map(name => model.field(name) as SimpleField);
        const where = [...remaining.values()].map(record => `(${key.fields.map(field =>
          `${column(field)}=${table.escapeValue(field, runtimeOf(record).value(field.name))}`
        ).join(' and ')})`).join(' or ');
        const rows = await connection._query(
          `select ${selectFields.map(column).join(',')} from ${connection.escapeId(table.name)} where ${where}`
        ) as Row[];
        for (const row of rows) {
          const doc = toDocument(row, model);
          const record = remaining.get(keyOfDocument(doc, key, model));
          if (!record) continue;
          const runtime = runtimeOf(record);
          runtime.setPrimaryKey(model.keyValue(doc)!);
          runtime.state.selected = true;
          runtime.state.method = FlushMethod.UPDATE;
          runtime.removeDirty(key.fields.map(field => field.name));
          if (runtime.insertOnly) {
            runtime.state.dirty.clear();
          } else {
            const changed: Document = {};
            for (const name of names) {
              if (key.fields.some(field => field.name === name)) continue;
              const value = runtime.value(name);
              if (sameValue(model.field(name) as SimpleField, value, model.valueOf(doc, name))) {
                runtime.removeDirty(name);
              } else {
                changed[name] = value;
              }
            }
            if (Object.keys(changed).length > 0) {
              updates.push({ record, fields: changed });
            }
          }
          remaining.delete(keyOfRecord(record, key));
        }
        if (remaining.size > 0) {
          throw new ConcurrentChangeError(`Cannot resolve ${table.name} row after ON CONFLICT DO NOTHING`);
        }
        await updatePostgresConflicts(connection, table, key, updates);
      }
      count += records.length;
    }
  }
  return count;
}

async function updatePostgresConflicts(
  connection: Connection,
  table: Table,
  key: UniqueKey,
  updates: { record: Record; fields: Document }[]
): Promise<void> {
  const groups = new Map<string, typeof updates>();
  const individual: typeof updates = [];
  const keyBatchable = key.fields.every(field => valuesLiteralType(field));
  for (const update of updates) {
    const names = Object.keys(update.fields).sort();
    const simple = keyBatchable &&
      names.every(name => valuesLiteralType(table.model.field(name) as SimpleField));
    const groupName = simple ? names.join('\0') : '';
    if (!groupName) {
      individual.push(update);
      continue;
    }
    let group = groups.get(groupName);
    if (!group) {
      group = [];
      groups.set(groupName, group);
    }
    group.push(update);
  }

  const escape = (field: SimpleField) => connection.escapeId(field.column.name);
  for (const update of individual.sort((a, b) =>
    keyOfRecord(a.record, key).localeCompare(keyOfRecord(b.record, key)))) {
    const result = await table._update(connection, update.fields, runtimeOf(update.record).filter())
      .catch(markNonRetryableUnique);
    if ((result?.affectedRowCount ?? result?.affectedRows ?? 0) !== 1) {
      throw new ConcurrentChangeError(`${table.name} row changed before conflict update`);
    }
    runtimeOf(update.record).removeDirty(Object.keys(update.fields));
  }
  for (const [, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const names = Object.keys(group[0].fields).sort();
    const changedFields = names.map(name => table.model.field(name) as SimpleField);
    group.sort((a, b) => keyOfRecord(a.record, key).localeCompare(keyOfRecord(b.record, key)));
    for (let start = 0; start < group.length; start += SELECT_BATCH_SIZE) {
      const chunk = group.slice(start, start + SELECT_BATCH_SIZE);
      if (changedFields.some(field => chunk.every(item => item.fields[field.name] == null) &&
          valuesLiteralType(field) === 'scalar')) {
        for (const item of chunk) {
          const result = await table._update(connection, item.fields, runtimeOf(item.record).filter())
            .catch(markNonRetryableUnique);
          if ((result?.affectedRowCount ?? result?.affectedRows ?? 0) !== 1) {
            throw new ConcurrentChangeError(`${table.name} row changed before conflict update`);
          }
          runtimeOf(item.record).removeDirty(names);
        }
        continue;
      }
      const columns = [...key.fields, ...changedFields];
      const values = chunk.map(item => `(${columns.map(field =>
        table.escapeValue(field, key.fields.includes(field)
          ? runtimeOf(item.record).value(field.name)
          : item.fields[field.name] as Value)).join(',')})`);
      const joins = key.fields.map(field => `target.${escape(field)} = incoming.${escape(field)}`).join(' and ');
      const assignments = changedFields.map(field => `${escape(field)} = incoming.${escape(field)}`).join(',');
      const sql = `update ${connection.escapeId(table.name)} as target set ${assignments} ` +
        `from (values ${values.join(',')}) as incoming (${columns.map(escape).join(',')}) ` +
        `where ${joins} returning target.${escape(table.model.keyField()!)}`;
      const updated = await postgresWrite(connection, sql) as Row[];
      if (updated.length !== chunk.length) {
        throw new ConcurrentChangeError(`${table.name} row changed before conflict update`);
      }
      for (const item of chunk) runtimeOf(item.record).removeDirty(names);
    }
  }
}

const TEXT_TYPE = /^(char|character|varchar|character varying|text)$/i;
const SCALAR_TYPE =
  /^(smallint|int|integer|bigint|int2|int4|int8|decimal|numeric|real|float|float4|float8|double|double precision|bool|boolean)$/i;

/**
 * How an escaped literal of this column reads from an untyped VALUES table:
 * 'text' columns accept the resolved text type, 'scalar' columns need at least
 * one non-null value to fix their type, and other types are not supported.
 */
function valuesLiteralType(field: SimpleField): 'text' | 'scalar' | undefined {
  const type = field.column.type.replace(/\s*\(.*\)$/, '');
  if (TEXT_TYPE.test(type)) return 'text';
  if (SCALAR_TYPE.test(type)) return 'scalar';
}

/** A row changed between statements of one attempt; a fresh attempt can resolve it. */
class ConcurrentChangeError extends Error {}

async function postgresWrite(connection: Connection, sql: string): Promise<unknown> {
  try {
    return await connection._query(sql);
  } catch (error) {
    throw markNonRetryableUnique(error);
  }
}

function markNonRetryableUnique(error: unknown): never {
  if (error && typeof error === 'object' && (error as { code?: string }).code === '23505') {
    (error as { noUniqueRetry?: boolean }).noUniqueRetry = true;
  }
  throw error;
}

function keyOfRecord(record: Record, key: UniqueKey): string {
  return keyString(key.fields.map(field => runtimeOf(record).value(field.name)));
}

function keyOfDocument(doc: Document, key: UniqueKey, model: Table['model']): string {
  return keyString(key.fields.map(field => model.valueOf(doc, field)));
}

function keyString(values: (Value | undefined)[]): string {
  return JSON.stringify(values.map(value => value instanceof Date ? value.toISOString() : value));
}

/** Whether a supplied value equals a stored one, so the update can be skipped. */
function sameValue(field: SimpleField, value: Value, stored: Value | undefined): boolean {
  return keyString([_toCamel(value, field)]) === keyString([_toCamel(stored, field)]);
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

/** Stable parent-before-child order for required schema references. */
function orderedTables(db: Database): Table[] {
  const tables = [...db.tableList].sort((a, b) => a.name.localeCompare(b.name));
  const byModel = new Map(tables.map(table => [table.model, table]));
  const remaining = new Set(tables);
  const result: Table[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter(table => !table.model.fields.some(field =>
      field instanceof ForeignKeyField && !field.column.nullable &&
      field.referencedField.model !== table.model &&
      remaining.has(byModel.get(field.referencedField.model)!)
    ));
    if (ready.length === 0) {
      // A schema cycle need not occur in the current records. Actual unresolved
      // record references are diagnosed if the flush cannot make progress.
      result.push(...remaining);
      break;
    }
    for (const table of ready) {
      result.push(table);
      remaining.delete(table);
    }
  }
  return result;
}

function readyTables(tables: Table[], perfect?: number): Table[] {
  return tables.filter(table => table.recordList.some(record =>
    runtimeOf(record).isDirty() && runtimeOf(record).isFlushable(perfect)));
}

/** A progress marker for the still-dirty records, including resolved parents. */
function dirtyStamp(db: Database): string {
  return db.tableList.map(table => table.recordList.map(record => {
    const runtime = runtimeOf(record);
    if (!runtime.isDirty()) return '';
    const state = runtime.state;
    return [state.method, state.selected, Boolean(state.merged),
      [...state.dirty].sort().join(','), String(runtime.primaryKey())].join(':');
  }).join('|')).join(';');
}

async function flushDatabaseA(connection: Connection, db: Database): Promise<void> {
  const tables = orderedTables(db);
  for (;;) {
    const ready = readyTables(tables, 1);
    if (ready.length === 0) return;
    const before = dirtyStamp(db);
    for (const table of ready) await flushTable(connection, table, 1);
    if (dirtyStamp(db) === before) return;
  }
}

export async function flushDatabaseB(connection: Connection, db: Database, allowPartial: boolean): Promise<boolean> {
  const tables = orderedTables(db);
  while (db.getDirtyCount() > 0) {
    const ready = readyTables(tables);
    if (ready.length === 0) return incompleteFlush(db, allowPartial);
    const before = dirtyStamp(db);
    for (const table of ready) await flushTable(connection, table);
    if (dirtyStamp(db) === before) return incompleteFlush(db, allowPartial);
  }
  return true;
}

function incompleteFlush(db: Database, allowPartial: boolean): boolean {
  if (allowPartial) return false;
  const cycle = blockedRecordCycle(db);
  if (cycle) throw Error(`Circular references: ${cycle}`);
  dumpDirtyRecords(db);
  throw Error('Incomplete data');
}

function blockedRecordCycle(db: Database): string | undefined {
  const blocked = new Set(db.tableList.flatMap(table => table.recordList.filter(record =>
    runtimeOf(record).isDirty() && !runtimeOf(record).state.merged)));
  const visiting = new Set<Record>();
  const visited = new Set<Record>();
  const path: { record: Record; field: string }[] = [];
  function visit(record: Record): string | undefined {
    if (visiting.has(record)) {
      const start = path.findIndex(entry => entry.record === record);
      return path.slice(start).map(entry => `${runtimeOf(entry.record).table.name}.${entry.field}`)
        .concat(`${runtimeOf(record).table.name}.${path[start].field}`).join(' -> ');
    }
    if (visited.has(record)) return;
    visiting.add(record);
    const runtime = runtimeOf(record);
    for (const field of runtime.state.dirty) {
      let parent = runtime.data[field];
      if (!(parent instanceof Record)) continue;
      while (runtimeOf(parent).state.merged) parent = runtimeOf(parent).state.merged!;
      if (!blocked.has(parent)) continue;
      const parentRuntime = runtimeOf(parent);
      const schemaField = runtime.table.model.field(field);
      const keyName = schemaField instanceof ForeignKeyField
        ? schemaField.referencedField.name
        : parentRuntime.table.model.primaryKey.fields[0].name;
      if (!parentRuntime.state.dirty.has(keyName) && parentRuntime.value(keyName) !== undefined) continue;
      path.push({ record, field });
      const cycle = visit(parent);
      if (cycle) return cycle;
      path.pop();
    }
    visiting.delete(record);
    visited.add(record);
  }
  for (const record of blocked) {
    const cycle = visit(record);
    if (cycle) return cycle;
  }
}

export interface FlushOptions {
  afterBegin?: (c: Connection) => Promise<any>;
  beforeCommit?: (c: Connection) => Promise<any>;
  replaceRecordsIn?: string[];
  /** Limits replaceRecordsIn to these root records (default: all of them). */
  replaceRoots?: Record[];
  allowPartial?: boolean;
}

export async function flushDatabase(
  connection: Connection,
  db: Database,
  options: FlushOptions = {}
): Promise<boolean> {
  let perfect = true;
  const hasHooks = Boolean(options.afterBegin || options.beforeCommit);
  for (let retries = 0; ; retries++) {
    // Hooks may append or clear records, changing the table's identity maps.
    // Ordinary flushes only change RecordRuntime state, which the attempt owns.
    const restore = hasHooks ? snapshot(db) : undefined;
    try {
      return await runRecordAttempt('flush', () =>
        connection.transaction(async () => {
          if (options.afterBegin) await options.afterBegin(connection);
          if (perfect) await flushDatabaseA(connection, db);
          const complete = await flushDatabaseB(connection, db, options.allowPartial ?? false);
          if (options.replaceRecordsIn) {
            await replaceRecordsIn(connection, db, options.replaceRecordsIn, options.replaceRoots);
          }
          if (options.beforeCommit) await options.beforeCommit(connection);
          return complete;
        }) as Promise<boolean>
      );
    } catch (error) {
      if (restore) withoutRecordAttempt(restore);
      if (perfect && isIntegrityError(error)) {
        perfect = false;
      } else if (!isRetryable(error)) {
        throw error;
      }
      if (retries >= 7) throw error;
      const backoff = Math.min(500, 10 * 2 ** retries);
      await new Promise(resolve => setTimeout(resolve, Math.random() * backoff));
    }
  }
}

function errorText(error: unknown): string {
  const { message, error: nested } = (error ?? {}) as { message?: string; error?: string };
  return message || nested || '';
}

function isIntegrityError(error: unknown) {
  const { code, errno, noUniqueRetry } = (error ?? {}) as {
    code?: string | number; errno?: number; noUniqueRetry?: boolean
  };
  if (noUniqueRetry) return false;
  if (code !== undefined) {
    return code === '23505' || code === 'ER_DUP_ENTRY' || code === 1062 ||
      code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
      (code === 'SQLITE_CONSTRAINT' && /UNIQUE constraint|PRIMARY KEY/i.test(errorText(error)));
  }
  if (errno !== undefined) return errno === 1062;
  return /\bDuplicate\b|UNIQUE constraint/i.test(errorText(error));
}

function isRetryable(error: unknown) {
  if (error instanceof ConcurrentChangeError) return true;
  const { message, code, errno } = (error ?? {}) as {
    message?: string; code?: string | number; errno?: number
  };
  if (code !== undefined) {
    return code === '40P01' || code === '40001' ||
      code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT' ||
      code === 1213 || code === 1205 ||
      (typeof code === 'string' && /^(SQLITE_BUSY|SQLITE_LOCKED)/.test(code));
  }
  if (errno !== undefined) return errno === 1213 || errno === 1205;
  return /\b(Deadlock|locked|serialization failure)\b/i.test(message || '');
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
): Promise<Value | Value[]> {
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
  const pk = table.model.keyField()!.column.name;
  if (connection.dialect === 'postgres') {
    // Sequence values of concurrent inserts can interleave, so read every id
    // instead of assuming they are consecutive.
    return connection
      ._query(`${query} returning ${escape(pk)}`)
      .then((rows: Row[]) => rows.map(row => row[pk] as Value));
  }
  return connection._query(query, pk);
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
      const value = runtimeOf(record).referenceValue(field.referencingField);

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
  names: string[],
  roots?: Record[]
) {
  if (names.length === 0) return;

  const table = db.table(names[0]);

  const values = (roots ?? table.recordList)
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
