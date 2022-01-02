import { Database } from '../src/database';
import { setMockStringPrefix } from '../src/mock';
import { Schema, SimpleField } from '../src/schema';
import helper = require('./helper');

const NAME = 'mock';

beforeAll(() => helper.createDatabase(NAME));
afterAll(() => helper.dropDatabase(NAME));

describe('mock', () => {
  test('empty', async () => {
    const db = helper.connectToDatabase(NAME);
    updateFieldsNullability(db);
    const table = db.table('order');
    const order = await table.mock();
    expect(order.id).toBeGreaterThan(0);
    await db.cleanup();
    db.end();
  });

  test('simple', async () => {
    const db = helper.connectToDatabase(NAME);
    updateFieldsNullability(db);
    const table = db.table('order');
    const order = await table.mock({
      dateCreated: new Date('2020-01-01T00:00:00.000Z'),
    });
    expect(order.id).toBeGreaterThan(0);
    expect(typeof order.code).toBe('string');
    const orders = await db.table('order').select('*', { where: { id: order.id } });
    expect(orders.length).toBe(1);
    expect(new Date(orders[0].dateCreated as string).getFullYear()).toBe(2020);
    await db.cleanup();
    db.end();
  });

  test('many to one', async () => {
    const db = helper.connectToDatabase(NAME);
    updateFieldsNullability(db);
    const table = db.table('order');
    const order = await table.mock({
      orderItems: [
        {
          product: {
            price: 0,
          },
          quantity: 100,
        },
        {
          quantity: 200,
        },
      ],
    });

    expect(typeof order.code).toBe('string');

    const items = await db
      .table('order_item')
      .select('*', { where: { order }, orderBy: ['quantity'] });
    expect(items.length).toBe(2);
    expect(items[0].quantity).toBe(100);
    expect(items[1].quantity).toBe(200);

    const products = await db
      .table('product')
      .select('*', { where: { id: items.map((i) => (i.product as any).id) } });
    expect(products.length).toBe(2);
    expect(+products[0].price === 0 || +products[1].price === 0).toBe(true);
    expect(typeof products[0].sku).toBe('string');
    expect(typeof products[1].sku).toBe('string');
    await db.cleanup();
    db.end();
  });

  test('many to many', async () => {
    const options = {
      models: [
        {
          table: 'product_category',
          fields: [
            {
              column: 'category_id',
              throughField: 'product_id',
            },
            {
              column: 'product_id',
              throughField: 'category_id',
              relatedName: 'categorySet',
            },
          ],
        },
      ],
    };
    const schema = new Schema(helper.getExampleData(), options);
    const db = helper.connectToDatabase(NAME, schema);
    updateFieldsNullability(db);
    const category = await db.table('category').mock({
      name: 'category 1',
      products: [{}, { price: 0 }],
    });
    const productCategories = await db
      .table('product_category')
      .select('*', { where: { category: { id: category.id } } });
    expect(productCategories.length).toBe(2);
    const products = await db
      .table('product')
      .select('*', { where: { id: productCategories.map((i) => (i.product as any).id) } });

    expect(products.length).toBe(2);
    expect(+products[0].price === 0 || +products[1].price === 0).toBe(true);
    await db.cleanup();
    db.end();
  });
});

describe('cleanup', () => {
  test('circular references', async () => {
    const db = helper.connectToDatabase(NAME);
    updateFieldsNullability(db);
    const post = await db.table('post').mock({});
    await db.table('user').update({ firstPost: post.id }, { id: post.user.id });
    {
      const users = await db.table('user').select('*', { where: { id: post.user.id } });
      expect(users.length).toBe(1);
      expect((users[0].firstPost as any).id).toBe(post.id);
    }
    await db.cleanup();
    const users = await db.table('user').select('*', { where: { id: post.user.id } });
    expect(users.length).toBe(0);
    expect(db.table('post').recordList.length).toBe(0);
    db.end();
  });
});

describe('string prefix', () => {
  it('should use provided string prefix', async () => {
    const db = helper.connectToDatabase(NAME);
    updateFieldsNullability(db);
    setMockStringPrefix('string-');
    const store = await db.table('store').mock();
    expect(store.name).toMatch(/^string-/);
    await db.cleanup();
    db.end();
  })
});

describe('connecting mocked to existing', () => {
  it('should should connect to an existing record', async () => {
    const db = helper.connectToDatabase(NAME);
    updateFieldsNullability(db);
    const user = await db.table('user').create({email: 'fake@mock'});
    const item = await db.table('order_item').mock({
      order: {
        user_id: user.id
      }
    });
    const order = await db.table('order').first('*', {id: item.order.id });
    expect((order as any).user.id).toBe(user.id);
    await db.cleanup();
    {
      const count = await db.table('order').count({id: item.order.id });
      expect(count).toBe(0);
      const row = await db.table('user').first('*', {id: user.id });
      expect(row.email).toBe(user.email);
    }
    const post = await db.table('post').mock({user_id: user.id});
    expect(post.user.id).toBe(user.id);
    const saved = await db.table('post').first('*', {id: post.id });
    expect((saved as any).user.id).toBe(user.id);
    await db.cleanup();
    {
      const count = await db.table('post').count({id: post.id });
      expect(count).toBe(0);
      const row = await db.table('user').first('*', {id: user.id });
      expect(row.email).toBe(user.email);
    }
    db.end();
  })
});

function updateFieldsNullability(db: Database) {
  (db.schema.model('order').field('code') as SimpleField).column.nullable = false;
  (db.schema.model('order_item').field('product') as SimpleField).column.nullable = false;
  (db.schema.model('order_item').field('order') as SimpleField).column.nullable = false;
  (db.schema.model('product').field('sku') as SimpleField).column.nullable = false;
  (db.schema.model('post').field('user') as SimpleField).column.nullable = false;
  (db.schema.model('product_category').field('product') as SimpleField).column.nullable = false;
  (db.schema.model('product_category').field('category') as SimpleField).column.nullable = false;
  (db.schema.model('store').field('name') as SimpleField).column.nullable = false;
}
