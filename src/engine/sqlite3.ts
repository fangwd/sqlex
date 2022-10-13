import { Connection, QueryCounter, ConnectionPool, Dialect } from '.';

import * as sqlite3 from 'sqlite3';
import logger from '../logger';

interface PoolOptions {
  connectionLimit: number;
  database: string;
}

type Client = {
  resolve: (connection: _Connection) => void;
  reject: (reason: any) => void;
};

export class _ConnectionPool extends ConnectionPool {
  dialect: Dialect = 'sqlite3';
  options: PoolOptions;
  pool: Array<_Connection>;
  claimed: Array<_Connection>;
  queue: Array<Client>;

  constructor(options: PoolOptions) {
    super();
    this.options = { connectionLimit: 8, ...options };
    this.pool = [];
    this.claimed = [];
    this.queue = [];
    this.database = options.database;
  }

  createConnection() {
    const connection = new _Connection(this.options);
    connection._pool = this;
    this.pool.push(connection);
    return connection;
  }

  get connectionCount() {
    return this.pool.length + this.claimed.length;
  }

  getConnection(): Promise<Connection> {
    return new Promise<_Connection>((resolve, reject) => {
      const client: Client = { resolve, reject };
      if (this.pool.length > 0) {
        this.dispatch(client);
      } else if (this.connectionCount < this.options.connectionLimit) {
        this.createConnection();
        this.dispatch(client);
      } else {
        this.queue.push(client);
      }
    });
  }

  dispatch(client: Client) {
    const connection = this.pool.shift();
    client.resolve(connection);
    this.claimed.push(connection);
  }

  reclaim(connection: _Connection) {
    const index = this.claimed.indexOf(connection);
    if (index !== -1) {
      this.claimed.splice(index, 1);
    }
    this.pool.push(connection);

    if (this.queue.length > 0) {
      const client = this.queue.shift();
      this.dispatch(client);
    }
  }

  async end() {
    for (const connection of this.pool) {
      await connection.end();
    }
    for (const connection of this.claimed) {
      await connection.end();
    }
    this.pool.length = 0;
    this.claimed.length = 0;
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

class _Connection extends Connection {
  _pool: _ConnectionPool;

  dialect: Dialect = 'sqlite3';
  connection: sqlite3.Database;
  queryCounter: QueryCounter = new QueryCounter();

  constructor(options) {
    super();
    this.connection = new sqlite3.Database(options.database, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
    this.database = options.database;
  }

  release(): Promise<void> {
    if (this._pool) {
      this._pool.reclaim(this);
      return Promise.resolve();
    }
    return new Promise(resolve =>
      this.connection.close(err => {
        if (err) throw err;
        resolve();
      })
    );
  }

  _query(sql: string): Promise<any[] | any> {
    this.queryCounter.total++;
    logger.debug(sql);
    return new Promise((resolve, reject) => {
      if (/^\s*select\s/i.test(sql)) {
        this.connection.all(sql, function (err, rows) {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        });
      } else {
        this.connection.run(sql, function (error) {
          if (error) {
            return reject(error);
          }
          if (/^\s*insert\s/i.test(sql)) {
            resolve(this.lastID);
          } else {
            resolve({
              affectedRowCount: this.changes,
            });
          }
        });
      }
    });
  }

  end(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.connection.close(err => {
        if (err) reject(err);
        else resolve();
      });
    });
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
  }
};
