import { Schema } from '../src/schema';
import { encodeFilter, QueryBuilder, splitKey, plainify } from '../src/filter';

import helper = require('./helper');

const NAME = 'filter';

beforeAll(() => helper.createDatabase(NAME));
afterAll(() => helper.dropDatabase(NAME));

const data = helper.getExampleData();
const domain = new Schema(data);

test('split name and operator', () => {
  let [name, op] = splitKey('orders_some');
  expect(name).toBe('orders');
  expect(op).toBe('some');
  [name, op] = splitKey('orders');
  expect(name).toBe('orders');
  expect(op).toBe(undefined);
});

/*
-- To get user -> order -> item -> products:
select u.email, o.date_created, p.name, p.stock_quantity
from product p
  join order_item oi on p.id=oi.product_id
  join `order` o on o.id=oi.order_id
  join user u on u.id=o.user_id;
*/
test('example query', done => {
  expect.assertions(2);

  const db = helper.connectToDatabase(NAME);
  const args = {
    email: 'grace@example.com',
    orders_some: {
      dateCreated: '2018-03-21T00:00:00.000Z',
      orderItems_none: {
        product: {
          name_like: '%Lamb%',
          stockQuantity: [null, 0]
        }
      }
    }
  };

  db.table('user')
    .select('*', { where: args })
    .then(rows => {
      expect(rows.length).toBe(1);
      expect(rows[0].email).toBe(args.email);
      db.end();
      done();
    });
});

test('foreign key column filter', () => {
  const model = domain.model('OrderItem');

  const args = {
    order: {
      user: {
        id_gt: 2
      },
      dateCreated: '2018-3-21'
    },
    product: {
      id: [1, 2, 3]
    }
  };
  const condition = encodeFilter(args, model, DefaultEscape);
  expect(condition.indexOf('`product_id` in (1, 2, 3)')).not.toBe(-1);
  expect(condition.indexOf('`user_id` > 2')).not.toBe(-1);
});

/*
-- To retrieve a 3-level category tree:
SELECT t1.name AS L1, t2.name as L2, t3.name as L3
FROM category AS t1
LEFT JOIN category AS t2 ON t2.parent_id = t1.id
LEFT JOIN category AS t3 ON t3.parent_id = t2.id
WHERE t1.name = 'All';

-- To get product categories:
select c.name, p.name
from product_category pc
  join product p on pc.product_id=p.id
  join category c on c.id=pc.category_id
order by c.name;
*/
test('many to many', done => {
  expect.assertions(2);

  const options = {
    models: [
      {
        table: 'product_category',
        fields: [
          {
            column: 'category_id',
            throughField: 'product_id'
          },
          {
            column: 'product_id',
            throughField: 'category_id',
            relatedName: 'categorySet'
          }
        ]
      }
    ]
  };

  const domain = new Schema(data, options);

  const args = {
    categories: {
      name_like: 'Apple%',
      products: {
        name_like: '%Apple%'
      }
    }
  };

  const db = helper.connectToDatabase(NAME, domain);
  db.table('category')
    .select('*', { where: args })
    .then(rows => {
      expect(rows.length).toBe(1);
      expect(rows[0].name).toBe('Fruit');
      db.end();
      done();
    });
});

test('and', done => {
  expect.assertions(2);

  const db = helper.connectToDatabase(NAME);
  const args = { and: [{ name_like: '%Apple%' }, { price_lt: 6 }] };

  db.table('product')
    .select('*', { where: args })
    .then(rows => {
      expect(rows.length).toBe(1);
      expect(rows[0].name).toBe('Australian Apple');
      db.end();
      done();
    });
});

test('or', done => {
  expect.assertions(1);

  const db = helper.connectToDatabase(NAME);
  const args = {
    or: [
      { name_like: '%Apple%' },
      {
        categories_some: { name: 'Banana' }
      }
    ]
  };
  db.table('product')
    .select('*', { where: args })
    .then(rows => {
      expect(rows.length).toBe(4);
      db.end();
      done();
    });
});

test('not', done => {
  expect.assertions(1);

  const db = helper.connectToDatabase(NAME);
  const args = {
    and: [
      { name_like: '%Australian%' },
      {
        not: [
          { name_like: '%Apple%' },
          {
            categories_some: { name: 'Banana' }
          }
        ]
      }
    ]
  };

  db.table('product')
    .select('*', { where: args })
    .then(rows => {
      expect(rows.length).toBe(2);
      db.end();
      done();
    });
});

