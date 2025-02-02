import * as helper from './helper';
import { ViewModel } from '../src/view';
import { SimpleField } from '../src/schema';
import { QueryBuilder } from '../src/filter';

const NAME = 'view';

beforeAll(() => helper.createDatabase(NAME));
afterAll(() => helper.dropDatabase(NAME));

describe('fields', () => {
  test('should have all fields of the base table when not joined', () => {
    const db = helper.connectToDatabase(NAME);
    const view = new ViewModel(db, {
      table: 'service_log',
    });
    const fields = view.fields;
    expect(fields.length).toBe(4);
    expect(fields[0].name).toBe('id');
    expect(fields[1].name).toBe('productCode');
    expect(fields[2].name).toBe('customerEmail');
    expect(fields[3].name).toBe('serviceTime');
    db.end();
  });
  test('should have all fields of all tables when joined', () => {
    const db = helper.connectToDatabase(NAME);
    const view = new ViewModel(db, {
      table: 'service_log sl',
      joins: [
        {
          table: 'product p',
          on: `sl.productCode = p.sku`,
        },
      ],
    });
    const fields1 = db
      .table('service_log')
      .model.fields.filter((field) => field instanceof SimpleField);
    const fields2 = db
      .table('product')
      .model.fields.filter((field) => field instanceof SimpleField);
    const fields = view.fields;
    expect(fields.length).toBe(fields1.length + fields2.length);
    expect(fields[0].name).toBe('id');
    expect(fields[1].name).toBe('productCode');
    expect(fields[2].name).toBe('customerEmail');
    expect(fields[5].name).toBe(fields2[1].name);
    // service_log.id to be shadowed by product.id
    expect(view.field('id').model.name).toBe('Product');
    db.end();
  });
});

describe('query', () => {
  test('view.aliasMap should be honoured', async () => {
    const db = helper.connectToDatabase(NAME);
    const view = new ViewModel(db, {
      table: 'service_log sl',
      joins: [
        {
          table: 'product p',
          on: `sl.productCode = p.sku and p.price > 2`,
        },
        {
          type: 'left',
          table: 'user u',
          on: `sl.customerEmail = u.email and sl.customerEmail is not null`,
        },
      ],
    });
    const builder = new QueryBuilder(view, db.pool);
    const sql = builder.select(['sl.customerEmail', 'p.name as productName'], {
      orderBy: 'sl.customerEmail',
    });
    const rows = await db.query(sql);
    expect(rows).toEqual([
      {
        customerEmail: 'alice@example.com',
        productName: 'Australian Banana',
      },
      {
        customerEmail: 'bob@example.com',
        productName: 'Australian Apple',
      },
    ]);
    db.end();
  });

  test('should return all fields', async () => {
    const db = helper.connectToDatabase(NAME);
    const view = new ViewModel(db, {
      table: 'service_log sl',
      joins: [
        {
          table: 'product p',
          on: `sl.productCode = p.sku and p.price > 2`,
        },
        {
          type: 'left',
          table: 'user u',
          on: `sl.customerEmail = u.email and sl.customerEmail is not null`,
        },
      ],
    });
    const builder = new QueryBuilder(view, db.pool);
    const sql = builder.select(['*'], {});
    const rows = await db.query(sql);
    expect('stockQuantity' in rows[0]).toBe(true);
    db.end();
  });

  test('should return all fields from one table', async () => {
    const db = helper.connectToDatabase(NAME);
    const view = new ViewModel(db, {
      table: 'service_log sl',
      joins: [
        {
          table: 'product p',
          on: `sl.productCode = p.sku and p.price > 2`,
        },
        {
          type: 'left',
          table: 'user u',
          on: `sl.customerEmail = u.email and sl.customerEmail is not null`,
        },
      ],
    });
    const builder = new QueryBuilder(view, db.pool);
    const sql = builder.select(['sl.*', 'u.firstName', 'p.name as productName', 'p.price'], {});
    const rows = await db.query(sql);
    expect(rows.length).toBe(2);
    expect(Object.keys(rows[0]).sort()).toEqual([
      'customerEmail',
      'firstName',
      'id',
      'price',
      'productCode',
      'productName',
      'serviceTime',
    ]);
    db.end();
  });
  test('computed field', async () => {
    const db = helper.connectToDatabase(NAME);
    const view = new ViewModel(db, {
      table: 'service_log sl',
      joins: [
        {
          table: 'product p',
          on: `sl.productCode = p.sku`,
        },
        {
          table: 'user u',
          on: `sl.customerEmail = u.email`,
        },
      ],
    });
    const builder = new QueryBuilder(view, db.pool);
    if (!helper.isSqlite3()) {
      const sql = builder.select(
        ['p.*', 'u.firstName', "concat(p.name, '@', p.price) as product"],
        {}
      );
      const rows = await db.query(sql);
      const info = (rows[0] as any).product;
      expect(info.indexOf('@')).toBeGreaterThan(-1);
    }
    db.end();
  });

  test('should aggregate', async () => {
    const db = helper.connectToDatabase(NAME);
    const view = new ViewModel(db, {
      table: 'order_item oi',
      joins: [
        {
          table: 'product',
          on: `oi.product_id = product.id`,
        },
        {
          table: 'service_log sl',
          on: `sl.product_code = product.sku`,
        },
      ],
    });
    const builder = new QueryBuilder(view, db.pool);
    const sql = builder.select(
      [
        'oi.order.user.email as userEmail',
        'product.name',
        'count(*)',
        'avg(product.price) as price',
      ],
      { groupBy: ['oi.order.user.email', 'product.name'] }
    );
    expect(/\bproduct.\..name.$/.test(sql)).toBe(true);
    const rows = await db.query(sql);
    expect(typeof rows[0].userEmail).toBe('string');
    expect(typeof rows[0].price).toBe('number');
    db.end();
  });
});

