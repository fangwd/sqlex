import { Database } from '../src';
import { Schema } from '../src/schema';
import { createApi } from '../src/api';
import { Api } from '../src/api/handler';
import { Document } from '../src/types';
import * as helper from './helper';

const NAME = 'api_cursor';

let db: Database;
let api: Api<unknown>;

async function get(path: string): Promise<Response> {
  return api.handle(new Request(`http://test${path}`), {});
}

async function body(response: Response): Promise<Document> {
  return (await response.json()) as Document;
}

/** Walks a listing by cursor, returning one array of rows per page. */
async function pages(path: string, separator = '&'): Promise<Document[][]> {
  const result: Document[][] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const page = await get(cursor ? `${path}${separator}cursor=${encodeURIComponent(cursor)}` : path);
    expect(page.status).toBe(200);
    const parsed = await body(page);
    result.push(parsed.data as Document[]);
    cursor = (parsed.meta as Document).next as string | undefined;
    if (!cursor) return result;
  }
  throw Error('cursor walk did not terminate');
}

beforeAll(async () => {
  await helper.createDatabase(NAME);
  db = new Database(helper.createTestConnectionPool(NAME), new Schema(helper.getExampleData()));
  api = createApi(db, {
    basePath: '/api',
    resources: {
      Product: {
        filter: { fields: ['status'] },
        sort: { fields: ['name', 'price', 'status'] },
        page: { defaultLimit: 3, maxLimit: 10 },
      },
      OrderItem: {
        sort: { fields: ['quantity', 'order.code'] },
        page: { defaultLimit: 2, maxLimit: 10 },
      },
      OrderShipping: { page: { defaultLimit: 1, maxLimit: 5 } },
    },
  });
});

afterAll(async () => {
  if (db) await db.end();
  await helper.dropDatabase(NAME);
});

