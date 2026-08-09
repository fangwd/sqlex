import { Database } from '../src/database';
import { Connection, ConnectionPool, Dialect, QueryCounter } from '../src/engine';
import { defineRecord, field } from '../src/orm';
import { Schema } from '../src/schema';
import * as helper from './helper';

const schema = new Schema({
  name: 'test',
  tables: [{
    name: 'item',
    columns: [
      { name: 'id', type: 'int', nullable: false },
      { name: 'name', type: 'varchar', nullable: false },
    ],
    constraints: [{ primaryKey: true, columns: ['id'] }],
  }],
});

class LifecycleConnection extends Connection {
  dialect: Dialect = 'generic';
  database = 'test';
  queryCounter = new QueryCounter();
  queries: string[] = [];
  released = false;
  failSelects = false;

  async _query(sql: string): Promise<any> {
    this.queries.push(sql);
    if (this.failSelects && /^select/i.test(sql)) throw Error('query failed');
    return /^insert/i.test(sql) ? 1 : [];
  }

  async end(): Promise<void> {}

  release(): void {
    this.released = true;
  }

  escape(value: unknown): string {
    return `'${String(value)}'`;
  }

  escapeId(name: string): string {
    return `"${name}"`;
  }

  escapeDate(date: Date): string {
    return this.escape(date.toISOString());
  }
}

class LifecyclePool extends ConnectionPool {
  dialect: Dialect = 'generic';
  database = 'test';

  constructor(readonly connection: LifecycleConnection) {
    super();
  }

  async getConnection(): Promise<Connection> {
    return this.connection;
  }

  async end(): Promise<void> {}

  escape(value: unknown): string {
    return `'${String(value)}'`;
  }

  escapeId(name: string): string {
    return `"${name}"`;
  }

  escapeDate(date: Date): string {
    return this.escape(date.toISOString());
  }
}

function database(connection = new LifecycleConnection()) {
  return {
    connection,
    db: new Database(new LifecyclePool(connection), schema),
  };
}

test('clone preserves custom filter configuration', () => {
  const connection = new LifecycleConnection();
  const operators = { near: '<->' };
  const jsonOptions = {
    operatorSyntax: 'explicit' as const,
    operatorDelimiter: '__' as const,
  };
  const db = new Database(
    new LifecyclePool(connection),
    schema,
    operators,
    jsonOptions
  );

  const cloned = db.clone();
  expect(cloned.operatorMap).toBe(operators);
  expect(cloned.jsonFilterOptions).toBe(jsonOptions);
});

test('Database.transaction commits and releases its connection', async () => {
  const { db, connection } = database();
  const value = await db.transaction(async current => {
    expect(current).toBe(connection);
    return 42;
  });

  expect(value).toBe(42);
  expect(connection.queries).toEqual(['begin', 'commit']);
  expect(connection.released).toBe(true);
});

test('Database.transaction rolls back and releases on error', async () => {
  const { db, connection } = database();
  await expect(db.transaction(async () => {
    throw Error('aborted');
  })).rejects.toThrow('aborted');

  expect(connection.queries).toEqual(['begin', 'rollback']);
  expect(connection.released).toBe(true);
});

test('Database.select releases its acquired connection when a query fails', async () => {
  const { db, connection } = database();
  connection.failSelects = true;

  await expect(db.select({ fields: '*', from: 'item' })).rejects.toThrow('query failed');
  expect(connection.released).toBe(true);
});

test('Table.count releases its acquired connection when a query fails', async () => {
  const { db, connection } = database();
  connection.failSelects = true;

  await expect(db.table('item').count()).rejects.toThrow('query failed');
  expect(connection.released).toBe(true);
});

test('Table.replace releases its acquired connection when a query fails', async () => {
  const { db, connection } = database();
  connection.failSelects = true;

  await expect(db.table('item').replace({ id: 1, name: 'broken' }))
    .rejects.toThrow('query failed');
  expect(connection.released).toBe(true);
});

test.each(['getAncestors', 'getDescendants'] as const)(
  'Table.%s releases its acquired connection when a query fails',
  async method => {
    const connection = new LifecycleConnection();
    connection.failSelects = true;
    const treeSchema = new Schema(helper.getExampleData(), {
      models: [{
        table: 'category',
        closureTable: { name: 'category_tree' },
      }],
    });
    const db = new Database(new LifecyclePool(connection), treeSchema);

    await expect(db.table('category')[method](1)).rejects.toThrow('query failed');
    expect(connection.released).toBe(true);
  }
);

test('Database.flush releases its acquired connection when flushing fails', async () => {
  const { db, connection } = database();

  await expect(db.flush({
    afterBegin: async () => {
      throw Error('flush failed');
    },
  })).rejects.toThrow('flush failed');
  expect(connection.released).toBe(true);
});

test('Manager.create skips a re-select when the inserted record is complete', async () => {
  class FastItem extends defineRecord({
    table: 'fast_item',
    fields: {
      id: field.id(),
      name: field.string(),
    },
  }) {}

  const connection = new LifecycleConnection();
  const db = new Database(new LifecyclePool(connection));
  const models = db.bind({ FastItem });
  const item = await models.FastItem.create({ name: 'one trip' });

  expect(item.id).toBe(1);
  expect(item.name).toBe('one trip');
  expect(connection.queries.some(sql => /^select/i.test(sql))).toBe(false);
});
