import { Database, createConnectionPool } from '../src';

const POSTGRES_URL = 'postgresql://postgres:postgres@127.0.0.1:5433/mydb';

test('postgres pool accepts a database URL', async () => {
  const pool = createConnectionPool('postgres', POSTGRES_URL);

  try {
    const options = (pool as any).pool.options;
    expect(pool.dialect).toBe('postgres');
    expect(pool.database).toBe('mydb');
    expect(options.connectionString).toBe(POSTGRES_URL);
    expect(options.host).toBe('127.0.0.1');
    expect(options.port).toBe(5433);
    expect(options.user).toBe('postgres');
    expect(options.password).toBe('postgres');
    expect(options.database).toBe('mydb');
  } finally {
    await pool.end();
  }
});

test('postgres URL connectionLimit maps to pg pool max', async () => {
  const pool = createConnectionPool('postgres', `${POSTGRES_URL}?connectionLimit=3`);

  try {
    expect((pool as any).pool.options.max).toBe(3);
  } finally {
    await pool.end();
  }
});

test('Database infers postgres dialect and database name from a URL', async () => {
  const db = new Database({ connection: POSTGRES_URL });

  try {
    expect(db.name).toBe('mydb');
    expect(db.pool.dialect).toBe('postgres');
    expect((db.pool as any).pool.options.database).toBe('mydb');
  } finally {
    await db.end();
  }
});
