import { SimpleField } from '../src/schema';
import * as helper from './helper';

const NAME = 'helper';

beforeAll(() => helper.createDatabase(NAME));
afterAll(() => helper.dropDatabase(NAME));

describe('table.existing', () => {
  it('should report duplicates for simple fields', async () => {
    const db = helper.connectToDatabase(NAME);
    const user = await db.table('user').create({ email: 'helper@example.com' });
    const existing = await db.table('user').existing({ email: 'helper@example.com' });
    expect(existing.length).toBe(1);
    expect(existing[0].row.id).toBe(user.id);
    expect(existing[0].constraint.columns[0]).toBe('email');
    await db.end();
  });

  it('should ignore null values', async () => {
    const db = helper.connectToDatabase(NAME);
    await db.table('category').create({ name: 'foo' });
    const existing = await db.table('category').existing({ name: 'foo', parent: null });
    expect(existing.length).toBe(0);
    await db.end();
  });

  it('should report duplicates including foreign keys', async () => {
    const db = helper.connectToDatabase(NAME);
    const row = await db.table('category').create({ name: 'foo' });
    const row2 = db.table('category').append({ name: 'bar', parent: { id: row.id } });
    await db.flush();
    db.clear();
    const existing = await db.table('category').existing({ name: 'bar', parent: { id: row.id } });
    expect(existing.length).toBe(1);
    expect(existing[0].row.id).toBe(row2.id);
    expect(existing[0].constraint.columns[0]).toBe('parent_id');
    expect(existing[0].constraint.columns[1]).toBe('name');
    await db.end();
  });
});

test('db.escapeValue', async () => {
  const db = helper.connectToDatabase(NAME);

  if (process.env.DB_TYPE === 'postgres') {
    // pg's built-in encoder uses local timezone to encode datetimes
    return;
  }

  const f1 = new SimpleField(null as any, { name: '', type: 'date' }, {});
  const s1 = db.table('user').escapeValue(f1, '2020-07-06T19:30:00Z');
  expect(s1).toBe("'2020-07-06'");

  const f2 = new SimpleField(null as any, { name: '', type: 'time' }, {});
  const s2 = db.table('user').escapeValue(f2, '2020-07-06T19:30:00Z');
  expect(s2.replace(/Z/, '')).toBe("'19:30:00.000'");

  const f3 = new SimpleField(null as any, { name: '', type: 'datetime' }, {});
  const s3 = db.table('user').escapeValue(f3, '2020-07-06T19:30:00Z');
  expect(s3.replace(/Z/, '').replace(/T/, ' ')).toBe("'2020-07-06 19:30:00.000'");

  await db.end();
});

it('should support params with db.query', async () => {
  const db = helper.connectToDatabase(NAME);
  const rows = await db.query('select * from user where email=:email', {
    email: 'alice@example.com',
  });
  expect(rows.length).toBe(1);
  expect(rows[0].first_name).toBe('Alice');
  const rows2 = await db.query('select * from user where email in (:email)', {
    email: ['alice@example.com', 'bob@example.com'],
  });
  expect(rows2.length).toBe(2);
  await db.end();
});

it('should support params with connection.query', async () => {
  const db = helper.connectToDatabase(NAME);
  const conn = await db.pool.getConnection();
  const rows = await conn.query('select * from user where email=:email', {
    email: 'alice@example.com',
  });
  expect(rows.length).toBe(1);
  expect(rows[0].first_name).toBe('Alice');
  const rows2 = await conn.query(`select * from user where email in (?) order by email`, [
    'alice@example.com',
    'bob@example.com',
  ]);
  expect(rows2.length).toBe(2);
  expect(rows2[1].first_name).toBe('Bob');
  conn.release();
  await db.end();
});
