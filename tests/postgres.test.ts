import helper = require('./helper');

const NAME = 'postgres';

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
