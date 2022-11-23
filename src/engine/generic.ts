import { Connection, QueryCounter, ConnectionPool, Dialect } from '.';
import logger from '../logger';

interface PoolOptions {
  connectionLimit: number;
  connectionWait: number;
  driver: string;
  database: string;
}

type Client<Connection> = {
  resolve: (connection: Connection) => void;
  reject: (reason: any) => void;
  createdAt: number;
  id: number;
};

export class GenericPool<Resource extends { end: () => void; history: QueryHistory }> {
  idle: Array<Resource>;
  busy: Array<Resource>;
  queue: Array<Client<Resource>>;
  nextClientId = 0;
  intervalId: any;

  constructor(
    private create: () => Resource,
    public maxSize: number = 1,
    public maxClientWaitTime = 1000
  ) {
    this.idle = [];
    this.busy = [];
    this.queue = [];
    this.intervalId = setInterval(this.checkConnectionLeak.bind(this), 500);
  }

  get connectionCount() {
    return this.idle.length + this.busy.length;
  }

  allocate(): Promise<Resource> {
    return new Promise<Resource>((resolve, reject) => {
      const client: Client<Resource> = {
        resolve,
        reject,
        createdAt: new Date().getTime(),
        id: this.nextClientId++,
      };
      if (this.idle.length > 0) {
        this.assign(client);
      } else if (this.connectionCount < this.maxSize) {
        const conn = this.create();
        this.idle.push(conn);
        this.assign(client);
      } else {
        this.queue.push(client);
      }
    });
  }

  assign(client: Client<Resource>) {
    const item = this.idle.shift();
    this.busy.push(item);
    client.resolve(item);
  }

  reclaim(item: Resource) {
    const index = this.busy.indexOf(item);
    item.history.clear();
    if (index !== -1) {
      this.busy.splice(index, 1);
    }
    this.idle.push(item);
    if (this.queue.length > 0) {
      const client = this.queue.shift();
      this.assign(client);
    }
  }

  async end() {
    clearInterval(this.intervalId);
    for (const item of this.idle) {
      await item.end();
    }
    for (const item of this.busy) {
      await item.end();
    }
    this.idle.length = 0;
    this.busy.length = 0;
  }

  checkConnectionLeak() {
    const now = new Date().getTime();
    for (const entry of this.queue) {
      if (now - entry.createdAt > this.maxClientWaitTime) {
        const seconds = ((now - entry.createdAt) / 1000.0).toFixed(2);
        for (const item of this.busy) {
          const last = item.history.last();
          if (last && last.error) {
            const history = item.history.records.map((rec) => ({
              query: rec.query,
              error: rec.error,
            }));
            logError(history);
            this.reclaim(item);
            return;
          }
        }
        logError(`client ${entry.id} has waited for ${seconds} second(s)`);
      }
    }
  }
}

export class _ConnectionPool extends ConnectionPool {
  dialect: Dialect = 'generic';
  options: PoolOptions;
  pool: GenericPool<_Connection>;

  constructor(options: PoolOptions) {
    super();
    this.options = { connectionLimit: 8, connectionWait: 1000, ...options };
    this.pool = new GenericPool(
      () => {
        const connection = new _Connection(this.options);
        connection._pool = this;
        return connection;
      },
      this.options.connectionLimit,
      this.options.connectionLimit
    );
    this.database = options.database;
  }

  get connectionCount() {
    return this.pool.connectionCount;
  }

  getConnection(): Promise<Connection> {
    return this.pool.allocate();
  }

  end() {
    return Promise.resolve(this.pool.end());
  }

  escape(value: string): string {
    return `'${(value + '').replace(/'/g, "''")}'`;
  }

  escapeId(name: string) {
    return `"${name}"`;
  }

  escapeDate(date: Date) {
    return escapeDate(date);
  }
}

function escapeDate(date: Date) {
  return "'" + date.toISOString() + "'";
}

type GenericCommandResult = {
  insertId: number;
  affectedRowCount: number;
};

type GenericRow = { [key: string]: number | string | Buffer | null };

export type GenericQueryResult = GenericCommandResult | Array<GenericRow>;

type GenericError = {
  code: number;
  message: string;
};

type GenericConnection = {
  query: (
    query: string,
    callback: (error: GenericError | null, result?: GenericQueryResult) => void
  ) => void;
  close: () => void;
};

type Driver = { Connection: { new (connStr: string): GenericConnection } };

export class QueryRecord {
  query: string;
  startTime: Date;
  endTime?: Date;
  error?: any;
  constructor(query: string) {
    this.query = query;
    this.startTime = new Date();
  }
  close(error: any) {
    this.error = error;
    this.endTime = new Date();
  }
}

export class QueryHistory {
  records: QueryRecord[];
  constructor() {
    this.records = [];
  }

  clear() {
    this.records.length = 0;
  }

  push(query: string) {
    const record = new QueryRecord(query);
    this.records.push(record);
    return record;
  }

  last() {
    return this.records.length > 0 ? this.records[this.records.length - 1] : null;
  }
}

class _Connection extends Connection {
  _pool: _ConnectionPool;
  _connected: boolean;

  dialect: Dialect = 'generic';
  driver: Driver;
  connection: GenericConnection;
  queryCounter: QueryCounter = new QueryCounter();
  history: QueryHistory;

  constructor(options: { driver: string; database: string }) {
    super();
    const driver = options.driver || process.env['SQLEX_DRIVER'] || './lib/mydb';
    this.driver = require(driver);
    this.connection = new this.driver.Connection('sqlite3://' + options.database);
    this.database = options.database;
    this.history = new QueryHistory();
  }

  release(): Promise<void> {
    if (this._pool) {
      this._pool.pool.reclaim(this);
      return Promise.resolve();
    }
    return Promise.resolve(this.connection.close());
  }

  async _query(sql: string): Promise<any[] | any> {
    this.queryCounter.total++;
    logger.debug(sql);
    const record = this.history.push(sql);
    return new Promise((resolve, reject) => {
      this.connection.query(sql, (error, result) => {
        record.close(error);
        if (error) {
          reject(error);
        } else if (
          /^\s*insert\s/i.test(sql) &&
          typeof (result as GenericCommandResult).insertId === 'number'
        ) {
          resolve((result as GenericCommandResult).insertId);
        } else {
          resolve(result);
        }
      });
    });
  }

  end(): Promise<void> {
    return Promise.resolve(this.connection.close());
  }

  escape(value: string): string {
    return `'${(value + '').replace(/'/g, "''")}'`;
  }

  escapeId(name: string) {
    return `"${name}"`;
  }

  escapeDate(date: Date) {
    return escapeDate(date);
  }
}

export default {
  createConnectionPool: (options): ConnectionPool => {
    return new _ConnectionPool(options);
  },
  createConnection: (options): Connection => {
    return new _Connection(options);
  },
};

export function logError(error: any) {
  if (typeof error !== 'string') {
    error = JSON.stringify(error, null, 4);
  }
  process.stderr.write('Error: ' + error);
  if (!error.endsWith('\n')) {
    process.stderr.write('\n');
  }
}
