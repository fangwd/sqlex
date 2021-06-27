const fs = require('fs');

import {
  Connection,
  createConnection,
  createConnectionPool,
  ConnectionPool,
  Dialect
} from '../src/engine';

import { Schema } from '../src/schema';
import { Database } from '../src/database';

export const DB_TYPE = process.env.DB_TYPE || 'mysql';
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASS = process.env.DB_PASS || 'secret';
const DB_NAME = process.env.DB_NAME || 'sqlex_test';

const SCHEMA = fs.readFileSync('tests/data/schema.sql').toString();
const DATA = fs.readFileSync('tests/data/data.sql').toString();

function createSQLite3Database(name): Promise<void> {
  const sqlite3 = require('sqlite3');
  const filename = `${DB_NAME}_${name}`;
  return new Promise(resolve => {
    function _create() {
      const db = new sqlite3.Database(filename);
      db.serialize(function() {
        (SCHEMA + DATA).split(';').forEach(line => {
          const stmt = line.replace(/auto_increment|--.*?(\n|$)/gi, '\n');
          if (stmt.trim() && !/^\s*alter/i.test(stmt)) {
            db.run(stmt);
          }
        });
      });
      db.close(err => {
        if (err) throw err;
        _resolve();
      });
    }

    function _resolve() {
      resolve();
    }

    fs.exists(filename, exists => {
      if (exists) {
        fs.unlink(filename, err => {
          if (err) throw err;
          _create();
        });
      } else {
        _create();
      }
    });
  });
}

function dropSQLite3Database(name): Promise<void> {
  const filename = `${DB_NAME}_${name}`;
  return new Promise(resolve => {
    fs.access(filename, error => {
      if (!error) {
        fs.unlink(filename, err => {
          if (err) throw err;
          resolve();
        });
      }
    });
  });
}

function createSQLite3Connection(name: string): Connection {
  const database = `${DB_NAME}_${name}`;
  return createConnection('sqlite3', { database });
}

async function createPostgresClient(db?: string) {
  const { Client } = require('pg');

  const client = new Client({
    user: DB_USER,
    host: DB_HOST,
    database: db || 'postgres',
    password: DB_PASS
  });

  await client.connect();

  return client;
}

function createPostgresConnection(name: string): Connection {
  return createConnection('postgres', {
    user: DB_USER,
    host: DB_HOST,
    database: getDatabaseName(name),
    password: DB_PASS
  });
}

