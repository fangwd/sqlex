import helper = require('./helper');
import { createConnectionPool } from '../src/engine';

const NAME = 'postgres';

test('connectionLimit maps to pg pool max', async () => {
  const pool = createConnectionPool('postgres', {
    database: 'postgres',
    connectionLimit: 3,
  });
  expect((pool as any).pool.options.max).toBe(3);
  await pool.end();
});

test('postgres max overrides connectionLimit', async () => {
  const pool = createConnectionPool('postgres', {
    database: 'postgres',
    connectionLimit: 3,
    max: 5,
  });
  expect((pool as any).pool.options.max).toBe(5);
  await pool.end();
});

test('createDatabase', async () => {
  if (helper.DB_TYPE !== 'postgres') {
    return;
  }
  const db = await helper.createPostgresDatabase(NAME, true, true);
  const result = await db.query('select * from product');
  expect(result.rows.length).toBeGreaterThan(0);
  // database "test" is being accessed by other users
  await db.end();
  await helper.dropPostgresDatabase(NAME);
});
