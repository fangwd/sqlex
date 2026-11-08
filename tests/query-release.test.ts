import { Database } from '../src/database';
import { _ConnectionPool as Pool } from '../src/engine/sqlite3';

test('a statement that cannot be formatted holds no connection', async () => {
  const pool = new Pool({ database: ':memory:', connectionLimit: 1 });
  const db = new Database(pool);
  await expect(db.query('select ? and ?', 1)).rejects.toThrow();
  await expect(db.query('select : x', 1)).rejects.toThrow(/Missing name/);
  // the pool's one connection is free: this would wait forever if either had kept it
  expect(await db.query<{ one: number }[]>('select 1 as one')).toEqual([{ one: 1 }]);
  await pool.end();
});
