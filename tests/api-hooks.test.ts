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
  // A stand-in outbox for the atomic side-write tests; no key needed.
  await db.query('create table hook_outbox (order_id integer, note varchar(80))');
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

describe('beforeWrite connection', () => {
  // hook_outbox is not part of the bound schema; read it with raw SQL.
  const outboxRows = (note: string) =>
    db.query<Array<{ note: string }>>('select note from hook_outbox where note = ?', note);

  test('every write receives the transaction connection', async () => {
    const seen: Array<string | undefined> = [];
    const api = createApi<Context>(db, {
      basePath: '/api',
      resources: {
        Order: {
          operations: ['create', 'update', 'delete'],
          write: { fields: ['code', 'status'] },
          assign: () => ({ user: 3 }),
          beforeWrite: (context, { operation, connection }) => {
            seen.push(connection ? operation : undefined);
          },
        },
        User: {},
      },
    });
    const created = await send(
      api, 'POST', '/api/orders',
      { code: `cx-${Math.floor(Math.random() * 1e6)}`, status: 1 },
      { role: 'staff' }
    );
    expect(created.status).toBe(201);
    const id = (((await created.json()) as Document).data as Document).id;
    expect((await send(api, 'PATCH', `/api/orders/${id}`, { status: 2 }, { role: 'staff' })).status).toBe(200);
    expect((await send(api, 'DELETE', `/api/orders/${id}`, undefined, { role: 'staff' })).status).toBe(204);
    expect(seen).toEqual(['create', 'update', 'delete']);
  });

  test('a hook side-write commits with the write it accompanies', async () => {
    const api = createApi<Context>(db, {
      basePath: '/api',
      resources: {
        Order: {
          operations: ['create'],
          write: { fields: ['code'] },
          assign: () => ({ user: 3 }),
          beforeWrite: async (context, { data, connection }) => {
            // The outbox row rides the write's own transaction.
            await connection!.query(
              'insert into hook_outbox (order_id, note) values (?, ?)',
              0,
              String(data.code)
            );
          },
        },
        User: {},
      },
    });
    const code = `outbox-${Math.floor(Math.random() * 1e6)}`;
    expect((await send(api, 'POST', '/api/orders', { code }, { role: 'staff' })).status).toBe(201);
    expect(await outboxRows(code)).toHaveLength(1);
  });

  test('a refused write rolls the hook side-write back', async () => {
    const api = createApi<Context>(db, {
      basePath: '/api',
      resources: {
        Order: {
          operations: ['create'],
          write: { fields: ['code'] },
          assign: () => ({ user: 3 }),
          beforeWrite: async (context, { data, connection }) => {
            await connection!.query(
              'insert into hook_outbox (order_id, note) values (?, ?)',
              0,
              String(data.code)
            );
            throw ApiError.unprocessable('refused after the side-write');
          },
        },
        User: {},
      },
    });
    const code = `rolled-back-${Math.floor(Math.random() * 1e6)}`;
    const refused = await send(api, 'POST', '/api/orders', { code }, { role: 'staff' });
    expect(refused.status).toBe(422);
    expect(await outboxRows(code)).toHaveLength(0);
  });
});

describe('afterCommit', () => {
  test('runs with the committed row, only for writes that landed', async () => {
    const events: Document[] = [];
    const api = createApi<Context>(db, {
      basePath: '/api',
      resources: {
        Order: {
          operations: ['create', 'update', 'delete'],
          write: { fields: ['code', 'status'] },
          assign: () => ({ user: 3 }),
          beforeWrite: (context, { operation, data }) => {
            // a refusal must not reach afterCommit
            if (operation === 'create' && data.code === 'refuse-me') {
              throw ApiError.unprocessable('no');
            }
          },
          afterCommit: (context, { operation, row }) => {
            events.push({ operation, id: row?.id ?? null, status: row?.status ?? null });
          },
        },
        User: {},
      },
    });

    const refused = await send(api, 'POST', '/api/orders', { code: 'refuse-me' }, { role: 'staff' });
    expect(refused.status).toBe(422);
    expect(events).toEqual([]);

    const created = await send(
      api, 'POST', '/api/orders',
      { code: `commit-${Math.floor(Math.random() * 1e6)}`, status: 1 },
      { role: 'staff' }
    );
    expect(created.status).toBe(201);
    const id = (((await created.json()) as Document).data as Document).id;
    // awaited before the response: the event is already recorded
    expect(events).toEqual([{ operation: 'create', id, status: 1 }]);

    await send(api, 'PATCH', `/api/orders/${id}`, { status: 3 }, { role: 'staff' });
    expect(events[1]).toEqual({ operation: 'update', id, status: 3 });

    await send(api, 'DELETE', `/api/orders/${id}`, undefined, { role: 'staff' });
    expect(events[2]).toMatchObject({ operation: 'delete', id });
    expect(events).toHaveLength(3);
  });

  test('sees committed state, and a failure is logged, not served', async () => {
    const api = createApi<Context>(db, {
      basePath: '/api',
      resources: {
        Order: {
          operations: ['create'],
          write: { fields: ['code'] },
          assign: () => ({ user: 3 }),
          afterCommit: async (context, { row }) => {
            // readable through a fresh connection: the transaction is over
            const rows = await db.table('order').select<Document>('*', {
              where: { id: row?.id as number },
            });
            if (!rows.length) throw Error('row not committed');
            throw Error('side effect blew up');
          },
        },
        User: {},
      },
    });
    const response = await send(
      api, 'POST', '/api/orders',
      { code: `committed-${Math.floor(Math.random() * 1e6)}` },
      { role: 'staff' }
    );
    // the write happened; the hook's failure does not fail the response
    expect(response.status).toBe(201);
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

describe('assign', () => {
  test('receives the operation, so create and update can stamp differently', async () => {
    const operations: string[] = [];
    const api = createApi<Context>(db, {
      basePath: '/api',
      resources: {
        Order: {
          operations: ['create', 'update'],
          write: { fields: ['code'] },
          assign: (context, operation) => {
            operations.push(operation);
            return { user: 3, status: operation === 'create' ? 1 : 2 };
          },
        },
        User: {},
      },
    });
    const code = `assign-op-${Math.floor(Math.random() * 1e6)}`;
    const created = await send(api, 'POST', '/api/orders', { code }, { role: 'staff' });
    expect(created.status).toBe(201);
    const row = ((await created.json()) as Document).data as Document;
    expect(row.status).toBe(1);

    const updated = await send(api, 'PATCH', `/api/orders/${row.id}`, { code }, { role: 'staff' });
    expect(updated.status).toBe(200);
    expect((((await updated.json()) as Document).data as Document).status).toBe(2);
    expect(operations).toEqual(['create', 'update']);
  });
});
