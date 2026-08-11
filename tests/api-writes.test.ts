import { Database } from '../src';
import { Schema } from '../src/schema';
import { createApi } from '../src/api';
import { Api } from '../src/api/handler';
import { ApiConfig } from '../src/api/config';
import { Document } from '../src/types';
import * as helper from './helper';

const NAME = 'api_writes';

interface Context {
  ownerId?: number;
}

const CONFIG: ApiConfig<Context> = {
  basePath: '/api',
  resources: {
    Product: {
      operations: ['list', 'get', 'create', 'update', 'delete'],
      write: { exclude: ['config'] },
      filter: { fields: ['name', 'sku'] },
      sort: { fields: ['name'] },
    },
    Category: {
      operations: ['list', 'get', 'create', 'update', 'delete'],
      filter: { fields: ['name'] },
    },
    OrderItem: {
      operations: ['list', 'get', 'create', 'delete'],
      filter: { fields: ['quantity'] },
      include: { relations: ['order', 'product'] },
    },
    Order: { operations: ['list', 'get'] },
    DeliveryAddress: { operations: ['list', 'get', 'create'] },
    User: {
      operations: ['list', 'get', 'update'],
      read: { exclude: ['password'] },
      write: { fields: ['email', 'firstName', 'lastName', 'status'] },
    },
  },
};

let db: Database;
let api: Api<Context>;

function url(path: string): string {
  return `http://test${path}`;
}

