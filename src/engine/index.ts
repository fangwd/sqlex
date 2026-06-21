import { getInformationSchema } from './information_schema';
import { Document, Value } from '../types';
import sprintf, { ArgType } from '../sprintf';
import { isPlainObject } from '../utils';

export type Dialect = 'mysql' | 'postgres' | 'mssql' | 'oracle' | 'sqlite3' | 'generic';

export type ConnectionSettings = string | { [key: string]: any };

export interface ConnectionInfo {
  dialect?: Dialect;
  connection: ConnectionSettings;
  driver?: string;
}

export interface ResolvedConnectionInfo {
  dialect: Dialect;
  connection: { [key: string]: any };
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
  dialect!: Dialect;
  connection: any;
  database!: string;
  queryCounter!: QueryCounter;

  abstract _query(sql: string, pk?: string): Promise<any>;

  query<T = Document[]>(fmt: string, ...args: unknown[]) {
    const val = (args.length === 1 && isPlainObject(args[0])) ? args[0] : args;
    const sql = sprintf(fmt, val as ArgType, this);
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
  abstract release(): void | Promise<void>;

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
  dialect!: Dialect;
  database!: string;

  abstract getConnection(): Promise<Connection>;
  abstract end(): Promise<void>;

  abstract escape(s: string): string;
  abstract escapeId(name: string): string;
  abstract escapeDate(date: Date): string;
}

const URL_DIALECTS: { [key: string]: Dialect } = {
  mysql: 'mysql',
  postgres: 'postgres',
  postgresql: 'postgres',
  sqlite: 'sqlite3',
  sqlite3: 'sqlite3',
};

type ParsedConnectionUrl = {
  dialect?: Dialect;
  options: { [key: string]: any };
};

export function resolveConnectionInfo(info: ConnectionInfo): ResolvedConnectionInfo {
  return resolveConnectionSettings(info.dialect, info.connection, info.driver);
}

function resolveConnectionSettings(
  dialect: Dialect | undefined,
  connection: ConnectionSettings,
  driver?: string,
): ResolvedConnectionInfo {
  const parsed = typeof connection === 'string'
    ? parseConnectionUrl(connection)
    : undefined;
  const resolvedDialect = dialect || parsed?.dialect;

  if (!resolvedDialect) {
    throw Error('Database dialect is required when it cannot be inferred from the connection URL');
  }

  let resolvedConnection =
    typeof connection === 'string' ? (parsed?.options || { database: connection }) : connection;

  if (driver && resolvedConnection.driver === undefined) {
    resolvedConnection = { ...resolvedConnection, driver };
  }

  return { dialect: resolvedDialect, connection: resolvedConnection };
}

function parseConnectionUrl(connection: string): ParsedConnectionUrl | undefined {
  let url: URL;
  try {
    url = new URL(connection);
  } catch {
    return undefined;
  }

  const protocol = url.protocol.replace(/:$/, '').toLowerCase();
  const dialect = URL_DIALECTS[protocol];
  const options: { [key: string]: any } = {};

  if (dialect === 'postgres') {
    options.connectionString = connection;
  } else if (dialect === 'mysql') {
    options.uri = connection;
  }

  if (url.hostname) {
    options.host = decodeUrlValue(url.hostname);
  }
  if (url.port) {
    options.port = Number(url.port);
  }
  if (url.username) {
    options.user = decodeUrlValue(url.username);
  }
  if (url.password) {
    options.password = decodeUrlValue(url.password);
  }

  const database = getUrlDatabase(url, dialect);
  if (database) {
    options.database = database;
  }

  url.searchParams.forEach((value, key) => {
    if (key === 'connectionString' || key === 'uri') {
      return;
    }
    options[key] = parseUrlOption(value);
  });

  return { dialect, options };
}

function getUrlDatabase(url: URL, dialect?: Dialect): string | undefined {
  if (dialect === 'sqlite3') {
    const pathname = decodeUrlValue(url.pathname);
    if (url.hostname && pathname && pathname !== '/') {
      return `${decodeUrlValue(url.hostname)}${pathname}`;
    }
    return pathname || decodeUrlValue(url.hostname) || undefined;
  }

  const pathname = url.pathname.replace(/^\/+/, '');
  return pathname ? decodeUrlValue(pathname) : undefined;
}

function decodeUrlValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseUrlOption(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function createConnectionPool(
  dialect: Dialect | undefined,
  connection: ConnectionSettings,
): ConnectionPool {
  const settings = resolveConnectionSettings(dialect, connection);
  dialect = settings.dialect;
  connection = settings.connection;

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

export function createConnection(dialect: Dialect | undefined, connection: ConnectionSettings): Connection {
  const settings = resolveConnectionSettings(dialect, connection);
  dialect = settings.dialect;
  connection = settings.connection;

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
