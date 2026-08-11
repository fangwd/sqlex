import { Database } from '../src';
import { Schema } from '../src/schema';
import { ApiError, createApi } from '../src/api';
import { Api } from '../src/api/handler';
import { Document } from '../src/types';
import * as helper from './helper';

const NAME = 'api_hooks';

interface Context {
  role: 'staff' | 'customer';
}

let db: Database;

// Order status in the fixture is an int; treat 1 as open, 2 as cancelled,
// 3 as shipped.
function ordersApi(): Api<Context> {
  return createApi<Context>(db, {
    basePath: '/api',
    resources: {
      Order: {
        operations: ['list', 'get', 'create', 'update', 'delete'],
        write: { fields: ['code', 'status'] },
        assign: () => ({ user: 3 }),
        beforeWrite: (context, { operation, data, row }) => {
          if (operation === 'delete') {
            if (row?.status === 3) {
              throw ApiError.unprocessable('a shipped order cannot be deleted');
            }
            return;
          }
          if (context.role === 'customer' && data.status !== undefined) {
            if (data.status !== 2) {
              throw ApiError.unprocessable('a customer may only cancel');
            }
            if (operation === 'update' && row?.status !== 1) {
              throw ApiError.unprocessable('only an open order can be cancelled');
            }
          }
          // Transform: order codes are stored lower-case, whatever was sent.
          if (typeof data.code === 'string') {
            return { ...data, code: data.code.toLowerCase() };
          }
        },
      },
      User: { read: { exclude: ['password'] } },
    },
  });
}