describe('raw fields', () => {
  test('extract parts from date', async () => {
    if (helper.isSqlite3()) {
      return;
    }
    const db = helper.connectToDatabase(NAME);
    const view = new ViewModel(db, {
      table: 'order_item oi',
      joins: [
        {
          table: 'product',
          on: `oi.product_id = product.id`,
        },
        {
          table: 'service_log sl',
          on: `sl.product_code = product.sku`,
        },
      ],
    });
    const builder = new QueryBuilder(view, db.pool);
    const sql = builder.select(['extract(year from oi.order.dateCreated) as "yearCreated"'], {
      raw: true,
    });
    const rows = await db.query(sql);
    expect(+(rows[0].yearCreated as string)).toBe(2018);
    await db.end();
  });

  test('conditional expressions', async () => {
    const db = helper.connectToDatabase(NAME);
    const model = db.model('product');
    const builder = new QueryBuilder(model, db.pool);
    const sql = builder.select(
      [
        'name',
        `case
        when name like '%Apple%' then 'Apple'
        when name like '%Orange%' then 'Orange'
        else 'Other'
        end as "productType"`,
      ],
      { raw: true }
    );
    const rows = await db.query(sql);
    expect(/^(Apple|Other)$/.test(rows[0].productType as string)).toBe(true);
    await db.end();
  });
});

describe('smart join', () => {
  test('join with alias', async () => {
    const db = helper.connectToDatabase(NAME);
    const view = new ViewModel(db, {
      table: 'order_item oi',
      joins: [
        {
          table: 'service_log sl',
          on: `sl.product_code = oi.product.sku`,
        },
      ],
    });
    const builder = new QueryBuilder(view, db.pool);
    const sql = builder.select(['oi.order.user.email as userEmail', 'oi.order.id as orderId'], {});
    const rows = await db.query(sql);
    expect(typeof rows[0].userEmail).toBe('string');
    await db.end();
  });

  test('join without alias', async () => {
    const db = helper.connectToDatabase(NAME);
    const view = new ViewModel(db, {
      table: 'order_item',
      joins: [
        {
          table: 'service_log sl',
          on: `sl.product_code = product.sku`,
        },
      ],
    });
    const builder = new QueryBuilder(view, db.pool);
    const sql = builder.select(['order.user.email as userEmail', 'order.id as orderId'], {});
    const rows = await db.query(sql);
    expect(typeof rows[0].userEmail).toBe('string');
    db.end();
  });

  test('join with user specified path', async () => {
    const db = helper.connectToDatabase(NAME);
    const view = new ViewModel(db, {
      table: 'order_item oi',
      joins: [
        {
          table: 'product p',
          on: `oi.product_id = p.id`,
        },
        {
          table: 'service_log sl',
          on: `sl.product_code = p.sku`,
        },
      ],
    });
    const builder = new QueryBuilder(view, db.pool);
    const sql = builder.select(['oi.order.user.email as userEmail', 'oi.order.id as orderId'], {});
    const rows = await db.query(sql);
    expect(typeof rows[0].userEmail).toBe('string');
    await db.end();
  });
});
