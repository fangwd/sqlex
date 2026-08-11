import { Database } from '../src';
import { Schema } from '../src/schema';
import { createApi } from '../src/api';
import { Api } from '../src/api/handler';
import { ApiConfig } from '../src/api/config';
import { Document } from '../src/types';
import * as helper from './helper';

const NAME = 'api_handler';

interface Context {
  ownerId?: number;
}

const CONFIG: ApiConfig<Context> = {
  basePath: '/api',
  resources: {
    Product: {
      filter: {
        fields: ['name', 'price', 'status', 'sku'],
        operators: ['eq', 'ne', 'lt', 'le', 'ge', 'gt', 'in', 'notIn', 'like', 'null'],
      },
      sort: { fields: ['name', 'price'], default: ['name'] },
      include: { relations: ['orderItems', 'categories'] },
      page: { defaultLimit: 3, maxLimit: 5 },
    },
    OrderItem: {
      filter: { fields: ['quantity', 'order.code'] },
      sort: { fields: ['quantity', 'order.code'] },
      include: { relations: ['order', 'product'] },
    },
    Order: {
      read: { exclude: ['status'] },
      filter: { fields: ['code'] },
      include: { relations: ['user', 'orderItems'] },
    },
    User: {
      read: { exclude: ['password'] },
      filter: { fields: ['email'], operators: ['eq', 'like'] },
      operations: ['list'],
    },
    Category: {},
  },
};

let db: Database;
let api: Api<Context>;

async function get(path: string, context: Context = {}): Promise<Response> {
  return api.handle(new Request(`http://test${path}`), context);
}

async function body(response: Response): Promise<Document> {
  return (await response.json()) as Document;
}

async function data(path: string, context: Context = {}): Promise<Document[]> {
  const response = await get(path, context);
  expect(response.status).toBe(200);
  return (await body(response)).data as Document[];
}

beforeAll(async () => {
  await helper.createDatabase(NAME);
  db = new Database(helper.createTestConnectionPool(NAME), new Schema(helper.getExampleData()));
  api = createApi(db, CONFIG, {
    onError: error => {
      throw error;
    },
  });
});

afterAll(async () => {
  if (db) await db.end();
  await helper.dropDatabase(NAME);
});

