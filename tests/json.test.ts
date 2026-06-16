import { _toCamel, Table } from '../src/database';
import { SimpleField } from '../src/schema';

function mockField(type: string): SimpleField {
  return { column: { type } } as any as SimpleField;
}

// Exercise Table.escapeValue without a live connection by faking the bits it touches.
function escapeJson(type: string, value: any): string {
  const mockTable = {
    db: { pool: { escape: (s: string) => `'${s}'` } },
  } as any;
  return Table.prototype.escapeValue.call(mockTable, mockField(type), value);
}

describe('_toCamel json columns', () => {
  test('parses JSON string for json type', () => {
    const value = _toCamel('{"a":1,"b":"hello"}', mockField('json'));
    expect(value).toEqual({ a: 1, b: 'hello' });
  });

  test('parses JSON string for jsonb type', () => {
    const value = _toCamel('{"x":true}', mockField('jsonb'));
    expect(value).toEqual({ x: true });
  });

  test('passes through already-parsed object for json type', () => {
    const obj = { foo: 'bar', num: 42 };
    const value = _toCamel(obj, mockField('json'));
    expect(value).toBe(obj);
  });

  test('passes through already-parsed object for jsonb type', () => {
    const obj = [1, 2, 3];
    const value = _toCamel(obj, mockField('jsonb'));
    expect(value).toBe(obj);
  });

  test('returns null for null value', () => {
    expect(_toCamel(null, mockField('json'))).toBeNull();
    expect(_toCamel(null, mockField('jsonb'))).toBeNull();
  });

  test('preserves non-json types unchanged', () => {
    expect(_toCamel('hello', mockField('varchar'))).toBe('hello');
    expect(_toCamel(42, mockField('int'))).toBe(42);
  });
});

describe('escapeValue json columns', () => {
  test('encodes object as a JSON literal', () => {
    expect(escapeJson('json', { a: 1, b: 'x' })).toBe(`'${JSON.stringify({ a: 1, b: 'x' })}'`);
  });

  test('encodes array as a JSON literal', () => {
    expect(escapeJson('jsonb', [1, 2, 3])).toBe(`'[1,2,3]'`);
  });

  // Regression: booleans/numbers in a json column must be JSON-encoded, not emitted
  // as bare SQL tokens (which postgres json/jsonb rejects).
  test('encodes boolean as a JSON literal, not a SQL keyword', () => {
    expect(escapeJson('jsonb', true)).toBe(`'true'`);
    expect(escapeJson('json', false)).toBe(`'false'`);
  });

  test('encodes number as a JSON literal', () => {
    expect(escapeJson('json', 42)).toBe(`'42'`);
  });

  test('keeps null as SQL NULL', () => {
    expect(escapeJson('json', null)).toBe('null');
  });
});
