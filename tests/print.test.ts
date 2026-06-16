import { Schema } from '../src/schema';
import { printSchema, printSchemaTypeMap, getTypeName, DataType } from '../src/print';
import * as helper from './helper';
import { Database, Table, Column, Constraint } from '../src/types';

test('print', () => {
  const schema = new Schema(helper.getExampleData());
  const result = printSchema(schema);
  expect(/\bname:\s+string;/.test(result)).toBe(true);
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
