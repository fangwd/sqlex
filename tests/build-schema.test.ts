import { Database } from '../src/database';
import { Connection, ConnectionPool, Dialect, QueryCounter, Row } from '../src/engine';

class RejectingPool extends ConnectionPool {
  dialect: Dialect = 'generic';
  database = 'test';

  async getConnection(): Promise<Connection> {
    throw new Error('connection failed');
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

class FailingConnection extends Connection {
  dialect: Dialect = 'generic';
  database = 'test';
  queryCounter = new QueryCounter();
  released = false;

  async _query(_sql: string): Promise<Row[]> {
    throw new Error('schema query failed');
  }

  async end(): Promise<void> {
    this.released = true;
  }

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

class FailingSchemaPool extends RejectingPool {
  constructor(private readonly connection: FailingConnection) {
    super();
  }

  async getConnection(): Promise<Connection> {
    return this.connection;
  }
}

test('buildSchema rejects when a connection cannot be acquired', async () => {
  const db = new Database(new RejectingPool());

  await expect(db.buildSchema()).rejects.toThrow('connection failed');
});

test('buildSchema rejects and releases the connection when introspection fails', async () => {
  const connection = new FailingConnection();
  const db = new Database(new FailingSchemaPool(connection));

  await expect(db.buildSchema()).rejects.toThrow('schema query failed');
  expect(connection.released).toBe(true);
});