async function send(
  method: string,
  path: string,
  body?: unknown,
  init: { contentType?: string | null } = {},
  context: Context = {}
): Promise<Response> {
  const headers: Record<string, string> = {};
  const contentType = init.contentType === undefined ? 'application/json' : init.contentType;
  if (contentType !== null) headers['content-type'] = contentType;
  return api.handle(
    new Request(url(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    context
  );
}

async function body(response: Response): Promise<Document> {
  return (await response.json()) as Document;
}

let counter = 0;
const unique = (prefix: string) => `${prefix}-${helper.getId()}-${++counter}`;

beforeAll(async () => {
  await helper.createDatabase(NAME);
  db = new Database(helper.createTestConnectionPool(NAME), new Schema(helper.getExampleData()));
  api = createApi(db, CONFIG);
});

afterAll(async () => {
  if (db) await db.end();
  await helper.dropDatabase(NAME);
});

describe('create', () => {
  test('returns 201, the row, and its location', async () => {
    const sku = unique('sku');
    const response = await send('POST', '/api/products', {
      sku,
      name: 'Created product',
      price: 4.5,
      status: 1,
    });
    expect(response.status).toBe(201);
    const created = (await body(response)).data as Document;
    expect(created).toMatchObject({ sku, name: 'Created product' });
    expect(typeof created.id).toBe('number');
    expect(response.headers.get('location')).toBe(`/api/products/${created.id}`);

    // The row is really there, and reads the same as the create returned.
    const fetched = await api.handle(new Request(url(`/api/products/${created.id}`)), {});
    expect((await body(fetched)).data).toEqual(created);
  });

  test('a hidden column is absent from the created row', async () => {
    const response = await send('POST', '/api/categories', { name: unique('cat') });
    expect(response.status).toBe(201);
  });

  test('a foreign key is set by its key value', async () => {
    const order = (await db.table('order').select('*', { limit: 1 }))[0];
    const product = await db.table('product').create({
      sku: unique('sku'),
      name: 'For order item',
      price: 1,
      status: 1,
    });
    const response = await send('POST', '/api/order-items', {
      order: order.id,
      product: product.id,
      quantity: 3,
    });
    expect(response.status).toBe(201);
    const created = (await body(response)).data as Document;
    expect(created.order).toEqual({ id: order.id });
    expect(created.quantity).toBe(3);
  });

  test('a duplicate unique value is a conflict', async () => {
    const sku = unique('sku');
    expect((await send('POST', '/api/products', { sku, name: 'First', price: 1 })).status).toBe(201);
    const response = await send('POST', '/api/products', { sku, name: 'Second', price: 2 });
    expect(response.status).toBe(409);
    const problem = await body(response);
    expect(problem.title).toBe('Conflict');
    expect(problem.detail).toBe('A row with these values already exists');
  });

  test('a missing referenced row is unprocessable', async () => {
    const response = await send('POST', '/api/order-items', {
      order: 987654,
      product: 987654,
      quantity: 1,
    });
    // These tests run sqlite without foreign key enforcement.
    if (helper.DB_TYPE === 'sqlite3') {
      expect(response.status).toBe(201);
    } else {
      expect(response.status).toBe(422);
      expect((await body(response)).detail).toBe(
        'A referenced row does not exist, or is still referenced'
      );
    }
  });

  test('a required column must be given', async () => {
    const response = await send('POST', '/api/delivery-addresses', { city: 'Perth' });
    expect(response.status).toBe(400);
    const errors = (await body(response)).errors as Document[];
    expect(errors.map(entry => entry.parameter).sort()).toEqual([
      'country',
      'postalCode',
      'state',
      'streetAddress',
    ]);
    expect(errors[0].detail).toMatch(/is required/);
  });
});

describe('rejected bodies', () => {
  test('a column outside the write policy is rejected', async () => {
    const response = await send('POST', '/api/products', {
      sku: unique('sku'),
      name: 'x',
      price: 1,
      config: { featured: true },
    });
    expect(response.status).toBe(400);
    expect((await body(response)).errors).toEqual([
      { parameter: 'config', detail: "'config' is not a writable column" },
    ]);
  });

  test('a relation cannot be written as an object', async () => {
    // sqlex would read this as a nested create; it never reaches sqlex.
    const response = await send('POST', '/api/order-items', {
      order: { create: { code: 'sneaky' } },
      product: 1,
      quantity: 1,
    });
    expect(response.status).toBe(400);
    expect((await body(response)).errors).toEqual([
      { parameter: 'order', detail: 'expected a key value, not an object' },
    ]);
    expect(await db.table('order').select('*', { where: { code: 'sneaky' } })).toEqual([]);
  });

  test('a value of the wrong type is rejected', async () => {
    const response = await send('POST', '/api/products', {
      sku: 12345,
      name: 'x',
      price: 'free',
    });
    expect(response.status).toBe(400);
    const errors = (await body(response)).errors as Document[];
    expect(errors).toEqual([
      { parameter: 'sku', detail: 'expected a string' },
      { parameter: 'price', detail: 'expected a number' },
    ]);
  });

  test('a value longer than the column is rejected', async () => {
    const response = await send('POST', '/api/categories', { name: 'x'.repeat(500) });
    expect(response.status).toBe(400);
    expect((await body(response)).errors).toEqual([
      { parameter: 'name', detail: 'expected at most 200 characters' },
    ]);
  });

  test('null is rejected for a column that is not nullable', async () => {
    const response = await send('POST', '/api/delivery-addresses', {
      streetAddress: null,
      city: 'Perth',
      state: 'WA',
      country: 'AU',
      postalCode: '6000',
    });
    expect(response.status).toBe(400);
    expect((await body(response)).errors).toEqual([
      {
        parameter: 'streetAddress',
        detail: 'expected a value, because the column is not nullable',
      },
    ]);
  });

  test('a body that is not a JSON object is rejected', async () => {
    expect((await send('POST', '/api/categories', [1, 2])).status).toBe(400);
    expect((await send('POST', '/api/categories', 'text')).status).toBe(400);
    const response = await api.handle(
      new Request(url('/api/categories'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      }),
      {}
    );
    expect(response.status).toBe(400);
    expect((await body(response)).errors).toEqual([
      { parameter: 'body', detail: 'expected valid JSON' },
    ]);
  });

  test('a body without a JSON content type is rejected', async () => {
    const response = await send('POST', '/api/categories', { name: 'x' }, { contentType: 'text/plain' });
    expect(response.status).toBe(415);
    expect((await body(response)).detail).toBe("expected application/json, got 'text/plain'");
  });
});

describe('update', () => {
  async function makeProduct(): Promise<Document> {
    const response = await send('POST', '/api/products', {
      sku: unique('sku'),
      name: 'Before',
      price: 1,
      status: 1,
    });
    return (await body(response)).data as Document;
  }

  test('changes only the columns given', async () => {
    const product = await makeProduct();
    const response = await send('PATCH', `/api/products/${product.id}`, { name: 'After' });
    expect(response.status).toBe(200);
    const updated = (await body(response)).data as Document;
    expect(updated).toMatchObject({ id: product.id, name: 'After', sku: product.sku });
    expect(updated.price).toEqual(product.price);
  });

  test('an empty change is rejected', async () => {
    const product = await makeProduct();
    const response = await send('PATCH', `/api/products/${product.id}`, {});
    expect(response.status).toBe(400);
    expect((await body(response)).errors).toEqual([
      { parameter: 'body', detail: 'expected at least one column to change' },
    ]);
  });

  test('a missing row is a 404', async () => {
    const response = await send('PATCH', '/api/products/987654', { name: 'x' });
    expect(response.status).toBe(404);
    expect((await body(response)).detail).toBe('No Product with id 987654');
  });

  test('a duplicate unique value is a conflict', async () => {
    const first = await makeProduct();
    const second = await makeProduct();
    const response = await send('PATCH', `/api/products/${second.id}`, { sku: first.sku });
    expect(response.status).toBe(409);
  });

  test('a column outside the write policy is rejected', async () => {
    const response = await send('PATCH', '/api/users/1', { password: 'secret' });
    expect(response.status).toBe(400);
    expect((await body(response)).errors).toEqual([
      { parameter: 'password', detail: "'password' is not a writable column" },
    ]);
    const [user] = await db.table('user').select('*', { where: { id: 1 } });
    expect(user.password).not.toBe('secret');
  });

  test('a nullable column can be set to null', async () => {
    const product = await makeProduct();
    const response = await send('PATCH', `/api/products/${product.id}`, { status: null });
    expect(response.status).toBe(200);
    expect(((await body(response)).data as Document).status).toBe(null);
  });
});

describe('delete', () => {
  test('removes the row and answers 204', async () => {
    const created = (await body(
      await send('POST', '/api/categories', { name: unique('cat') })
    )).data as Document;

    const response = await send('DELETE', `/api/categories/${created.id}`, undefined, {
      contentType: null,
    });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');

    expect((await api.handle(new Request(url(`/api/categories/${created.id}`)), {})).status).toBe(
      404
    );
  });

  test('a missing row is a 404', async () => {
    const response = await send('DELETE', '/api/categories/987654', undefined, {
      contentType: null,
    });
    expect(response.status).toBe(404);
  });

  test('a row another still references is unprocessable', async () => {
    // order_item references product; deleting the product is refused.
    const order = (await db.table('order').select('*', { limit: 1 }))[0];
    const product = await db.table('product').create({
      sku: unique('sku'),
      name: 'Referenced',
      price: 1,
      status: 1,
    });
    await db.table('order_item').create({
      order: order.id,
      product: product.id,
      quantity: 1,
    });

    const response = await send('DELETE', `/api/products/${product.id}`, undefined, {
      contentType: null,
    });
    // sqlite in these tests has foreign keys off, so the delete succeeds there.
    if (helper.DB_TYPE === 'sqlite3') {
      expect(response.status).toBe(204);
    } else {
      expect(response.status).toBe(422);
      expect((await body(response)).detail).toBe(
        'A referenced row does not exist, or is still referenced'
      );
    }
  });
});

describe('methods', () => {
  test('a withheld write method is reported with what is allowed', async () => {
    // Order is read-only; OrderItem has no update.
    const response = await send('POST', '/api/orders', { code: 'x' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');

    const item = (await db.table('order_item').select('*', { limit: 1 }))[0];
    const patch = await send('PATCH', `/api/order-items/${item.id}`, { quantity: 9 });
    expect(patch.status).toBe(405);
    expect(patch.headers.get('allow')).toBe('GET, HEAD, DELETE');
  });

  test('a writable resource advertises its methods', async () => {
    const response = await send('PUT', '/api/products/1', { name: 'x' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD, PATCH, DELETE');

    const collection = await send('PUT', '/api/products', { name: 'x' });
    expect(collection.status).toBe(405);
    expect(collection.headers.get('allow')).toBe('GET, HEAD, POST');
  });
});

describe('scope', () => {
  function scopedApi(): Api<Context> {
    return createApi<Context>(db, {
      basePath: '/api',
      resources: {
        Order: {
          operations: ['list', 'get', 'update', 'delete'],
          write: { fields: ['code', 'user', 'status'] },
          scope: context => ({ user: context.ownerId ?? 0 }),
        },
      },
    });
  }

  async function orderOf(user: number): Promise<Document> {
    const [row] = await db.table('order').select('*', { where: { user }, limit: 1 });
    return row;
  }

  test('a row outside the scope cannot be updated or deleted', async () => {
    const scoped = scopedApi();
    const order = await orderOf(3);

    const foreign = await scoped.handle(
      new Request(url(`/api/orders/${order.id}`), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 9 }),
      }),
      { ownerId: 1 }
    );
    expect(foreign.status).toBe(404);

    const removal = await scoped.handle(
      new Request(url(`/api/orders/${order.id}`), { method: 'DELETE' }),
      { ownerId: 1 }
    );
    expect(removal.status).toBe(404);

    // Untouched.
    const [after] = await db.table('order').select('*', { where: { id: order.id as number } });
    expect(after.status).toBe(order.status);
  });

  test('a change that would move a row out of scope is refused and rolled back', async () => {
    const scoped = scopedApi();
    const order = await orderOf(3);

    const response = await scoped.handle(
      new Request(url(`/api/orders/${order.id}`), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user: 1 }),
      }),
      { ownerId: 3 }
    );
    expect(response.status).toBe(422);
    expect((await body(response)).detail).toBe(
      'The change would fall outside the rows this request can reach'
    );

    // The row still belongs to its original owner: the write was rolled back.
    const [after] = await db.table('order').select('*', { where: { id: order.id as number } });
    expect((after.user as Document).id).toBe(3);
  });

  test('a change within the scope is applied', async () => {
    const scoped = scopedApi();
    const order = await orderOf(3);
    const code = unique('code');

    const response = await scoped.handle(
      new Request(url(`/api/orders/${order.id}`), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      }),
      { ownerId: 3 }
    );
    expect(response.status).toBe(200);
    expect(((await body(response)).data as Document).code).toBe(code);

    await db.table('order').update({ code: order.code }, { id: order.id as number });
  });

  test('a create that would land outside the scope is refused and rolled back', async () => {
    const scoped = createApi<Context>(db, {
      basePath: '/api',
      resources: {
        Category: {
          operations: ['list', 'create'],
          scope: () => ({ name_like: 'scoped-%' }),
        },
      },
    });

    const name = unique('outside');
    const response = await scoped.handle(
      new Request(url('/api/categories'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
      {}
    );
    expect(response.status).toBe(422);
    expect((await body(response)).detail).toBe(
      'The created row would fall outside the rows this request can reach'
    );

    // Nothing was left behind.
    expect(await db.table('category').select('*', { where: { name } })).toEqual([]);
  });

  test('a create inside the scope succeeds', async () => {
    const scoped = createApi<Context>(db, {
      basePath: '/api',
      resources: {
        Category: { operations: ['list', 'create'], scope: () => ({ name_like: 'scoped-%' }) },
      },
    });
    const name = `scoped-${helper.getId()}`;
    const response = await scoped.handle(
      new Request(url('/api/categories'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
      {}
    );
    expect(response.status).toBe(201);
    expect(((await body(response)).data as Document).name).toBe(name);
  });
});
