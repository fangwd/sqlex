import { Database } from '../src';
import { Schema } from '../src/schema';
import { createApi } from '../src/api';
import { Api } from '../src/api/handler';
import { ApiConfig } from '../src/api/config';
import { Document, Value } from '../src/types';
import { Filter } from '../src/database';
import * as helper from './helper';

const NAME = 'api_tenancy';

/** What authentication produced: the tenant is user 3 or user 1. */
interface Context {
  userId: number;
}

// The fixture's `user` table plays the tenant. Orders point at their user, and
// order items reach the tenant through their order.
const CONFIG: ApiConfig<Context> = {
  basePath: '/api',
  resources: {
    // Shared catalogue: no scope, but its embedded order items have one.
    Product: {
      include: { relations: ['orderItems'] },
      sort: { fields: ['name'], default: ['name'] },
    },
    // Scoped through the relation path: an item's tenant is its order's user.
    OrderItem: {
      scope: context => ({ order: { user: context.userId } }),
      operations: ['list', 'get', 'aggregate'],
      aggregate: { fields: ['quantity'] },
      include: { relations: ['order', 'product'] },
    },
    // Deliberately unscoped, to show a scoped reference being withheld.
    Order: {
      operations: ['list', 'get', 'create'],
      write: { fields: ['code'] },
      assign: context => ({ user: context.userId }),
      filter: { fields: ['code'] },
      include: { relations: ['user'] },
    },
    // A tenant may see itself and nothing more.
    User: {
      scope: context => ({ id: context.userId }),
      read: { exclude: ['password'] },
    },
  },
};

let db: Database;
let api: Api<Context>;
let foreignOrder: number;

async function get(path: string, context: Context): Promise<Response> {
  return api.handle(new Request(`http://test${path}`), context);
}

async function data(path: string, context: Context): Promise<Document[]> {
  const response = await get(path, context);
  expect(response.status).toBe(200);
  return ((await response.json()) as Document).data as Document[];
}

