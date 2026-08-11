import { Database, MigrationRunner, defineRecord, field, makeMigration } from '../src';
import { SimpleField } from '../src/schema';
import { columnSchema } from '../src/api/jsonschema';
import { classifyColumn } from '../src/api/column';
import { createApi } from '../src/api';
import { Document } from '../src/types';
import * as helper from './helper';

const NAME = 'api_types';

class Money extends defineRecord({
  table: 'money',
  fields: {
    id: field.id(),
    amount: field.decimal({ precision: 12, scale: 2 }),
    counter: field.bigint(),
    ratio: field.float(),
    active: field.boolean(),
    createdAt: field.datetime({ column: 'created_at' }),
    dueDate: field.date({ column: 'due_date' }),
    alarm: field.time(),
    label: field.string({ maxLength: 40 }),
  },
}) {}

type Observed = { kind: string; js: string };

/**
 * What each driver actually reports and returns, per engine. These are the
 * facts the generated schemas have to match; where the engines disagree, the
 * request layer is what has to converge them (see columnSchema).
 */
const EXPECTED: { [engine: string]: { [column: string]: Observed } } = {
  sqlite3: {
    amount: { kind: 'number', js: 'number' },
    counter: { kind: 'integer', js: 'number' },
    ratio: { kind: 'number', js: 'number' },
    active: { kind: 'integer', js: 'number' },
    createdAt: { kind: 'datetime', js: 'Date' },
    dueDate: { kind: 'date', js: 'Date' },
    alarm: { kind: 'time', js: 'string' },
    label: { kind: 'string', js: 'string' },
  },
  mysql: {
    amount: { kind: 'number', js: 'string' },
    counter: { kind: 'integer', js: 'number' },
    ratio: { kind: 'number', js: 'number' },
    active: { kind: 'integer', js: 'number' },
    createdAt: { kind: 'datetime', js: 'Date' },
    dueDate: { kind: 'date', js: 'Date' },
    alarm: { kind: 'time', js: 'string' },
    label: { kind: 'string', js: 'string' },
  },
  postgres: {
    amount: { kind: 'number', js: 'string' },
    counter: { kind: 'integer', js: 'number' },
    ratio: { kind: 'number', js: 'number' },
    active: { kind: 'boolean', js: 'boolean' },
    createdAt: { kind: 'datetime', js: 'Date' },
    dueDate: { kind: 'date', js: 'Date' },
    alarm: { kind: 'time', js: 'string' },
    label: { kind: 'string', js: 'string' },
  },
};

const describeEngine = EXPECTED[helper.DB_TYPE] ? describe : describe.skip;

describeEngine(`column wire formats (${helper.DB_TYPE})`, () => {
  let db: Database;
  let row: Record<string, unknown>;

  beforeAll(async () => {
    await helper.createDatabase(NAME, false);
    // No schema up front: the table is created by the migration and then
    // introspected, so the test sees what an existing database reports.
    db = new Database(helper.createTestConnectionPool(NAME));
    const { migration } = makeMigration('0001_money', { Money });
    await new MigrationRunner(db).up([migration]);
    await db.buildSchema();

    const table = db.table('money');
    await table.create({
      // A trailing zero, so the rendered scale is observable.
      amount: 1234.5,
      counter: 9007199254740993,
      ratio: 0.5,
      active: true,
      createdAt: new Date('2026-01-02T03:04:05Z'),
      dueDate: new Date('2026-03-04T00:00:00Z'),
      alarm: new Date('1970-01-01T07:30:00Z'),
      label: 'first',
    });
    [row] = await table.select<Record<string, unknown>>('*');
  });

  afterAll(async () => {
    if (db) await db.end();
    await helper.dropDatabase(NAME);
  });

  function columnField(name: string): SimpleField {
    return db.schema.model('Money')?.field(name) as SimpleField;
  }

  test('every column is classified and returned as expected', () => {
    const expected = EXPECTED[helper.DB_TYPE];
    const observed: { [column: string]: Observed } = {};
    for (const name of Object.keys(expected)) {
      const value = row[name];
      observed[name] = {
        kind: classifyColumn(columnField(name)),
        js: value instanceof Date ? 'Date' : typeof value,
      };
    }
    expect(observed).toEqual(expected);
  });

  test('exact decimals are typed as strings on every engine', () => {
    // mysql and postgres already return a string; sqlite returns a number, so
    // the serialiser has to convert it to honour this contract.
    expect(columnSchema(columnField('amount'))).toEqual({
      type: 'string',
      format: 'decimal',
      description: 'Exact decimal with precision 12 and scale 2, serialised as a string to preserve precision.',
    });
    if (helper.DB_TYPE === 'sqlite3') {
      expect(typeof row.amount).toBe('number');
    } else {
      expect(row.amount).toBe('1234.50');
    }
  });

  test('a served decimal reads the same on every engine', async () => {
    const api = createApi(db, { resources: { Money: { read: { fields: ['amount'] } } } });
    const response = await api.handle(
      new Request(`http://test/${api.plan.resources[0].path}`),
      {}
    );
    expect(response.status).toBe(200);
    const [served] = ((await response.json()) as Document).data as Document[];
    // sqlite hands back the number 1234.5; the column's scale is what makes the
    // rendering identical to what mysql and postgres return.
    expect(served.amount).toBe('1234.50');
  });

  test('bigint is int64 and already inexact past 2^53', () => {
    expect(columnSchema(columnField('counter'))).toEqual({
      type: 'integer',
      format: 'int64',
      description:
        'Values beyond 2^53 are not exact: the driver returns this column as a JavaScript number.',
    });
    // The value was inserted as ...993; no driver can round-trip it.
    expect(row.counter).toBe(9007199254740992);
  });

  test('date columns need formatting, not JSON serialisation', () => {
    expect(columnSchema(columnField('dueDate'))).toEqual({ type: 'string', format: 'date' });
    const value = row.dueDate;
    expect(value).toBeInstanceOf(Date);
    // JSON would render the Date in UTC, which can move the calendar day: the
    // serialiser has to emit the date parts instead.
    expect(JSON.stringify(value)).toMatch(/^"\d{4}-\d{2}-\d{2}T/);
  });

  test('datetime columns serialise to date-time as they are', () => {
    expect(columnSchema(columnField('createdAt'))).toEqual({
      type: 'string',
      format: 'date-time',
    });
    expect(JSON.stringify(row.createdAt)).toBe('"2026-01-02T03:04:05.000Z"');
  });

  test('time columns claim no format because the engines disagree', () => {
    expect(columnSchema(columnField('alarm'))).toEqual({
      type: 'string',
      description: 'Clock time; the exact rendering depends on the database engine.',
    });
    expect(typeof row.alarm).toBe('string');
  });

  test('a boolean column is only a boolean where the engine has one', () => {
    const schema = columnSchema(columnField('active'));
    if (helper.DB_TYPE === 'postgres') {
      expect(schema).toEqual({ type: 'boolean' });
    } else {
      // sqlite reports 'integer' and mysql 'tinyint'; neither carries a boolean
      // marker, so the document describes what the database actually stores.
      expect(schema).toEqual({ type: 'integer' });
    }
  });

  test('string columns carry their length', () => {
    expect(columnSchema(columnField('label'))).toEqual({ type: 'string', maxLength: 40 });
  });
});
