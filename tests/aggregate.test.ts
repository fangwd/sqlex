import helper = require('./helper');

const NAME = 'aggregate';

beforeAll(() => helper.createDatabase(NAME));
afterAll(() => helper.dropDatabase(NAME));

describe('select with aggregate functions', () => {
  test('from one table', async () => {
    const db = helper.connectToDatabase(NAME);
    const rows = await db.select({
      fields: ['order.user.email', 'count(*) as count'],
      from: 'order_item',
      groupBy: ['order.user.email'],
    });
    expect(rows.length).toBeGreaterThan(0);
    // note: postgres returns count as a string
    expect(+rows[0].count).toBeGreaterThan(0);
    db.end();
  });

  test('from joined tables', async () => {
    const db = helper.connectToDatabase(NAME);
    const rows = await db.select({
      fields: ['user.firstName', 'product.name', 'count(*) as count'],
      from: {
        table: 'service_log',
        joins: [
          {
            table: 'product',
            on: 'product.sku = service_log.product_code',
          },
          {
            table: 'user',
            on: 'user.email = service_log.customer_email',
          },
        ],
      },
      groupBy: ['user.firstName', 'product.name'],
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(+rows[0].count).toBeGreaterThan(0);
    db.end();
  });
});