beforeAll(async () => {
  await helper.createDatabase(NAME);
  db = new Database(helper.createTestConnectionPool(NAME), new Schema(helper.getExampleData()));

  // The fixture's two orders both belong to user 3; give user 1 an order with
  // an item on a product user 3 also bought, so a leak would be visible.
  const order = await db.table('order').create({ code: 'tenant1-order', user: 1 });
  foreignOrder = order.id as number;
  await db.table('order_item').create({ order: foreignOrder, product: 1, quantity: 5 });

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

describe('rows', () => {
  test('a list is confined to the tenant, through the relation path', async () => {
    const mine = await data('/api/order-items?limit=50', { userId: 3 });
    expect(mine.length).toBe(5);

    const theirs = await data('/api/order-items?limit=50', { userId: 1 });
    expect(theirs.length).toBe(1);
    expect(theirs[0].quantity).toBe(5);
  });

  test("another tenant's item is not found, not forbidden", async () => {
    const [foreign] = await data('/api/order-items?limit=1', { userId: 1 });
    const response = await get(`/api/order-items/${foreign.id}`, { userId: 3 });
    expect(response.status).toBe(404);
  });
});

describe('includes', () => {
  test('an embedded collection is filtered by its own scope', async () => {
    // Product 1 was bought by both tenants; each may only see its own items.
    const products = await data('/api/products?include=orderItems&limit=50', { userId: 3 });
    const apple = products.find(row => row.id === 1) as Document;
    const items = apple.orderItems as Document[];
    expect(items.length).toBe(2); // fixture: order 1 and order 2, both user 3
    for (const item of items) {
      const [owner] = await db
        .table('order')
        .select<Document>('*', { where: { id: (item.order as Document).id as Value } });
      expect((owner.user as Document).id).toBe(3);
    }

    const other = await data('/api/products?include=orderItems&limit=50', { userId: 1 });
    const apple1 = other.find(row => row.id === 1) as Document;
    expect((apple1.orderItems as Document[]).length).toBe(1);
    expect((apple1.orderItems as Document[])[0].quantity).toBe(5);
  });

  test('an expanded reference outside its scope is reduced to the key', async () => {
    // Order is unscoped here, so both tenants' orders list; the user behind
    // another tenant's order stays a bare reference.
    const orders = await data('/api/orders?include=user&limit=50', { userId: 3 });
    const own = orders.find(row => row.code === 'order-1') as Document;
    expect(own.user).toMatchObject({ id: 3, email: 'grace@example.com' });

    const foreign = orders.find(row => row.code === 'tenant1-order') as Document;
    expect(foreign.user).toEqual({ id: 1 });
  });

  test('the reference scope holds through a nested include', async () => {
    // order-items → order (unscoped expansion) → user (scoped): the stripping
    // recurses into embedded rows.
    const items = await data('/api/order-items?include=order.user&limit=50', { userId: 1 });
    expect(items.length).toBe(1);
    const order = items[0].order as Document;
    expect(order.code).toBe('tenant1-order');
    expect(order.user).toMatchObject({ id: 1, email: 'alice@example.com' });

    const own = await data('/api/order-items?include=order.user&limit=50', { userId: 3 });
    for (const item of own) {
      expect(((item.order as Document).user as Document).email).toBe('grace@example.com');
    }
  });

  test('reading the scoped resource directly agrees with the include', async () => {
    // What include=user may embed is exactly what /users serves.
    const users = await data('/api/users', { userId: 3 });
    expect(users.map(row => row.id)).toEqual([3]);
    expect((await get('/api/users/1', { userId: 3 })).status).toBe(404);
  });
});

describe('authorize through includes', () => {
  test('an include cannot reach around a refused read', async () => {
    const api = createApi<Context>(db, {
      basePath: '/api',
      resources: {
        Order: { operations: ['list', 'get'], include: { relations: ['user'] } },
        User: { authorize: () => false, read: { exclude: ['password'] } },
      },
    });
    expect((await api.handle(new Request('http://test/api/users'), { userId: 3 })).status).toBe(
      403
    );
    const embedded = await api.handle(
      new Request('http://test/api/orders?include=user&limit=1'),
      { userId: 3 }
    );
    expect(embedded.status).toBe(403);

    // Without the include the same request is fine.
    expect(
      (await api.handle(new Request('http://test/api/orders?limit=1'), { userId: 3 })).status
    ).toBe(200);
  });

  test('a nested include authorizes every hop', async () => {
    const api = createApi<Context>(db, {
      basePath: '/api',
      resources: {
        OrderItem: { operations: ['list', 'get'], include: { relations: ['order'] } },
        Order: { include: { relations: ['user'] } },
        User: {
          authorize: (context, operation) => operation !== 'get',
          read: { exclude: ['password'] },
        },
      },
    });
    // order is readable, user is not; the deep hop is what trips it.
    const ok = await api.handle(new Request('http://test/api/order-items?include=order&limit=1'), {
      userId: 3,
    });
    expect(ok.status).toBe(200);
    const deep = await api.handle(
      new Request('http://test/api/order-items?include=order.user&limit=1'),
      { userId: 3 }
    );
    expect(deep.status).toBe(403);
  });
});

describe('writes', () => {
  test('assign stamps the tenant onto a create', async () => {
    const response = await api.handle(
      new Request('http://test/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'assigned-order' }),
      }),
      { userId: 1 }
    );
    expect(response.status).toBe(201);
    const created = ((await response.json()) as Document).data as Document;
    expect(created.user).toEqual({ id: 1 });

    const [row] = await db
      .table('order')
      .select<Document>('*', { where: { code: 'assigned-order' } });
    expect((row.user as Document).id).toBe(1);
  });

  test('a client cannot choose its own tenant column', async () => {
    // 'user' is not writable, so naming it is rejected outright...
    const named = await api.handle(
      new Request('http://test/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'forged-order', user: 3 }),
      }),
      { userId: 1 }
    );
    expect(named.status).toBe(400);

    // ...and even where it were writable, assign lands on top of the body.
    const writable = createApi<Context>(db, {
      basePath: '/api',
      resources: {
        Order: {
          operations: ['create'],
          write: { fields: ['code', 'user'] },
          assign: context => ({ user: context.userId }),
        },
        User: {},
      },
    });
    const forged = await writable.handle(
      new Request('http://test/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'forged-order', user: 3 }),
      }),
      { userId: 1 }
    );
    expect(forged.status).toBe(201);
    const [row] = await db
      .table('order')
      .select<Document>('*', { where: { code: 'forged-order' } });
    expect((row.user as Document).id).toBe(1);
  });
});