export async function createPostgresDatabase(
  name: string,
  data = true,
  noend = false,
): Promise<any> {
  const client = await createPostgresClient();
  const database = getDatabaseName(name);
  await client.query(`drop database if exists "${database}"`);
  await client.query(`create database "${database}"`);
  await client.end();

  const db = await createPostgresClient(database);

  const sql = SCHEMA + (data ? DATA : '');
  const lines = sql
    .split(';')
    .filter(line => line.trim())
    .map(line =>
      line
        .replace(/\bdatetime\b/g, 'timestamp(3)')
        .replace(/\buser\b/g, '"user"')
        .replace(/`/g, '"')
        .replace(/integer primary key auto_increment/, 'serial primary key')
    );

  for (const line of lines) {
    await db.query(line);
  }

  const schema = new Schema(getExampleData());
  for (const model of schema.models) {
    if (model.primaryKey.autoIncrement()) {
      const table = model.table.name;
      const id = model.keyField().column.name;
      const seq = `${table}_${id}_seq`;
      await db.query(
        `SELECT setval('${seq}', COALESCE((SELECT MAX("${id}")+1 FROM "${table}"), 1), false)`
      );
    }
  }

  if (!noend) db.end();

  return db;
}

export async function dropPostgresDatabase(name: string): Promise<void> {
  const client = await createPostgresClient();
  const database = getDatabaseName(name);
  await client.query(`drop database if exists "${database}"`);
  await client.end();
}

function createMySQLDatabase(name: string, data = true): Promise<any> {
  const mysql = require('mysql');
  const database = `${DB_NAME}_${name}`;

  const db = mysql.createConnection({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASS
  });

  const sql = SCHEMA + (data ? DATA : '');

  const lines = [
    `drop database if exists ${database}`,
    `create database ${database}`,
    `use ${database}`
  ].concat(sql.split(';').filter(line => line.trim()));

  return serialise(line => {
    return new Promise((resolve, reject) => {
      db.query(line, (error, results, fields) => {
        if (error) reject(Error(error));
        resolve(results);
      });
    });
  }, lines);
}

function dropMySQLDatabase(name: string): Promise<void> {
  const mysql = require('mysql');
  const database = `${DB_NAME}_${name}`;

  const db = mysql.createConnection({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASS
  });

  return new Promise(resolve => {
    db.query(`drop database if exists ${database}`, err => {
      if (err) throw err;
      resolve();
    });
  });
}

function createMySQLConnection(name: string): Connection {
  const database = `${DB_NAME}_${name}`;
  return createConnection('mysql', {
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASS,
    database: database,
    timezone: 'Z',
    connectionLimit: 10
  });
}

function serialise(func, argv: any[]) {
  return new Promise(resolve => {
    const results = [];
    let next = 0;
    function _resolve() {
      if (next >= argv.length) {
        resolve(results);
      } else {
        const args = argv[next++];
        func(args).then(result => {
          results.push(result);
          _resolve();
        });
      }
    }
    _resolve();
  });
}

export function getExampleData() {
  const fileName = require('path').join(
    __dirname,
    '..',
    'tests',
    'data',
    'schema.json'
  );
  return JSON.parse(fs.readFileSync(fileName).toString());
}

export function createDatabase(name: string, data = true): Promise<any> {
  switch (DB_TYPE) {
    case 'mysql':
      return createMySQLDatabase(name, data);
    case 'sqlite3':
      return createSQLite3Database(name);
    case 'postgres':
      return createPostgresDatabase(name);
    default:
      throw Error(`Unsupported engine type: ${DB_TYPE}`);
  }
}

export function dropDatabase(name: string): Promise<any> {
  switch (DB_TYPE) {
    case 'mysql':
      return dropMySQLDatabase(name);
    case 'sqlite3':
      return dropSQLite3Database(name);
    case 'postgres':
      return dropPostgresDatabase(name);
    default:
      throw Error(`Unsupported engine type: ${DB_TYPE}`);
  }
}

export function createTestConnection(name: string): Connection {
  switch (DB_TYPE) {
    case 'mysql':
      return createMySQLConnection(name);
    case 'sqlite3':
      return createSQLite3Connection(name);
    case 'postgres':
      return createPostgresConnection(name);
    default:
      throw Error(`Unsupported engine type: ${DB_TYPE}`);
  }
}

export function createTestConnectionPool(name: string): ConnectionPool {
  const database = `${DB_NAME}_${name}`;
  return createConnectionPool(DB_TYPE as Dialect, {
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASS,
    database: database,
    timezone: 'Z',
    connectionLimit: DB_TYPE === 'sqlite3' ? 1 : 10
  });
}

export function connectToDatabase(name: string, schema?: Schema): Database {
  if (!schema) {
    schema = new Schema(getExampleData());
  }
  const pool = createTestConnectionPool(name);
  return new Database(pool, schema);
}

export function getId(length: number = 8) {
  return Math.random()
    .toString(36)
    .substring(length);
}

export function getDatabaseName(name: string): string {
  return `${DB_NAME}_${name}`;
}

/*
const { parseString } = require('xml2js');
parseString(fs.readFileSync(options.validate).toString(), (err, res) => {
  if (err) throw err;
  const keys = Object.keys(res);
  const key = keys[0].charAt(0).toUpperCase() + keys[0].slice(1);
  validateXstream(schema.model(key), res[keys[0]]);
});

function validateXstream(
  model: Model,
  data: Document,
  map?: Map<string, string>
) {
  if (!map) map = new Map();

  const id = _xmlAttr(data, 'id');

  if (id) {
    map.set(id, model.name);
  }

  const reference = _xmlAttr(data, 'reference');
  if (reference) {
    const type = map.get(reference);
    if (type !== model.name) {
      throw Error(`Reference ${reference}: ${type}`);
    }
  }

  for (const field of model.fields) {
    const value = data[field.name];
    if (value === null || value === undefined) {
      continue;
    }
    if (field instanceof ForeignKeyField) {
      const model = field.referencedField.model;
      validateXstream(model, value[0] as Document, map);
    } else if (field instanceof RelatedField) {
      const model = field.throughField
        ? field.throughField.referencedField.model
        : field.referencingField.model;
      if (typeof value[0] !== 'object') continue; // [ '\n' ]
      if (field.referencingField.isUnique()) {
        validateXstream(model, value[0], map);
      } else {
        const name = Object.keys(value[0])[0];
        if (name !== lcfirst(model.name)) {
          throw Error(`${name} != ${model.name}`);
        }
        for (const entry of value[0][name] as Document[]) {
          validateXstream(model, entry, map);
        }
      }
    }
  }
}

function _xmlAttr(node: any, name: string) {
  return node.$ && (node.$ as any)[name];
}
*/

process.on('unhandledRejection', console.log);