describe('walking', () => {
  test('pages cover the collection exactly once and then stop', async () => {
    const walked = await pages('/api/products?limit=3', '&');
    const rows = walked.flat();
    const all = await db.table('product').count();
    expect(rows.length).toBe(all);
    expect(new Set(rows.map(row => row.id)).size).toBe(all);
    // Every page but the last is full, and the walk ends without a cursor.
    for (const page of walked.slice(0, -1)) expect(page.length).toBe(3);
  });

  test('a cursor page carries no offset in its meta', async () => {
    const first = await body(await get('/api/products?limit=3'));
    expect(first.meta).toMatchObject({ limit: 3, offset: 0 });
    const next = (first.meta as Document).next as string;
    const second = await body(await get(`/api/products?limit=3&cursor=${encodeURIComponent(next)}`));
    expect(second.meta).not.toHaveProperty('offset');
  });

  test('a sort with duplicate values does not lose or repeat rows', async () => {
    // Most products share status 1, so the tiebreaker does the real work.
    const rows = (await pages('/api/products?sort=status&limit=2')).flat();
    const all = await db.table('product').count();
    expect(rows.length).toBe(all);
    expect(new Set(rows.map(row => row.id)).size).toBe(all);
    const statuses = rows.map(row => row.status as number);
    expect(statuses).toEqual([...statuses].sort((a, b) => a - b));
  });

  test('a descending sort pages in descending order', async () => {
    const rows = (await pages('/api/products?sort=-price&limit=3')).flat();
    const prices = rows.map(row => Number(row.price));
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
    expect(rows.length).toBe(await db.table('product').count());
  });

  test('the pages agree with an offset walk of the same sort', async () => {
    const byCursor = (await pages('/api/products?sort=name&limit=3')).flat();
    const byOffset = [
      ...((await body(await get('/api/products?sort=name&limit=4'))).data as Document[]),
      ...((await body(await get('/api/products?sort=name&limit=4&offset=4'))).data as Document[]),
    ];
    expect(byCursor.map(row => row.id)).toEqual(byOffset.map(row => row.id));
  });

  test('filters stay applied across pages', async () => {
    const rows = (await pages('/api/products?status=1&limit=2')).flat();
    for (const row of rows) expect(row.status).toBe(1);
    expect(rows.length).toBe(await db.table('product').count({ status: 1 }));
  });

  test('a narrowed response still pages by an unselected sort column', async () => {
    // price is the sort key but not among the requested fields; the cursor is
    // built from it internally without it appearing in the response.
    const walked = await pages('/api/products?sort=price&fields=id,name&limit=3');
    const rows = walked.flat();
    expect(rows.length).toBe(await db.table('product').count());
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(['id', 'name']);
  });

  test('a foreign key as the primary key still pages', async () => {
    const rows = (await pages('/api/order-shippings?limit=1')).flat();
    expect(rows.length).toBe(await db.table('order_shipping').count());
    expect(new Set(rows.map(row => JSON.stringify(row.order))).size).toBe(rows.length);
  });

  test('a scope holds across pages', async () => {
    const scoped = createApi(db, {
      basePath: '/api',
      resources: {
        Product: { scope: () => ({ status: 1 }), page: { defaultLimit: 2, maxLimit: 5 } },
      },
    });
    const rows: Document[] = [];
    let cursor: string | undefined;
    do {
      const response = await scoped.handle(
        new Request(
          `http://test/api/products?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
        ),
        {}
      );
      const parsed = (await response.json()) as Document;
      rows.push(...((parsed.data as Document[]) ?? []));
      cursor = (parsed.meta as Document).next as string | undefined;
    } while (cursor);
    expect(rows.length).toBe(await db.table('product').count({ status: 1 }));
    for (const row of rows) expect(row.status).toBe(1);
  });
});

describe('the cursor never carries a hidden value', () => {
  test('a sort column excluded from reads yields no cursor', async () => {
    // Product.config is excluded from reads but made sortable; the cursor
    // would otherwise encode its value in the clear.
    const guarded = createApi(db, {
      basePath: '/api',
      resources: {
        Product: {
          read: { exclude: ['status'] },
          sort: { fields: ['status', 'name'] },
          page: { defaultLimit: 2, maxLimit: 5 },
        },
      },
    });

    const hidden = await guarded.handle(
      new Request('http://test/api/products?sort=status&limit=2'),
      {}
    );
    const body = (await hidden.json()) as Document;
    expect(hidden.status).toBe(200);
    // No cursor is offered for a hidden sort column...
    expect(body.meta).not.toHaveProperty('next');
    // ...and offset still walks it.
    const rows = body.data as Document[];
    for (const row of rows) expect(row).not.toHaveProperty('status');

    // A readable sort column is unaffected: it still gets a cursor.
    const shown = await guarded.handle(
      new Request('http://test/api/products?sort=name&limit=2'),
      {}
    );
    const meta = ((await shown.json()) as Document).meta as Document;
    expect(typeof meta.next).toBe('string');
    // And what the cursor encodes is only readable columns.
    const decoded = JSON.parse(Buffer.from(meta.next as string, 'base64url').toString());
    expect(decoded[0]).toBe('name,id');
  });
});

describe('rejections', () => {
  test('a cursor cannot be combined with an offset', async () => {
    const first = await body(await get('/api/products?limit=3'));
    const next = (first.meta as Document).next as string;
    const response = await get(`/api/products?limit=3&offset=1&cursor=${encodeURIComponent(next)}`);
    expect(response.status).toBe(400);
    expect(((await body(response)).errors as Document[])[0]).toEqual({
      parameter: 'cursor',
      detail: 'cannot be combined with offset',
    });
  });

  test('a tampered or foreign cursor is rejected', async () => {
    for (const cursor of ['nonsense', Buffer.from('[1,2]').toString('base64url'), '']) {
      const response = await get(`/api/products?cursor=${encodeURIComponent(cursor)}`);
      expect(response.status).toBe(400);
    }
  });

  test('a cursor minted under one sort cannot continue another', async () => {
    const first = await body(await get('/api/products?sort=name&limit=3'));
    const next = (first.meta as Document).next as string;
    const response = await get(`/api/products?sort=-price&limit=3&cursor=${encodeURIComponent(next)}`);
    expect(response.status).toBe(400);
    expect(((await body(response)).errors as Document[])[0].detail).toBe(
      'not a cursor from this sort order'
    );
  });

  test('a sort across a relation cannot be paginated by cursor', async () => {
    // The joined value is not carried by the row, so no cursor is offered...
    const listed = await body(await get('/api/order-items?sort=order.code&limit=2'));
    expect(listed.meta).not.toHaveProperty('next');

    // ...and presenting one is rejected.
    const local = await body(await get('/api/order-items?sort=quantity&limit=2'));
    const next = (local.meta as Document).next as string;
    const response = await get(
      `/api/order-items?sort=order.code&limit=2&cursor=${encodeURIComponent(next)}`
    );
    expect(response.status).toBe(400);
    expect(((await body(response)).errors as Document[])[0].detail).toBe(
      'this sort order cannot be paginated by cursor'
    );
  });
});
