import { getInformationSchema } from './information_schema';
import { Document, Value } from '../types';
import sprintf from '../sprintf';
import { isPlainObject } from '../utils';

export type Dialect = 'mysql' | 'postgres' | 'mssql' | 'oracle' | 'sqlite3' | 'generic';

export interface ConnectionInfo {
  dialect: Dialect;
  connection: { [key: string]: any };
  driver?: string;
}

export type Row = {
  [key: string]: Value;
};

export class QueryCounter {
  total: number = 0;
}

export type TransactionCallback = (
  connection: Connection
) => Promise<any> | void;

export interface DialectEncoder {
  dialect: Dialect;
  escape: (unsafe: any) => string;
  escapeId: (unsafe: string) => string;
  escapeDate: (date: Date) => string;
}

export abstract class Connection implements DialectEncoder {
  dialect: Dialect;
  connection: any;
  database: string;
  queryCounter: QueryCounter;

  abstract _query(sql: string, pk?: string): Promise<any>;

  query<T = Document[]>(fmt: string, ...args) {
    const val = (args.length === 1 && isPlainObject(args[0])) ? args[0] : args;
    const sql = sprintf(fmt, val, this);
    return this._query(sql) as Promise<T>;
  }

  beginTransaction(): Promise<void> {
    return this._query('begin');
  }

  commit(): Promise<void> {
    return this._query('commit');
  }

  rollback(): Promise<void> {
    return this._query('rollback');
  }

  abstract end(): Promise<void>;
  abstract release();

  abstract escape(s: string): string;
  abstract escapeId(name: string): string;
  abstract escapeDate(date: Date): string;

  async transaction(callback: TransactionCallback) {
    await this.beginTransaction();
    try {
      const promise = callback(this);
      if (promise instanceof Promise) {
        const result = await promise;
        await this.commit();
        return result;
      }
      // else: caller has dealt with the transaction
    } catch (error) {
      await this.rollback();
      throw error;
    }
  }
}

export abstract class ConnectionPool implements DialectEncoder {
  dialect: Dialect;
  database: string;

  abstract getConnection(): Promise<Connection>;
  abstract end(): Promise<void>;

  abstract escape(s: string): string;
  abstract escapeId(name: string): string;
  abstract escapeDate(date: Date): string;
}

export function createConnectionPool(
  dialect: Dialect,
  connection: any,
): ConnectionPool {
  if (dialect === 'mysql') {
    return require('./mysql').default.createConnectionPool(connection);
  }

  if (dialect === 'sqlite3') {
    return require('./sqlite3').default.createConnectionPool(connection);
  }

  if (dialect === 'postgres') {
    return require('./postgres').default.createConnectionPool(connection);
  }

  if (dialect === 'generic') {
    return require('./generic').default.createConnectionPool(connection);
  }

  throw Error(`Unsupported engine type: ${dialect}`);
}

export function createConnection(dialect: string, connection: any): Connection {
  if (dialect === 'mysql') {
    const result = require('./mysql').default.createConnection(connection);
    result.name = connection.database;
    return result;
  }

  if (dialect === 'sqlite3') {
    return require('./sqlite3').default.createConnection(connection);
  }

  if (dialect === 'postgres') {
    return require('./postgres').default.createConnection(connection);
  }

  if (dialect === 'generic') {
    return require('./generic').default.createConnection(connection);
  }

  throw Error(`Unsupported engine type: ${dialect}`);
}

export { getInformationSchema };