async function send(
  api: Api<Context>,
  method: string,
  path: string,
  body: unknown,
  context: Context
): Promise<Response> {
  return api.handle(
    new Request(`http://test${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    context
  );
}

async function makeOrder(status = 1): Promise<Document> {
  return db.table('order').create({
    code: `hook-${helper.getId()}-${status}-${Math.floor(Math.random() * 1e6)}`,
    user: 3,
    status,
  });
}

beforeAll(async () => {
  await helper.createDatabase(NAME);
  db = new Database(helper.createTestConnectionPool(NAME), new Schema(helper.getExampleData()));
});

afterAll(async () => {
  if (db) await db.end();
  await helper.dropDatabase(NAME);
});

describe('beforeWrite', () => {
  test('a value-level rule refuses per role, with the thrown status', async () => {
    const api = ordersApi();
    const order = await makeOrder(1);

    const shipped = await send(api, 'PATCH', `/api/orders/${order.id}`, { status: 3 }, {
      role: 'customer',
    });
    expect(shipped.status).toBe(422);
    expect(((await shipped.json()) as Document).detail).toBe('a customer may only cancel');

    // The same change is fine for staff...
    expect(
      (await send(api, 'PATCH', `/api/orders/${order.id}`, { status: 3 }, { role: 'staff' }))
        .status
    ).toBe(200);

    // ...and cancelling is fine for the customer, but only from open.
    const open = await makeOrder(1);
    expect(
      (await send(api, 'PATCH', `/api/orders/${open.id}`, { status: 2 }, { role: 'customer' }))
        .status
    ).toBe(200);
    const notOpen = await send(api, 'PATCH', `/api/orders/${order.id}`, { status: 2 }, {
      role: 'customer',
    });
    expect(notOpen.status).toBe(422);
    expect(((await notOpen.json()) as Document).detail).toBe('only an open order can be cancelled');
  });

  test('the event separates client intent from the final write', async () => {
    const events: Document[] = [];
    const api = createApi<Context>(db, {
      basePath: '/api',
      resources: {
        Order: {
          operations: ['create'],
          write: { fields: ['code'] },
          assign: () => ({ user: 3 }),
          beforeWrite: (context, { data, body }) => {
            events.push({ data: { ...data }, body: { ...body } });
          },
        },
        User: {},
      },
    });
    const code = `intent-${Math.floor(Math.random() * 1e6)}`;
    expect((await send(api, 'POST', '/api/orders', { code }, { role: 'staff' })).status).toBe(201);
    // body is what the client sent; data carries the assigned tenant too.
    expect(events).toEqual([{ body: { code }, data: { code, user: 3 } }]);
  });

  test('a refused update leaves the row untouched', async () => {
    const api = ordersApi();
    const order = await makeOrder(3);
    const refused = await send(api, 'PATCH', `/api/orders/${order.id}`, { status: 2 }, {
      role: 'customer',
    });
    expect(refused.status).toBe(422);
    const [after] = await db.table('order').select<Document>('*', {
      where: { id: order.id as number },
    });
    expect(after.status).toBe(3);
  });

  test('a returned document replaces what is written', async () => {
    const api = ordersApi();
    const code = `HOOK-UPPER-${Math.floor(Math.random() * 1e6)}`;
    const response = await send(api, 'POST', '/api/orders', { code }, { role: 'staff' });
    expect(response.status).toBe(201);
    const created = ((await response.json()) as Document).data as Document;
    expect(created.code).toBe(code.toLowerCase());
  });

  test('a delete can be refused by what the row holds', async () => {
    const api = ordersApi();
    const shipped = await makeOrder(3);
    const refused = await send(api, 'DELETE', `/api/orders/${shipped.id}`, undefined, {
      role: 'staff',
    });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as Document).detail).toBe('a shipped order cannot be deleted');

    const open = await makeOrder(1);
    expect(
      (await send(api, 'DELETE', `/api/orders/${open.id}`, undefined, { role: 'staff' })).status
    ).toBe(204);
  });

  test('an unexpected hook error is a bare 500', async () => {
    const errors: unknown[] = [];
    const api = createApi<Context>(
      db,
      {
        basePath: '/api',
        resources: {
          Order: {
            operations: ['create'],
            write: { fields: ['code'] },
            assign: () => ({ user: 3 }),
            beforeWrite: () => {
              throw Error('secret internals');
            },
          },
          User: {},
        },
      },
      { onError: error => errors.push(error) }
    );
    const response = await send(api, 'POST', '/api/orders', { code: 'x' }, { role: 'staff' });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
    expect(errors).toHaveLength(1);
  });
});

describe('afterRead', () => {
  function maskedApi(): Api<Context> {
    return createApi<Context>(db, {
      basePath: '/api',
      resources: {
        Order: {
          operations: ['list', 'get', 'create'],
          write: { fields: ['code'] },
          assign: () => ({ user: 3 }),
          include: { relations: ['user'] },
          // The hook sees the serialised shape.
          afterRead: (context, row) => {
            if (typeof row.dateCreated !== 'string' && row.dateCreated !== null) {
              throw Error('expected the wire shape');
            }
            return { ...row, code: String(row.code).toUpperCase() };
          },
        },
        User: {
          read: { exclude: ['password'] },
          // Redaction per role, mutating in place.
          afterRead: (context, row) => {
            if (context.role !== 'staff' && typeof row.email === 'string') {
              row.email = row.email.replace(/^[^@]+/, '***');
            }
          },
        },
      },
    });
  }

  test('rows are transformed in lists and items', async () => {
    const api = maskedApi();
    const list = await api.handle(new Request('http://test/api/orders?limit=1'), {
      role: 'customer',
    });
    const [row] = ((await list.json()) as Document).data as Document[];
    expect(row.code).toBe(String(row.code).toUpperCase());

    const item = await api.handle(new Request(`http://test/api/orders/${row.id}`), {
      role: 'customer',
    });
    expect((((await item.json()) as Document).data as Document).code).toBe(row.code);
  });

  test('redaction follows the resource into embedded rows, per role', async () => {
    const api = maskedApi();
    const masked = await api.handle(new Request('http://test/api/orders?include=user&limit=5'), {
      role: 'customer',
    });
    for (const row of ((await masked.json()) as Document).data as Document[]) {
      expect(String((row.user as Document).email)).toMatch(/^\*\*\*@/);
    }

    const clear = await api.handle(new Request('http://test/api/users'), { role: 'staff' });
    for (const row of ((await clear.json()) as Document).data as Document[]) {
      expect(String(row.email)).not.toContain('***');
    }
  });

  test('a write response is transformed like any other read', async () => {
    const api = maskedApi();
    const response = await send(
      api,
      'POST',
      '/api/orders',
      { code: `after-read-${Math.floor(Math.random() * 1e6)}` },
      { role: 'customer' }
    );
    expect(response.status).toBe(201);
    const created = ((await response.json()) as Document).data as Document;
    expect(created.code).toBe(String(created.code).toUpperCase());
    // Stored as sent: the transform is presentation only.
    const [row] = await db.table('order').select<Document>('*', {
      where: { id: created.id as number },
    });
    expect(row.code).toBe(String(created.code).toLowerCase());
  });
});
