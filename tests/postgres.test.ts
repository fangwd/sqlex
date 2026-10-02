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

test('raw query() returns rows for INSERT ... RETURNING', async () => {
  if (helper.DB_TYPE !== 'postgres') {
    return;
  }
  await helper.createDatabase(NAME);
  const db = helper.connectToDatabase(NAME);
  try {
    // A raw INSERT with RETURNING resolves to the rows (not undefined).
    const rows = await db.query<{ id: number; name: string }[]>(
      'insert into category (name) values (?) returning id, name',
      'returning-cat',
    );
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('returning-cat');
    expect(typeof rows[0].id).toBe('number');

    // table.insert() still returns the new id scalar (pk path unchanged).
    const id = await db.table('category').insert({ name: 'insert-cat' });
    expect(typeof id).toBe('number');

    // An INSERT with no RETURNING yields an empty array.
    const none = await db.query('insert into category (name) values (?)', 'no-returning-cat');
    expect(none).toEqual([]);
  } finally {
    await db.end();
    await helper.dropDatabase(NAME);
  }
});

test('overlapping queries on one connection run one at a time', async () => {
  if (helper.DB_TYPE !== 'postgres') {
    return;
  }
  await helper.createDatabase(NAME);
  const db = helper.connectToDatabase(NAME);
  try {
    const connection = await db.pool.getConnection();
    // pg deprecates calling client.query() while another query is running
    const client = (connection as any).connection;
    const query = client.query.bind(client);
    let running = 0;
    let maxRunning = 0;
    client.query = (sql: string) => {
      maxRunning = Math.max(maxRunning, ++running);
      return query(sql).finally(() => running--);
    };
    try {
      const results = await Promise.all(
        [1, 2, 3].map(n => connection.query(`select ${n} as n`))
      );
      expect(results.map(rows => rows[0].n)).toEqual([1, 2, 3]);
      // a failed query does not block the ones queued after it
      const [failed, next] = await Promise.allSettled([
        connection.query('select * from missing_table'),
        connection.query('select 4 as n'),
      ]);
      expect(failed.status).toBe('rejected');
      expect(next).toEqual({ status: 'fulfilled', value: [{ n: 4 }] });
      expect(maxRunning).toBe(1);
    } finally {
      connection.release();
    }
  } finally {
    await db.end();
    await helper.dropDatabase(NAME);
  }
});
