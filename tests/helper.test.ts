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
  });

  it('should ignore null values', async () => {
    const db = helper.connectToDatabase(NAME);
    await db.table('category').create({ name: 'foo' });
    const existing = await db.table('category').existing({ name: 'foo', parent: null });
    expect(existing.length).toBe(0);
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
  });
});

test('db.escapeValue', () => {
  const db = helper.connectToDatabase(NAME);

  const f1 = new SimpleField(null as any, { name: '', type: 'date' }, {});
  const s1 = db.table('user').escapeValue(f1, '2020-07-06T19:30:00Z');
  expect(s1).toBe("'2020-07-06'");

  const f2 = new SimpleField(null as any, { name: '', type: 'time' }, {});
  const s2 = db.table('user').escapeValue(f2, '2020-07-06T19:30:00Z');
  expect(s2).toBe("'19:30:00.000Z'");

  const f3 = new SimpleField(null as any, { name: '', type: 'datetime' }, {});
  const s3 = db.table('user').escapeValue(f3, '2020-07-06T19:30:00Z');
  expect(s3).toBe("'2020-07-06T19:30:00.000Z'");
});
