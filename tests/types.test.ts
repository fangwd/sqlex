import { Database, TableSpec } from '../src';

interface UserFilter {
  email?: string;
}

interface UserRow {
  id: number;
  email: string | null;
}

interface OrderRow {
  id: number;
  code: string | null;
  user: { id: number } | null;
}

interface OrderCreate {
  code: string;
  user: { connect: UserFilter };
}

interface OrderUpdate {
  code?: string;
  status?: number;
}

interface OrderFilter {
  code?: string;
}

interface OrderWithUser extends OrderRow {
  user: UserRow;
}

interface Tables {
  order: TableSpec<OrderRow, OrderCreate, OrderUpdate, OrderFilter>;
}

async function typedUsage(db: Database<Tables>) {
  const order = await db.table('order').upsert<OrderWithUser>(
    {
      code: 'order-1',
      user: { connect: { email: 'alice@example.com' } },
    },
    {
      status: 1,
    },
    {
      returning: { user: '*' },
    }
  );

  const email: string = order.user.email!;
  return email;
}

async function invalidUsage(db: Database<Tables>) {
  // @ts-expect-error data is checked against the generated create shape
  await db.table('order').upsert({ nope: 'order-1' });

  await db.table('order').upsert(
    { code: 'order-1', user: { connect: { email: 'alice@example.com' } } },
    // @ts-expect-error update is checked independently from create and return shapes
    { nope: 1 }
  );
}

test('typed table API can compile independent upsert return shapes', () => {
  expect(typeof typedUsage).toBe('function');
  expect(typeof invalidUsage).toBe('function');
});
