import { Model, Schema } from '../src/schema';
import { encodeFilter, QueryBuilder, plainify } from '../src/filter';

import * as helper from './helper';
import { DialectEncoder } from '../src/engine';

const NAME = 'filter';

beforeAll(() => helper.createDatabase(NAME));
afterAll(() => helper.dropDatabase(NAME));

const data = helper.getExampleData();
const domain = new Schema(data);

test('split name and operator', () => {
  const model = domain.model('OrderItem') as Model;
  const builder = new QueryBuilder(model, DefaultEscape);
  let [name, op] = builder.splitKey('orders_some');
  expect(name).toBe('orders');
  expect(op).toBe('some');
  [name, op] = builder.splitKey('orders');
  expect(name).toBe('orders');
  expect(op).toBe(undefined);
});

test('configurable operators map', () => {
  const model = domain.model('Group') as Model;
  const builder = new QueryBuilder(model, DefaultEscape, {like: 'rlike'});
  const sql = builder.select('*', { where: { name_like: 'adm%'}});
  expect(/\blike\b/i.test(sql)).toBe(false);
  expect(/\brlike\b/i.test(sql)).toBe(true);
});

/*
-- To get user -> order -> item -> products:
select u.email, o.date_created, p.name, p.stock_quantity
from product p
  join order_item oi on p.id=oi.product_id
  join `order` o on o.id=oi.order_id
  join user u on u.id=o.user_id;
*/
test('example query', async() => {
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

  const rows = await db.table('user').select('*', { where: args });
  expect(rows.length).toBe(1);
  expect(rows[0].email).toBe(args.email);
  await db.end();
});

test('ilike', async ()=> {
  const db = helper.connectToDatabase(NAME);
  const rows = await db.table('group').select('*', {where:  {name_ilike: 'adm%'}});
  expect(rows.length).toBe(1);
  await db.end();
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
test('many to many', async () => {
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
  const rows = await db.table('category').select('*', { where: args });

  expect(rows.length).toBe(1);
  expect(rows[0].name).toBe('Fruit');

  await db.end();
});

test('and', async() => {
  const db = helper.connectToDatabase(NAME);
  const args = { and: [{ name_like: '%Apple%' }, { price_lt: 6 }] };

  const rows = await db.table('product').select('*', { where: args });
  expect(rows.length).toBe(1);
  expect(rows[0].name).toBe('Australian Apple');
  await db.end();
});

test('or', async() => {
  const db = helper.connectToDatabase(NAME);
  const args = {
    or: [
      { name_like: '%Apple%' },
      {
        categories_some: { name: 'Banana' }
      }
    ]
  };
  const rows = await db.table('product').select('*', { where: args });
  expect(rows.length).toBe(4);
  await db.end();
});

test('not', async() => {
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

  const rows = await db.table('product').select('*', { where: args });
  expect(rows.length).toBe(2);
  await db.end();
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
  await db.end();
});

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
  await db.end();
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
  await db.end();
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
    await db.end();
  });
  test('should filter using primary key', async () => {
    const db = helper.connectToDatabase(NAME);
    const args = {
      id_notIn: [1, 2],
    };
    const rows = await db.table('group').select('*', { where: args });
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('CUSTOMER');
    await db.end();
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
    await db.end();
  });

  test('should work for foreign keys', async () => {
    const db = helper.connectToDatabase(NAME);
    const args = {
      parent_ne: null,
    };
    const rows = await db.table('comment').select('*', { where: args, orderBy: ['id'] });
    expect(rows.length).toBe(2);
    expect(rows[0].content).toBe('comment 2');
    await db.end();
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
    await db.end();
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
    await db.end();
  });
});

test('through field', async () => {
  const db = helper.connectToDatabase(NAME);
  const rows = await db.table('order_item').select('*', {
    where: { product: { categories_exists: { name_like: '%Apple' } } },
  });
  expect(rows.length).toBe(3);
  await db.end();
});

test('virtual foreign key', async () => {
  const schema = new Schema(helper.getExampleData(), {
    virtualForeignKeys: {
      'service_log.product_code': 'product.sku',
      'service_log.customer_email': 'user.email',
    },
    models: [],
  });
  const db = helper.connectToDatabase(NAME, schema);
  await db.table('service_log').insert({
    productCode: 'sku001',
    customerEmail: 'alice@example.com',
    serviceTime: new Date()
  });
  const rows = await db.table('service_log').select<any>(
    {
      customerEmail: '*',
      productCode: '*',
    },
    {
      where: { productCode: { name: 'Australian Banana' }, customerEmail: { firstName: 'Alice' } },
    }
  );
  expect(rows.length).toBe(1);
  expect(rows[0].productCode.status).toBe(1);
  expect(rows[0].customerEmail.email).toBe('alice@example.com');
  await db.end();
});

const DefaultEscape : DialectEncoder = {
  dialect: 'mysql',
  escapeId: s => '`' + s + '`',
  escape: s => "'" + (s + '').replace(/'/g, "\\'") + "'",
  escapeDate: d => "'" + d.toISOString() + "'",
};
