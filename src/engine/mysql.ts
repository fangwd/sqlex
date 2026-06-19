import { Connection, QueryCounter, ConnectionPool, Dialect } from '.';

import * as mysql from 'mysql2';
import logger from '../logger';
import { ResultSetHeader, PoolOptions, ConnectionOptions } from 'mysql2';

class _ConnectionPool extends ConnectionPool {
  dialect: Dialect = 'mysql';
  private pool: mysql.Pool;

  constructor(options: PoolOptions) {
    super();
    this.pool = mysql.createPool(options);
    this.database = options.database as string;
  }

  getConnection(): Promise<Connection> {
    return new Promise((resolve, reject) => {
      return this.pool.getConnection((error, connection) => {
        if (error) reject(Error(error.message));
        resolve(new _Connection(connection, this.database));
      });
    });
  }

  end(): Promise<void> {
    return new Promise((resolve, reject) => {
      return this.pool.end(error => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  escape(value: string): string {
    return mysql.escape(value);
  }

  escapeId(name: string) {
    return mysql.escapeId(name);
  }

  escapeDate(date: Date) {
    return escapeDate(date);
  }
}

function escapeDate(date: Date) {
  return mysql.escape(date
    .toISOString()
    .replace('T', ' ')
    .replace(/Z$/, '')
  );
 }


class _Connection extends Connection {
  dialect: Dialect = 'mysql';
  connection: mysql.Connection | mysql.PoolConnection;
  queryCounter: QueryCounter = new QueryCounter();

  constructor(options: ConnectionOptions | mysql.PoolConnection, connected?: string) {
    super();
    if (connected) {
      this.connection = options as mysql.PoolConnection;
      this.database = connected;
    } else {
      const config = options as ConnectionOptions;
      this.connection = mysql.createConnection(config);
      this.database = config.database as string;
    }
  }

  release() {
    const connection = this.connection as mysql.PoolConnection;
    if (typeof connection.release === 'function') {
      connection.release();
    }
  }

  _query(sql: string): Promise<any | void> {
    this.queryCounter.total++;
    logger.debug(sql);
    return new Promise((resolve, reject) =>
      this.connection.query<ResultSetHeader>(sql, (error, results, fields) => {
        if (error) {
          return reject(error);
        }
        if (results.insertId) {
          resolve(results.insertId);
        } else {
          resolve(results);
        }
      })
    );
  }

  end(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.connection.end(err => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  escape(value: string): string {
    return mysql.escape(value);
  }

  escapeId(name: string) {
    return mysql.escapeId(name);
  }

  escapeDate(date: Date) {
    return escapeDate(date);
  }
}

export default {
  createConnectionPool: (options: PoolOptions): ConnectionPool => {
    return new _ConnectionPool(options);
  },
  createConnection: (options: ConnectionOptions): Connection => {
    return new _Connection(options);
  }
};
