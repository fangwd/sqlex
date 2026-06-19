import { getInformationSchema } from '../src/engine';
import * as helper from './helper';

const NAME = 'introspect';

beforeAll(() => helper.createDatabase(NAME));
afterAll(() => helper.dropDatabase(NAME));

// SQLite-specific: it has no information_schema, so introspection is rebuilt
// from PRAGMA. Skip on other dialects (covered elsewhere).
const maybe = helper.DB_TYPE === 'sqlite3' ? test : test.skip;

maybe('introspect sqlite schema from PRAGMA', async () => {
  const conn = helper.createTestConnection(NAME);
  const info = await getInformationSchema(conn, helper.getDatabaseName(NAME));
  conn.end();

  const byName: { [name: string]: any } = {};
  for (const t of info.tables) byName[t.name] = t;

  expect(byName.user).toBeDefined();
  expect(byName.order).toBeDefined();
  expect(byName.user_group).toBeDefined();

  // user.id is an auto-incrementing primary key
  const user = byName.user;
  const id = user.columns.find((c: any) => c.name === 'id');
  expect(id.type).toBe('integer');
  expect(id.autoIncrement).toBe(true);
  const pk = user.constraints.find((c: any) => c.primaryKey);
  expect(pk.columns).toEqual(['id']);

  // varchar size is recovered
  const email = user.columns.find((c: any) => c.name === 'email');
  expect(email.type).toBe('varchar');
  expect(email.size).toBe(200);

  // user.email is unique
  const emailUnique = user.constraints.find(
    (c: any) => c.unique && c.columns.length === 1 && c.columns[0] === 'email'
  );
  expect(emailUnique).toBeDefined();

  // order has a foreign key referencing user(id)
  const order = byName.order;
  const fk = order.constraints.find(
    (c: any) => c.references && c.references.table === 'user'
  );
  expect(fk).toBeDefined();
  expect(fk.references.columns).toEqual(['id']);

  // user_group has a composite unique on (user_id, group_id)
  const ug = byName.user_group;
  const composite = ug.constraints.find(
    (c: any) => c.unique && c.columns.length === 2
  );
  expect([...composite.columns].sort()).toEqual(['group_id', 'user_id']);
});
