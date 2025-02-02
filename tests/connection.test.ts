import { getInformationSchema } from '../src/engine';
import { Schema } from '../src/schema';
import * as helper from './helper';

const NAME = 'engine';

beforeAll(() => helper.createDatabase(NAME));
afterAll(() => helper.dropDatabase(NAME));

test('select/update', done => {
  expect.assertions(1);

  const conn = helper.createTestConnection(NAME);
  conn.query('update product set status=200 where id=1').then(rows => {
    conn.query('select * from product where id=1').then(rows => {
      expect(rows[0].status).toBe(200);
      conn.end();
      done();
    });
  });
});

test('transaction commit', done => {
  expect.assertions(3);

  const ID = 100;

  const conn = helper.createTestConnection(NAME);
  conn
    .transaction(conn => {
      return conn
        .query(`insert into category (id, name) values (${ID}, 'Grocery')`)
        .then(id => {
          return conn
            .query(`select * from category where id=${ID}`)
            .then(rows => {
              expect(rows[0].name).toBe('Grocery');
              return conn.query(
                `insert into category(id, name) values (${ID + 1}, 'Dairy')`
              );
            });
        });
    })
    .then(() => {
      conn
        .query(
          `select * from category where id in (${ID}, ${ID + 1}) order by id`
        )
        .then(rows => {
          expect(rows.length).toBe(2);
          expect(rows[1].name).toBe('Dairy');
          conn.end();
          done();
        });
    });
});

test('transaction rollback - bad column', done => {
  expect.assertions(3);

  const ID = 200;

  const conn = helper.createTestConnection(NAME);
  conn
    .transaction(conn => {
      return conn
        .query(`insert into category (id, name) values (${ID}, 'Grocery')`)
        .then(id => {
          return conn
            .query(`select * from category where id=${ID}`)
            .then(rows => {
              expect(rows[0].name).toBe('Grocery');
              return conn.query(
                `insert into category(id, name, x) values (${ID + 1}, 'Dairy')`
              );
            });
        });
    })
    .catch(reason => {
      expect(!!reason).toBe(true);
      conn
        .query(
          `select * from category where id in (${ID}, ${ID + 1}) order by id`
        )
        .then(rows => {
          expect(rows.length).toBe(0);
          conn.end();
          done();
        });
    });
});

test('transaction rollback - bad value', done => {
  expect.assertions(3);

  const ID = 300;

  const conn = helper.createTestConnection(NAME);
  conn
    .transaction(conn => {
      return conn
        .query(`insert into category (id, name) values (${ID}, 'Grocery')`)
        .then(id => {
          return conn
            .query(`select * from category where id=${ID}`)
            .then(rows => {
              expect(rows[0].name).toBe('Grocery');
              return conn.query(
                `insert into category(d, name, parent_id) values (${ID +
                1}, 'Dairy', -1)`
              );
            });
        });
    })
    .catch(reason => {
      expect(!!reason).toBe(true);
      conn
        .query(
          `select * from category where id in (${ID}, ${ID + 1}) order by id`
        )
        .then(rows => {
          expect(rows.length).toBe(0);
          conn.end();
          done();
        });
    });
});

test('transaction rollback - error', done => {
  expect.assertions(3);

  const ID = 400;

  const conn = helper.createTestConnection(NAME);
  conn
    .transaction(conn => {
      return conn
        .query(`insert into category (id, name) values (${ID}, 'Grocery')`)
        .then(id => {
          return conn
            .query(`select * from category where id=${ID}`)
            .then(rows => {
              expect(rows[0].name).toBe('Grocery');
              throw Error('Aborted');
            });
        });
    })
    .catch(reason => {
      expect(!!reason).toBe(true);
      conn
        .query(
          `select * from category where id in (${ID}, ${ID + 1}) order by id`
        )
        .then(rows => {
          expect(rows.length).toBe(0);
          conn.end();
          done();
        });
    });
});

test('transaction commit (by user)', done => {
  expect.assertions(3);

  const ID = 500;
  const conn = helper.createTestConnection(NAME);
  conn.transaction(conn => {
    conn
      .query(`insert into category (id, name) values (${ID}, 'Grocery')`)
      .then(id => {
        return conn
          .query(`select * from category where id=${ID}`)
          .then(rows => {
            expect(rows[0].name).toBe('Grocery');
            return conn
              .query(
                `insert into category(id, name) values (${ID + 1}, 'Dairy')`
              )
              .then(() =>
                conn.commit().then(() =>
                  conn
                    .query(
                      `select * from category where id in (${ID}, ${ID +
                      1}) order by id`
                    )
                    .then(rows => {
                      expect(rows.length).toBe(2);
                      expect(rows[1].name).toBe('Dairy');
                      conn.end();
                      done();
                    })
                )
              );
          });
      });
  });
});

test('transaction rollback (by user)', done => {
  expect.assertions(2);

  const ID = 600;
  const conn = helper.createTestConnection(NAME);
  conn.transaction(conn => {
    conn
      .query(`insert into category (id, name) values (${ID}, 'Grocery')`)
      .then(id =>
        conn.query(`select * from category where id=${ID}`).then(rows => {
          expect(rows[0].name).toBe('Grocery');
          conn
            .query(`insert into category(id, name) values (${ID + 1}, 'Dairy')`)
            .then(() => {
              conn.rollback().then(() =>
                conn
                  .query(
                    `select * from category where id in (${ID}, ${ID +
                    1}) order by id`
                  )
                  .then(rows => {
                    expect(rows.length).toBe(0);
                    conn.end();
                    done();
                  })
              );
            });
        })
      );
  });
});

test('pool', done => {
  const pool = helper.createTestConnectionPool(NAME);
  pool.getConnection().then(connection => {
    connection.query('SELECT 1 + 1 AS solution').then(result => {
      expect(result[0].solution).toBe(2);
      connection.release();
      if (process.env.DB_TYPE === 'sqlite3') {
        done();
      } else {
        pool.getConnection().then(connection2 => {
          expect(connection2.connection).toBe(connection.connection);
          connection.release();
          pool.end();
          done();
        });
      }
    });
  });
});

test('getInformationSchema', async() => {
  const connection = helper.createTestConnection(NAME);
  if (!helper.isSqlite3(connection.dialect)) {
    const schemaInfo = await getInformationSchema(
      connection,
      helper.getDatabaseName(NAME)
    );
    const schema = new Schema(schemaInfo);
    const model = schema.model('order_shipping');
    expect(model.primaryKey.fields[0].name).toBe('order');
    expect(model.getForeignKeyCount(schema.model('order'))).toBe(1);
    const product = schemaInfo.tables.find(table => table.name === 'product')
    const name = product.columns.find(column => column.name === 'name');
    expect(name.type).toBe('varchar');
    expect(name.size).toBe(200);
  }
  await connection.end();
});
