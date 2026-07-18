import * as helper from './helper';
import { Database } from '../src/database';

const NAME = 'composite_key';

beforeAll(() => helper.createDatabase(NAME));
afterAll(() => helper.dropDatabase(NAME));

// A composite (or otherwise serial-less) primary key has no scalar insert id to
// fetch a freshly inserted row by. Exercise the full create/insert/get path on
// such a table. SQLite-only ad-hoc schema; the code path is dialect-agnostic.
const maybe = helper.DB_TYPE === 'sqlite3' ? test : test.skip;

maybe('create/insert/get on a composite primary key table', async () => {
  const conn = helper.createTestConnection(NAME);
  await conn.query('drop table if exists membership');
  await conn.query(
    'create table membership (' +
      'user_id integer not null, ' +
      'group_id integer not null, ' +
      'role varchar(20), ' +
      'primary key (user_id, group_id))'
  );
  conn.end();

  const pool = helper.createTestConnectionPool(NAME);
  const db = new Database(pool);
  await db.buildSchema();

  const membership = db.table('membership');

  // create() locates and returns the inserted row by its full composite key.
  const created = await membership.create({ userId: 1, groupId: 2, role: 'admin' });
  expect(created.userId).toBe(1);
  expect(created.groupId).toBe(2);
  expect(created.role).toBe('admin');

  // insert() hands back the composite key filter (there is no scalar id).
  const key = await membership.insert({ userId: 3, groupId: 4, role: 'member' });
  expect(key).toEqual({ userId: 3, groupId: 4 });

  // Both rows are retrievable by their composite key.
  const one = await membership.get({ userId: 1, groupId: 2 });
  expect(one.role).toBe('admin');
  const all = await membership.select('*', { orderBy: ['userId'] });
  expect(all.length).toBe(2);

  await db.end();
});