test('order by', () => {
  const model = domain.model('OrderItem');
  const args = {
    where: { quantity_gt: 1 },
    orderBy: ['-order.code', 'order.user.email', 'quantity']
  };
  const builder = new QueryBuilder(model, DefaultEscape);
  const sql = builder.select('*', args);
  expect(/`t\d\`.`email`\s+ASC/i.test(sql)).toBe(true);
  expect(/`t\d\`.`code`\s+DESC/i.test(sql)).toBe(true);
});

test('throughField', async () => {
  const db = helper.connectToDatabase(NAME);
  const args = [
    { ancestor: { products: [{ id: 3 }] } },
    { descendant: { products: [{ id: 3 }] } }
  ];
  const rows = await db.table('category_tree').select('*', { where: args });
  expect(rows.length).toBeGreaterThan(0);
  db.end();
});

const DefaultEscape = {
  dialect: '',
  escapeId: s => '`' + s + '`',
  escape: s => "'" + (s + '').replace(/'/g, "\\'") + "'",
  escapeDate: d => "'" + d.toISOString() + "'",
};

test('empty result', async () => {
  const db = helper.connectToDatabase(NAME);
  const connection = await db.pool.getConnection();
  const rows = await db.table('user_group').select(
    '*',
    {
      where: { group: [] }
    },
    undefined,
    connection
  );
  expect(rows.length).toBe(0);
  connection.release();
  db.end();
});

test('plainify', () => {
  const value = [undefined, 1, 2];
  const result = plainify(value);
  expect(result).toEqual([1, 2]);
});


test('group by', async () => {
  const db = helper.connectToDatabase(NAME);
  const connection = await db.pool.getConnection();
  const rows = await db.table('order_item').select(
    ['order.user.email', 'count(*) as itemCount', 'sum(quantity) as totalQuantity'],
    {
      groupBy: ['order.id', 'order.user.email'],
    },
    undefined,
    connection
  );
  expect(rows.length).toBe(2);
  expect((rows[0] as any).itemCount > 0);
  expect((rows[1] as any).totalQuantity > 0);
  connection.release();
  db.end();
});

describe('notIn', () => {
  test('should filter using non-key fields', async () => {
    const db = helper.connectToDatabase(NAME);
    const args = {
      name_notIn: ['ADMIN', 'STAFF'],
    };
    const rows = await db.table('group').select('*', { where: args });
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('CUSTOMER');
    db.end();
  });
  test('should filter using primary key', async () => {
    const db = helper.connectToDatabase(NAME);
    const args = {
      id_notIn: [1, 2],
    };
    const rows = await db.table('group').select('*', { where: args });
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('CUSTOMER');
    db.end();
  });
});

describe('not null', () => {
  test('should work for non-foreign key fields', async () => {
    const db = helper.connectToDatabase(NAME);
    const args = {
      content_ne: null
    };
    const rows = await db.table('comment').select('*', { where: args, orderBy: ['id'] });
    expect(rows.length).toBe(2);
    expect(rows[0].content).toBe('comment 1');
    db.end();
  });

  test('should work for foreign keys', async () => {
    const db = helper.connectToDatabase(NAME);
    const args = {
      parent_ne: null,
    };
    const rows = await db.table('comment').select('*', { where: args, orderBy: ['id'] });
    expect(rows.length).toBe(2);
    expect(rows[0].content).toBe('comment 2');
    db.end();
  });
});

describe('having', () => {
  test('filter only on aggregate values', async () => {
    const db = helper.connectToDatabase(NAME);
    const rows = await db.table('order_item').select(['order.id', 'count(*) as itemCount'], {
      groupBy: ['order.id'],
      having: { itemCount_gt: 2 },
    });
    expect(+rows[0].itemCount).toBeGreaterThan(2);
    db.end();
  });
  test('filter on aggregate values and grouped by values', async () => {
    const db = helper.connectToDatabase(NAME);
    const rows = await db.table('order_item').select(['product.name', 'count(*) as itemCount'], {
      groupBy: ['product.name'],
      having: { itemCount_lt: 2, name_like: 'Australia%' },
    });
    expect(rows.length).toBe(1);
    expect(rows[0].name).toContain('Banana');
    const rows2 = await db.select({
      fields: ['product.name', 'count(*) as itemCount'],
      from: {
        table: 'order_item',
      },
      groupBy: ['product.name'],
      having: { itemCount_lt: 2, name_like: 'Australia%' },
    });
    expect(rows2.length).toBe(1);
    expect(rows2[0].name).toContain('Banana');
    db.end();
  });
});