describe('routing', () => {
  test('serves a collection and an item under basePath', async () => {
    const list = await get('/api/products');
    expect(list.status).toBe(200);
    expect(list.headers.get('content-type')).toBe('application/json');

    const rows = await data('/api/products?sort=name&limit=1');
    const item = await body(await get(`/api/products/${rows[0].id}`));
    expect(item.data).toEqual(rows[0]);
  });

  test('a path outside basePath is not found', async () => {
    expect((await get('/products')).status).toBe(404);
  });

  test('an unknown resource and an over-long path are not found', async () => {
    expect((await get('/api/widgets')).status).toBe(404);
    expect((await get('/api/products/1/reviews')).status).toBe(404);
  });

  test('an operation the policy withholds is not found', async () => {
    // User is list-only.
    expect((await get('/api/users')).status).toBe(200);
    expect((await get('/api/users/1')).status).toBe(404);
  });

  test('a write method is rejected as not allowed', async () => {
    const response = await api.handle(
      new Request('http://test/api/products', { method: 'DELETE' }),
      {}
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    // A 405 has to say what is allowed.
    expect(response.headers.get('allow')).toBe('GET, HEAD');
    const problem = await body(response);
    expect(problem.detail).toBe('DELETE is not supported here');
    expect(problem).not.toHaveProperty('headers');
  });

  test('an encoded key keeps its own commas and percent signs', async () => {
    // The identity segment is split before it is decoded, so an encoded comma
    // stays part of one key value instead of splitting it in two.
    const encoded = await get(`/api/products/${encodeURIComponent('1,2')}`);
    expect(encoded.status).toBe(400);
    expect(((await body(encoded)).errors as Document[])[0]).toMatchObject({
      parameter: 'id',
      detail: "expected an integer, got '1,2'",
    });

    // And a literal percent sign survives, rather than being decoded twice.
    const percent = await get(`/api/products/${encodeURIComponent('50%')}`);
    expect(((await body(percent)).errors as Document[])[0].detail).toBe(
      "expected an integer, got '50%'"
    );
  });

  test('malformed percent-encoding in the path is a 4xx, not a 500', async () => {
    // A malformed resource segment is no such resource.
    expect((await get('/api/%zz')).status).toBe(404);

    // A malformed identity value is a 400 naming the parameter, not a URIError.
    for (const bad of ['%zz', '%E0%A4%A']) {
      const response = await get(`/api/products/${bad}`);
      expect(response.status).toBe(400);
      expect(((await body(response)).errors as Document[])[0]).toMatchObject({
        parameter: 'id',
        detail: 'is not valid percent-encoding',
      });
    }
  });

  test('a missing row is a 404 problem document', async () => {
    const response = await get('/api/products/99999');
    expect(response.status).toBe(404);
    const problem = await body(response);
    expect(problem.title).toBe('Not found');
    expect(problem.detail).toBe('No Product with id 99999');
  });
});

describe('reading', () => {
  test('the envelope carries the page metadata', async () => {
    const response = await body(await get('/api/products?limit=2'));
    // The page is full, so a cursor to the next one comes with it.
    expect(response.meta).toEqual({
      limit: 2,
      offset: 0,
      next: expect.any(String),
    });
    expect((response.data as Document[]).length).toBeLessThanOrEqual(2);
  });

  test('total counts the whole match, not the page, and only when asked for', async () => {
    const withTotal = await body(await get('/api/products?limit=1&total=true'));
    const meta = withTotal.meta as Document;
    expect(meta.total).toBe(await db.table('product').count());
    expect((withTotal.data as Document[]).length).toBe(1);
    expect((await body(await get('/api/products?limit=1'))).meta).toEqual({
      limit: 1,
      offset: 0,
      next: expect.any(String),
    });
  });

  test('the default limit applies and the maximum clamps', async () => {
    expect((await data('/api/products')).length).toBe(3);
    const clamped = await body(await get('/api/products?limit=100'));
    expect((clamped.meta as Document).limit).toBe(5);
  });

  test('offset walks the collection', async () => {
    const all = await data('/api/products?sort=name&limit=5');
    const skipped = await data('/api/products?sort=name&limit=5&offset=1');
    expect(skipped[0]).toEqual(all[1]);
  });

  test('the default sort applies until the request overrides it', async () => {
    // The configured default is name ascending.
    const names = (await data('/api/products?limit=5')).map(row => String(row.name));
    expect(names).toEqual([...names].sort());

    const descending = (await data('/api/products?sort=-name&limit=5')).map(row =>
      String(row.name)
    );
    expect(descending).toEqual([...descending].sort().reverse());
    expect(descending[0]).not.toBe(names[0]);
  });

  test('a hidden column is absent from every response', async () => {
    for (const row of await data('/api/users')) {
      expect(row).not.toHaveProperty('password');
      expect(row).toHaveProperty('email');
    }
    for (const row of await data('/api/orders')) {
      expect(row).not.toHaveProperty('status');
    }
  });

  test('an unexpanded foreign key carries only its key', async () => {
    const [row] = await data('/api/order-items?limit=1');
    expect(Object.keys(row.order as Document)).toEqual(['id']);
  });

  test('fields narrows the response', async () => {
    const [row] = await data('/api/products?fields=id,name&limit=1');
    expect(Object.keys(row).sort()).toEqual(['id', 'name']);
  });
});

describe('filtering', () => {
  test('equality, comparison and pattern operators reach the database', async () => {
    const [apple] = await data('/api/products?name=Australian%20Apple');
    expect(apple.name).toBe('Australian Apple');

    const cheap = await data('/api/products?price_lt=6&limit=5');
    for (const row of cheap) expect(Number(row.price)).toBeLessThan(6);

    const matched = await data('/api/products?name_like=%25a%25&limit=5');
    for (const row of matched) expect(String(row.name).toLowerCase()).toContain('a');
  });

  test('a list operator takes comma-separated values', async () => {
    const rows = await data('/api/products?name_in=Australian%20Apple,American%20Beef&limit=5');
    expect(rows.map(row => row.name).sort()).toEqual(['American Beef', 'Australian Apple']);
  });

  test('a null operator selects by nullness', async () => {
    // No fixture product has a null status, so the two are complements.
    expect(await data('/api/products?status_null=true&limit=5')).toEqual([]);
    const present = await data('/api/products?status_null=false&limit=5');
    expect(present.length).toBe(5);
    for (const row of present) expect(row.status).not.toBe(null);
  });

  test('a filter across a relation becomes a nested filter', async () => {
    const rows = await data('/api/order-items?order.code=order-1&limit=5');
    expect(rows.length).toBeGreaterThan(0);
    const codes = await data('/api/order-items?order.code=nope');
    expect(codes).toEqual([]);
  });

  test('several filters on one relation path combine', async () => {
    const rows = await data('/api/order-items?order.code=order-1&quantity_ge=1&limit=5');
    for (const row of rows) expect(Number(row.quantity)).toBeGreaterThanOrEqual(1);
  });

  test('a sort across a relation is accepted', async () => {
    const rows = await data('/api/order-items?sort=order.code,-quantity&limit=5');
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('rejections', () => {
  async function problem(path: string): Promise<Document> {
    const response = await get(path);
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    return body(response);
  }

  test('an unknown parameter is rejected', async () => {
    expect(await problem('/api/products?colour=red')).toMatchObject({
      status: 400,
      errors: [{ parameter: 'colour', detail: "'colour' is not a filterable parameter" }],
    });
  });

  test('filtering a column the policy hides is rejected', async () => {
    expect(await problem('/api/users?password=secret')).toMatchObject({
      errors: [{ parameter: 'password', detail: "'password' is not a filterable parameter" }],
    });
  });

  test('an operator outside the allow-list names the ones that work', async () => {
    const detail = String((((await problem('/api/users?email_ne=a')).errors as Document[])[0]).detail);
    expect(detail).toContain("not an available operator on 'email'");
    expect(detail).toContain('email_like');
  });

  test('a malformed value is a 400, not a 500', async () => {
    expect(await problem('/api/products?price_lt=cheap')).toMatchObject({
      errors: [{ parameter: 'price_lt', detail: "expected a number, got 'cheap'" }],
    });
    expect(await problem('/api/products?status_null=maybe')).toMatchObject({
      errors: [{ parameter: 'status_null', detail: "expected true or false, got 'maybe'" }],
    });
    expect(await problem('/api/products?limit=lots')).toMatchObject({
      errors: [{ parameter: 'limit', detail: "expected a whole number, got 'lots'" }],
    });
  });

  test('a malformed identity is a 400', async () => {
    expect(await problem('/api/products/abc')).toMatchObject({
      errors: [{ parameter: 'id', detail: "expected an integer, got 'abc'" }],
    });
    expect(await problem('/api/products/1,2')).toMatchObject({
      errors: [{ parameter: 'path', detail: 'expected 1 comma-separated key value, got 2' }],
    });
  });

  test('an unsortable column and an unreadable field are rejected', async () => {
    expect(await problem('/api/products?sort=status')).toMatchObject({
      errors: [{ parameter: 'sort', detail: "'status' is not a sortable column" }],
    });
    expect(await problem('/api/users?fields=password')).toMatchObject({
      errors: [{ parameter: 'fields', detail: "'password' is not a readable column" }],
    });
  });

  test('an unavailable relation and an over-deep path are rejected', async () => {
    expect(await problem('/api/products?include=supplier')).toMatchObject({
      errors: [
        { parameter: 'include', detail: "'supplier' is not an includable relation of Product" },
      ],
    });
    expect(await problem('/api/order-items?include=order.user.posts')).toMatchObject({
      errors: [{ parameter: 'include', detail: "'order.user.posts' is deeper than the limit of 2" }],
    });
  });

  test('a repeated parameter is rejected rather than half-applied', async () => {
    expect(await problem('/api/products?name=Australian%20Apple&name=American%20Beef')).toMatchObject(
      { errors: [{ parameter: 'name', detail: 'given more than once' }] }
    );
    // Reserved parameters are read once too.
    expect(await problem('/api/products?limit=1&limit=5')).toMatchObject({
      errors: [{ parameter: 'limit', detail: 'given more than once' }],
    });
  });

  test('every rejected parameter is reported at once', async () => {
    const document = await problem('/api/products?colour=red&limit=lots&sort=status');
    expect((document.errors as Document[]).map(entry => entry.parameter)).toEqual([
      'colour',
      'sort',
      'limit',
    ]);
    expect(document.detail).toBe('3 parameters were rejected');
  });
});

describe('includes', () => {
  test('a to-one relation is embedded', async () => {
    const [row] = await data('/api/order-items?include=order&limit=1');
    const order = row.order as Document;
    expect(order).toHaveProperty('code');
    // The embedded row follows the target's own policy.
    expect(order).not.toHaveProperty('status');
  });

  test('a to-many relation is embedded as an array', async () => {
    const rows = await data('/api/products?include=orderItems&limit=5');
    const withItems = rows.find(row => (row.orderItems as Document[]).length > 0);
    expect(withItems).toBeDefined();
    for (const item of (withItems as Document).orderItems as Document[]) {
      expect(item).toHaveProperty('quantity');
    }
  });

  test('a many-to-many relation resolves through its join table', async () => {
    const rows = await data('/api/products?include=categories&limit=5');
    const withCategories = rows.find(row => (row.categories as Document[]).length > 0);
    expect(withCategories).toBeDefined();
    for (const category of (withCategories as Document).categories as Document[]) {
      expect(category).toHaveProperty('name');
    }
  });

  test('a nested include reaches two levels', async () => {
    const [row] = await data('/api/order-items?include=order.user&limit=1');
    const user = (row.order as Document).user as Document;
    expect(user).toHaveProperty('email');
    expect(user).not.toHaveProperty('password');
  });

  test('a collection nested under a foreign key is resolved', async () => {
    // sqlex cannot join this one, so it falls back to a separate select.
    const [row] = await data('/api/order-items?include=order.orderItems&limit=1');
    const items = (row.order as Document).orderItems as Document[];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item).toHaveProperty('quantity');
  });

  test('a relation that is not requested is absent', async () => {
    const [row] = await data('/api/products?limit=1');
    expect(row).not.toHaveProperty('orderItems');
    expect(row).not.toHaveProperty('categories');
  });
});

describe('scope', () => {
  test('a scope filter cannot be widened by the request', async () => {
    const scoped = createApi<Context>(db, {
      basePath: '/api',
      resources: {
        Product: {
          filter: { fields: ['name', 'price'], operators: ['eq', 'gt'] },
          scope: () => ({ name: 'Australian Apple' }),
          page: { defaultLimit: 10, maxLimit: 10 },
        },
      },
    });

    const all = await scoped.handle(new Request('http://test/api/products'), {});
    const rows = ((await all.json()) as Document).data as Document[];
    expect(rows.map(row => row.name)).toEqual(['Australian Apple']);

    // A filter that would match other rows on its own stays inside the scope.
    const widened = await scoped.handle(
      new Request('http://test/api/products?price_gt=0'),
      {}
    );
    const narrowed = ((await widened.json()) as Document).data as Document[];
    expect(narrowed.map(row => row.name)).toEqual(['Australian Apple']);
  });

  test('the scope receives the request context', async () => {
    const scoped = createApi<Context>(db, {
      basePath: '/api',
      resources: {
        Order: { scope: context => ({ user: context.ownerId ?? 0 }) },
      },
    });
    const response = await scoped.handle(new Request('http://test/api/orders'), { ownerId: 3 });
    const rows = ((await response.json()) as Document).data as Document[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect((row.user as Document).id).toBe(3);

    const empty = await scoped.handle(new Request('http://test/api/orders'), { ownerId: -1 });
    expect((((await empty.json()) as Document).data as Document[])).toEqual([]);
  });

  test('an item outside the scope is not found', async () => {
    const scoped = createApi<Context>(db, {
      basePath: '/api',
      resources: { Product: { scope: () => ({ name: 'Australian Apple' }) } },
    });
    const listed = ((await (
      await scoped.handle(new Request('http://test/api/products'), {})
    ).json()) as Document).data as Document[];
    const apple = listed[0].id;

    expect(
      (await scoped.handle(new Request(`http://test/api/products/${apple}`), {})).status
    ).toBe(200);

    const others = await data('/api/products?name_ne=Australian%20Apple&limit=1');
    const response = await scoped.handle(
      new Request(`http://test/api/products/${others[0].id}`),
      {}
    );
    expect(response.status).toBe(404);
  });
});
