import { Schema } from '../src/schema';
import { exportSchemaJava, printSchema, printSchemaTypeMap, getTypeName, DataType } from '../src/print';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as helper from './helper';
import { Database, Table, Column, Constraint } from '../src/types';

test('print', () => {
  const schema = new Schema(helper.getExampleData());
  const result = printSchema(schema);
  expect(/\bname\?:\s+string;/.test(result)).toBe(true);
  expect(/\bparent\?:\s+Category;/.test(result)).toBe(true);
  expect(/\border:\s+Order;/.test(result)).toBe(true);
  expect(/\borderItems:\s+OrderItem\[\];/.test(result)).toBe(true);
  expect(/\borderShipping:\s+OrderShipping;/.test(result)).toBe(true);
});

describe('getTypeName', () => {
  test('maps json to object', () => {
    expect(getTypeName('json')).toBe('object');
  });

  test('maps jsonb to object', () => {
    expect(getTypeName('jsonb')).toBe('object');
  });

  test('still maps known types correctly', () => {
    expect(getTypeName('varchar')).toBe('string');
    expect(getTypeName('int')).toBe('number');
    expect(getTypeName('datetime')).toBe('Date');
    expect(getTypeName('boolean')).toBe('boolean');
  });

  test('throws on unknown type', () => {
    expect(() => getTypeName('unknown_type_xyz')).toThrow();
  });
});

describe('printSchema with json column', () => {
  test('generates object type for json columns', () => {
    const schemaInfo: Database = {
      name: 'test',
      tables: [
        {
          name: 'product',
          columns: [
            { name: 'id', type: 'int', autoIncrement: true },
            { name: 'name', type: 'varchar', size: 100 },
            { name: 'metadata', type: 'json' },
            { name: 'settings', type: 'jsonb' },
          ],
          constraints: [
            { primaryKey: true, columns: ['id'] },
          ]
        }
      ]
    };
    const schema = new Schema(schemaInfo);
    const result = printSchema(schema);
    expect(result).toMatch(/metadata\?:\s+object;/);
    expect(result).toMatch(/settings\?:\s+object;/);
  });
});

test('printSchema marks only nullable scalar fields optional', () => {
  const schema = new Schema({
    name: 'test',
    tables: [{
      name: 'item',
      columns: [
        { name: 'key', type: 'varchar', nullable: false },
        { name: 'note', type: 'varchar', nullable: true },
      ],
      constraints: [{ primaryKey: true, columns: ['key'] }],
    }],
  });
  expect(printSchema(schema)).toMatch(/key: string;/);
  expect(printSchema(schema)).toMatch(/note\?: string;/);
});

test('exportSchemaJava uses the actual primary-key member', () => {
  const schema = new Schema({
    name: 'test',
    tables: [{
      name: 'widget',
      columns: [
        { name: 'code', type: 'varchar', nullable: false },
        { name: 'name', type: 'varchar', nullable: false },
      ],
      constraints: [{ primaryKey: true, columns: ['code'] }],
    }],
  });
  const path = mkdtempSync(join(tmpdir(), 'sqlex-java-pk-'));
  try {
    exportSchemaJava(schema, { path });
    const java = readFileSync(join(path, 'Widget.java'), 'utf8');
    expect(java).toContain('Objects.equals(((Widget)o).code, code)');
    expect(java).toContain('Objects.hash(this.code)');
    expect(java).not.toContain('getId()');
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});

describe('printSchemaTypeMap', () => {
  test('generates table specs for typed Database usage', () => {
    const schema = new Schema(helper.getExampleData());
    const result = printSchemaTypeMap(schema, { importPath: '../src' });
    expect(result).toMatch(/import type \{ Database, FilterShape, Identifiable, JsonValue, ParentMutation, RelatedMutation, ScalarValue, TableSpec \}/);
    expect(result).toMatch(/export interface UserRow extends Identifiable \{/);
    expect(result).toMatch(/user: TableSpec<UserRow, UserCreate, UserUpdate, UserFilter>;/);
    expect(result).toMatch(/Order: TableSpec<OrderRow, OrderCreate, OrderUpdate, OrderFilter>;/);
    expect(result).toMatch(/export type SqlexDatabase = Database<SqlexTables>;/);
  });
});
