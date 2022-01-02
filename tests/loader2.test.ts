import helper = require('./helper');
import { LoadingConfig } from '../src/loader';

const NAME = 'loader2';

beforeAll(() => helper.createDatabase(NAME));
afterAll(() => helper.dropDatabase(NAME));

describe('table.connect', () => {
  it('should connect when parent record exists', async () => {
    const db = helper.connectToDatabase(NAME);
    await db.table('order').insert({
      code: 'loader-order-1',
    });
    const item = db.table('order_item').append({
      order: db.table('order').connect({ code: 'loader-order-1' }),
      product: db.table('product').append({ sku: 'product-1' }),
      quantity: 1,
    });

    const { complete } = await db.flush();
    expect(complete).toBe(true);

    const inserted: any = await db.table('order_item').get({ id: item.id });
    const order = await db.table('order').get({ id: inserted.order.id });

    expect(order.code).toBe('loader-order-1');

    const product = await db.table('product').get({ id: inserted.product.id });
    expect(product.sku).toBe('product-1');
    expect(inserted.quantity).toBe(1);

    db.end();
  });

  it('should not fail when allow partial is true', async () => {
    const db = helper.connectToDatabase(NAME);

    const productCount = (await db.table('product').select('*')).length;
    const itemCount = (await db.table('order_item').select('*')).length;

    db.table('order_item').append({
      order: db.table('order').connect({ code: 'loader-order-2' }),
      product: db.table('product').append({ sku: 'loader-product-1' }),
      quantity: 1,
    });

    const { complete } = await db.flush({ allowPartial: true });
    expect(complete).toBe(false);

    const products = await db.table('product').select('*');
    expect(products.length).toBe(productCount + 1);
    const inserted = products.find((p) => p.sku === 'loader-product-1');
    expect(inserted.id).toBeGreaterThan(0);

    const items = await db.table('order_item').select('*');
    expect(items.length).toBe(itemCount);

    db.end();
  });
});

describe('surrogate keys', () => {
  it('should add key for related fields without through fields', () => {
    const db = helper.connectToDatabase(NAME);
    const model = db.schema.model('order');
    const fields = {
      product: 'orderItems.product.name',
    };
    const config = new LoadingConfig(model, { fields });
    expect(config.fields['__1']).toBe('orderItems.id');
    db.end();
  });

  it('should add keys for related fields with through fields', () => {
    const db = helper.connectToDatabase(NAME);
    const model = db.schema.model('category');
    const fields = {
      name: 'name',
      parent_name: 'parent.name',
      product_name: 'products.name',
      product_price: 'products.price',
    };
    const config = new LoadingConfig(model, { fields });
    expect(config.fields['__1']).toBe('id');
    expect(config.fields['__2']).toBe('products.id');
    db.end();
  });

  it('should add key when root model is a leaf model', () => {
    const db = helper.connectToDatabase(NAME);
    const model = db.schema.model('category');
    const fields = {
      categoryName: 'name',
      parent_name: 'parent.name',
      parent_parent: 'parent.parent',
      '*': 'categoryAttributes[name, value]',
    };
    const config = new LoadingConfig(model, { fields });
    expect(config.fields['__1']).toBe('id');
    db.end();
  });

  it('should add key for multi-level related fields', () => {
    const db = helper.connectToDatabase(NAME);
    const model = db.schema.model('category');
    const fields = {
      categoryName: 'name',
      parent_id: 'products.id',
      parent_name: 'products.name',
      parent_parent: 'products.orderItems.quantity',
    };
    const config = new LoadingConfig(model, { fields });
    expect(config.fields['__1']).toBe('id');
    expect(config.fields['__2']).toBe('products.orderItems.id');
    db.end();
  });
});

describe('loading', () => {
  test('load one to many', async () => {
    const db = helper.connectToDatabase(NAME);
    const table = db.table('category');

    table.append({
      name: 'All',
      parent: null,
    });

    await db.flush();

    const parentId = table.recordList[0].id;

    db.clear();

    const config = {
      categoryName: 'name',
      parent_name: 'parent.name',
      parent_parent: 'parent.parent',
    };

    const data1 = {
      categoryName: 'Example A1',
      parent_name: 'Example A1 Parent',
      parent_parent: '',
    };

    const id = await table.xappend(data1, config);
    const row = await table.first('*', { id });
    expect(row.name).toBe('Example A1');

    db.clear();

    const data2 = {
      categoryName: 'Example A2',
      parent_name: 'Example A2 Parent',
      parent_parent: parentId,
    };

    const id2 = await table.xappend(data2, config);
    const row2 = await table.first('*', { id: id2 });
    expect(row2.name).toBe('Example A2');

    db.end();
  });

  test('load many to many #1', async () => {
    const db = helper.connectToDatabase(NAME);
    const table = db.table('product');

    const config = {
      sku: 'sku',
      name: 'name',
      price: 'price',
      category: 'categories.name',
    };

    const data1 = {
      sku: 'prod-1',
      name: 'Product 1',
      price: 10,
      category: 'Fancy',
    };

    const id = await table.xappend(data1, config, { categories: { parent: 1 } });
    const keys = id.split(':').map(value => +value);
    const row = await table.first({ categories: '*' }, { id: keys[0] });
    expect(row.name).toBe('Product 1');
    expect((row.categories as any).length).toBe(1);
    expect(row.categories[0].name).toBe('Fancy');

    db.end();
  });

  test('load with user provided keys', async () => {
    const db = helper.connectToDatabase(NAME);
    const table = db.table('category');

    const config = {
      categoryName: 'name',
      parent_name: 'parent.name',
      parent_parent: 'parent.parent',
    };

    const data = {
      categoryName: 'Example AX1',
      parent_name: 'Example AX1 Parent',
      parent_parent: '',
    };

    const id = await table.xappend(data, config, {}, ['id', 'parent.id']);
    const keys = id.split(':').map((value) => +value);
    const rows = await table.select('*', { where: { id: keys } });
    expect(rows.length).toBe(2);
    const first = rows.find((r) => r.name === 'Example AX1');
    const second = rows.find((r) => r.id === (first.parent as any).id);
    expect(second.name).toBe('Example AX1 Parent');
    db.end();
  });
});
