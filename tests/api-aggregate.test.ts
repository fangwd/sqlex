import { Database } from '../src';
import { Schema } from '../src/schema';
import { createApi } from '../src/api';
import { Api } from '../src/api/handler';
import { Document } from '../src/types';
import * as helper from './helper';

const NAME = 'api_aggregate';

let db: Database;
let api: Api<unknown>;

async function get(path: string): Promise<Response> {
  return api.handle(new Request(`http://test${path}`), {});
}

async function body(response: Response): Promise<Document> {
  return (await response.json()) as Document;
}

async function data(path: string): Promise<Document[]> {
  const response = await get(path);
  expect(response.status).toBe(200);
  return (await body(response)).data as Document[];
}

beforeAll(async () => {
  await helper.createDatabase(NAME);
  db = new Database(helper.createTestConnectionPool(NAME), new Schema(helper.getExampleData()));
  api = createApi(db, {
    basePath: '/api',
    resources: {
      Product: {
        operations: ['list', 'get', 'aggregate'],
        filter: { fields: ['status', 'name'], operators: ['eq', 'ne', 'like'] },
        aggregate: { groupBy: ['status'], fields: ['price', 'stockQuantity', 'sku'] },
      },
      OrderItem: {
        operations: ['list', 'aggregate'],
        aggregate: { groupBy: ['order', 'product'], fields: ['quantity'] },
      },
      // Aggregate exposed with no grants: counting is all it can do.
      Category: { operations: ['aggregate'] },
      // No aggregate operation, so /aggregate is read as a key.
      Order: {},
    },
  });
});

afterAll(async () => {
  if (db) await db.end();
  await helper.dropDatabase(NAME);
});

describe('aggregating', () => {
  test('with nothing asked for, it counts', async () => {
    const rows = await data('/api/products/aggregate');
    expect(rows).toEqual([{ count: await db.table('product').count() }]);
  });

  test('the resource filters apply', async () => {
    const rows = await data('/api/products/aggregate?status=1');
    expect(rows).toEqual([{ count: await db.table('product').count({ status: 1 }) }]);
  });

  test('grouping returns one entry per group, in group order', async () => {
    const rows = await data('/api/products/aggregate?groupBy=status&count=true');
    expect(rows).toEqual([
      { group: { status: 0 }, count: 1 },
      { group: { status: 1 }, count: 7 },
    ]);
  });

  test('sum, avg, min and max come back per requested column', async () => {
    const [row] = await data('/api/products/aggregate?sum=price&avg=price&min=price&max=price');
    expect(row.count).toBeUndefined();
    expect(row.sum).toEqual({ price: 92 });
    expect((row.avg as Document).price).toBeCloseTo(11.5);
    expect(row.min).toEqual({ price: 5 });
    expect(row.max).toEqual({ price: 18 });
  });

  test('min and max work on strings; sums of an empty column are null', async () => {
    const [row] = await data('/api/products/aggregate?min=sku&max=sku&sum=stockQuantity');
    expect(row.min).toEqual({ sku: 'sku001' });
    expect(row.max).toEqual({ sku: 'sku008' });
    // stock_quantity is never set in the fixture.
    expect(row.sum).toEqual({ stockQuantity: null });
  });

  test('grouping by a foreign key uses its key value', async () => {
    const rows = await data('/api/order-items/aggregate?groupBy=order&sum=quantity');
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(typeof (row.group as Document).order).toBe('number');
      expect(typeof (row.sum as Document).quantity).toBe('number');
    }
    const total = rows.reduce((sum, row) => sum + ((row.sum as Document).quantity as number), 0);
    expect(total).toBe(8); // 2+1+2+1+2 across the fixture order items
  });

  test('groups can be paged', async () => {
    const first = await body(await get('/api/order-items/aggregate?groupBy=product&limit=2'));
    expect((first.data as Document[]).length).toBe(2);
    expect(first.meta).toEqual({ limit: 2, offset: 0 });
    const second = await data('/api/order-items/aggregate?groupBy=product&limit=2&offset=2');
    expect(second.length).toBeGreaterThan(0);
    const firstKeys = (first.data as Document[]).map(row => (row.group as Document).product);
    for (const row of second) {
      expect(firstKeys).not.toContain((row.group as Document).product);
    }
  });

  test('a count-only resource counts and nothing else', async () => {
    const rows = await data('/api/categories/aggregate');
    expect(rows).toEqual([{ count: await db.table('category').count() }]);
    const grouped = await get('/api/categories/aggregate?groupBy=name');
    expect(grouped.status).toBe(400);
  });

  test('a scope filters the aggregated rows', async () => {
    const scoped = createApi(db, {
      basePath: '/api',
      resources: {
        Product: { operations: ['aggregate'], scope: () => ({ status: 1 }) },
      },
    });
    const response = await scoped.handle(new Request('http://test/api/products/aggregate'), {});
    expect(((await response.json()) as Document).data).toEqual([
      { count: await db.table('product').count({ status: 1 }) },
    ]);
  });
});

describe('routing', () => {
  test('without the aggregate operation, the segment is a key', async () => {
    const response = await get('/api/orders/aggregate');
    expect(response.status).toBe(400);
    expect(((await body(response)).errors as Document[])[0]).toEqual({
      parameter: 'id',
      detail: "expected an integer, got 'aggregate'",
    });
  });

  test('only reads are allowed on the aggregate route', async () => {
    const response = await api.handle(
      new Request('http://test/api/products/aggregate', { method: 'POST' }),
      {}
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });
});

describe('rejections', () => {
  async function problem(path: string): Promise<Document[]> {
    const response = await get(path);
    expect(response.status).toBe(400);
    return (await body(response)).errors as Document[];
  }

  test('an ungrantable group or function column is rejected', async () => {
    expect(await problem('/api/products/aggregate?groupBy=name')).toEqual([
      { parameter: 'groupBy', detail: "'name' is not a groupable column" },
    ]);
    expect(await problem('/api/products/aggregate?sum=sku')).toEqual([
      { parameter: 'sum', detail: "'sku' is not a column sum can be applied to" },
    ]);
    expect(await problem('/api/products/aggregate?avg=nope')).toEqual([
      { parameter: 'avg', detail: "'nope' is not a column avg can be applied to" },
    ]);
  });

  test('filters outside the policy and malformed values are rejected', async () => {
    expect(await problem('/api/products/aggregate?price=5')).toEqual([
      { parameter: 'price', detail: "'price' is not a filterable parameter" },
    ]);
    expect(await problem('/api/products/aggregate?count=maybe')).toEqual([
      { parameter: 'count', detail: "expected true or false, got 'maybe'" },
    ]);
    expect(await problem('/api/products/aggregate?limit=lots')).toEqual([
      { parameter: 'limit', detail: "expected a whole number, got 'lots'" },
    ]);
  });
});