describe('references', () => {
  // Order items name their order and product; both must be rows the writer's
  // own view admits.
  function itemsApi(): Api<Context> {
    return createApi<Context>(db, {
      basePath: '/api',
      resources: {
        OrderItem: {
          operations: ['list', 'get', 'create', 'update'],
          scope: context => ({ order: { user: context.userId } }),
          write: { fields: ['order', 'product', 'quantity'] },
        },
        Order: { scope: context => ({ user: context.userId }) },
        Product: {},
      },
    });
  }

  async function post(api: Api<Context>, body: Document, context: Context): Promise<Response> {
    return api.handle(
      new Request('http://test/api/order-items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      context
    );
  }

  test("a reference to another tenant's row is refused like a dangling one", async () => {
    const api = itemsApi();
    const [mine] = await db.table('order').select<Document>('*', { where: { user: 3 }, limit: 1 });

    // Order 'foreignOrder' belongs to user 1; user 3 may not attach to it.
    const cross = await post(api, { order: foreignOrder, product: 2, quantity: 1 }, { userId: 3 });
    expect(cross.status).toBe(422);
    const problem = (await cross.json()) as Document;
    // The same message a dangling reference carries: no existence oracle.
    expect(problem.detail).toBe('A referenced row does not exist, or is still referenced');

    // The same body against the writer's own order is fine; Product has no
    // scope here, so any product may be referenced.
    const own = await post(api, { order: mine.id, product: 2, quantity: 1 }, { userId: 3 });
    expect(own.status).toBe(201);
    const created = ((await own.json()) as Document).data as Document;

    // And an update cannot walk the reference across tenants either.
    const moved = await api.handle(
      new Request(`http://test/api/order-items/${created.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ order: foreignOrder }),
      }),
      { userId: 3 }
    );
    expect(moved.status).toBe(422);
  });

  test('a scoped target confines which products staff may reference', async () => {
    // Now products belong to tenants too (via their id here, standing in for
    // a shop column): user 3 may only reference products 1-3.
    const api = createApi<Context>(db, {
      basePath: '/api',
      resources: {
        OrderItem: {
          operations: ['create'],
          scope: context => ({ order: { user: context.userId } }),
          write: { fields: ['order', 'product', 'quantity'] },
        },
        Order: { scope: context => ({ user: context.userId }) },
        Product: { scope: (context): Filter => (context.userId === 3 ? { id_in: [1, 2, 3] } : {}) },
      },
    });
    const [mine] = await db.table('order').select<Document>('*', { where: { user: 3 }, limit: 1 });

    // order-2 also belongs to user 3, and does not yet hold product 3.
    const [second] = await db
      .table('order')
      .select<Document>('*', { where: { code: 'order-2' } });
    const outside = await post(api, { order: second.id, product: 7, quantity: 1 }, { userId: 3 });
    expect(outside.status).toBe(422);
    const inside = await post(api, { order: second.id, product: 3, quantity: 1 }, { userId: 3 });
    expect(inside.status).toBe(201);

    // An unrestricted actor references anything.
    const anyRow = await post(api, { order: foreignOrder, product: 6, quantity: 1 }, { userId: 1 });
    expect(anyRow.status).toBe(201);
  });
});

describe('aggregates', () => {
  test('aggregation is confined to the tenant', async () => {
    // Computed rather than hard-coded: earlier tests add items for both users.
    const expected = async (user: number) => {
      const [row] = await db
        .table('order_item')
        .select<Document>(['sum(quantity) as total'], { where: { order: { user } } });
      return Number(row.total);
    };

    const mineResponse = await get('/api/order-items/aggregate?sum=quantity', { userId: 3 });
    expect(mineResponse.status).toBe(200);
    const [mine] = ((await mineResponse.json()) as Document).data as Document[];
    expect((mine.sum as Document).quantity).toBe(await expected(3));

    const theirsResponse = await get('/api/order-items/aggregate?sum=quantity', { userId: 1 });
    const [theirs] = ((await theirsResponse.json()) as Document).data as Document[];
    expect((theirs.sum as Document).quantity).toBe(await expected(1));
  });
});

describe('roles', () => {
  // The four personas of a real platform, expressed with the same three
  // primitives: authorize gates operations, scope picks rows per role, assign
  // stamps writes per role.
  interface Actor {
    role: 'super' | 'owner' | 'admin' | 'customer';
    userId?: number;
  }

  function platform(): Api<Actor> {
    return createApi<Actor>(db, {
      basePath: '/api',
      resources: {
        Order: {
          operations: ['list', 'get', 'create', 'update'],
          write: { fields: ['code', 'status'] },
          // Staff see the shop's orders (here: all of user 3's, standing in
          // for one shop); a customer sees their own across every shop; a
          // super user sees everything.
          scope: (actor): Filter =>
            actor.role === 'super'
              ? {}
              : actor.role === 'customer'
              ? { user: actor.userId ?? -1 }
              : { user: 3 },
          assign: actor =>
            actor.role === 'customer' ? { user: actor.userId ?? null } : { user: 3 },
          // Only staff change orders; anyone authenticated may read theirs.
          authorize: (actor, operation) =>
            operation === 'update'
              ? actor.role !== 'customer'
              : operation === 'create'
              ? actor.role === 'customer' || actor.role === 'super'
              : true,
        },
        User: {
          read: { exclude: ['password'] },
          // A dynamic list of visible users, which for a customer with no
          // grants comes out empty: an empty array admits nothing.
          scope: (actor): Filter =>
            actor.role === 'super' ? {} : actor.role === 'customer' ? [] : [{ id: 3 }],
        },
      },
    });
  }

  test('an unrestricted scope sees every row', async () => {
    const superUser = platform();
    const response = await superUser.handle(new Request('http://test/api/orders?limit=50'), {
      role: 'super',
    });
    const rows = ((await response.json()) as Document).data as Document[];
    expect(rows.length).toBe(await db.table('order').count());

    const users = await superUser.handle(new Request('http://test/api/users'), { role: 'super' });
    expect((((await users.json()) as Document).data as Document[]).length).toBeGreaterThan(1);
  });

  test('an empty list of alternatives admits nothing', async () => {
    const customer = platform();
    const response = await customer.handle(new Request('http://test/api/users'), {
      role: 'customer',
      userId: 1,
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as Document).data).toEqual([]);
    expect((await customer.handle(new Request('http://test/api/users/3'), {
      role: 'customer',
      userId: 1,
    })).status).toBe(404);
  });

  test('each role reads through its own scope column', async () => {
    const api = platform();
    const staff = await api.handle(new Request('http://test/api/orders?limit=50'), {
      role: 'admin',
    });
    for (const row of ((await staff.json()) as Document).data as Document[]) {
      expect((row.user as Document).id).toBe(3);
    }

    const customer = await api.handle(new Request('http://test/api/orders?limit=50'), {
      role: 'customer',
      userId: 1,
    });
    const own = ((await customer.json()) as Document).data as Document[];
    expect(own.length).toBeGreaterThan(0);
    for (const row of own) expect((row.user as Document).id).toBe(1);
  });

  test('authorize gates the operation with a 403, before any rows', async () => {
    const api = platform();
    const order = (await db.table('order').select<Document>('*', { where: { user: 1 }, limit: 1 }))[0];

    // A customer may read their order but not update it...
    const read = await api.handle(new Request(`http://test/api/orders/${order.id}`), {
      role: 'customer',
      userId: 1,
    });
    expect(read.status).toBe(200);
    const forbidden = await api.handle(
      new Request(`http://test/api/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 9 }),
      }),
      { role: 'customer', userId: 1 }
    );
    expect(forbidden.status).toBe(403);
    expect(((await forbidden.json()) as Document).title).toBe('Forbidden');

    // ...while staff may update it, but only inside their scope: this order
    // belongs to user 1, so for staff it reads as absent.
    const staff = await api.handle(
      new Request(`http://test/api/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 9 }),
      }),
      { role: 'admin' }
    );
    expect(staff.status).toBe(404);
  });

  test('assign stamps each role differently', async () => {
    const api = platform();
    const created = await api.handle(
      new Request('http://test/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: `role-${helper.getId()}` }),
      }),
      { role: 'customer', userId: 1 }
    );
    expect(created.status).toBe(201);
    expect((((await created.json()) as Document).data as Document).user).toEqual({ id: 1 });
  });
});
