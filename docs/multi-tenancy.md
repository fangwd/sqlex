# Multi-tenancy

The most common shape of a sqlex API: one deployment serving many tenants —
shops on a platform, workspaces, accounts — where every request is
authenticated, and every read and write must be confined to the requesting
tenant's rows. This page builds a complete multi-shop e-commerce API; the
runnable version is in
[`examples/multi-tenant`](../examples/multi-tenant).

The division of labour:

- **Your server authenticates** and produces a *context* — a plain value naming
  who is asking, e.g. `{ role: 'admin', shopId: 3 }`.
- **`authorize`** decides whether that actor may perform an operation at all —
  a refusal is a `403`.
- **`scope`** turns the context into a filter that confines every read of a
  resource, wherever its rows are reached.
- **`assign`** stamps server-decided values onto every write, so a client
  neither sends nor chooses its tenant.

The API layer never inspects the context; it only passes it to these three
functions. Authentication stays yours.

## The model

Two kinds of table appear in every tenanted schema:

```ts
import { defineRecord, field } from 'sqlex';

export class Shop extends defineRecord({
  table: 'shop',
  fields: {
    id: field.id(),
    name: field.string({ maxLength: 60, unique: true }),
    apiKey: field.string({ column: 'api_key', maxLength: 40, unique: true }),
  },
}) {}

// Carries the tenant column itself.
export class Order extends defineRecord({
  table: 'shop_order',
  fields: {
    id: field.id(),
    shop: field.foreignKey(() => Shop, { relatedName: 'orders' }),
    code: field.string({ maxLength: 30, unique: true }),
    placedAt: field.datetime({ column: 'placed_at' }),
    status: field.enum({ values: ['open', 'shipped', 'cancelled'] as const, default: 'open' }),
  },
}) {}

// Does not: its tenant is reached through the order.
export class OrderItem extends defineRecord({
  table: 'shop_order_item',
  fields: {
    id: field.id(),
    order: field.foreignKey(() => Order, { relatedName: 'items', onDelete: 'cascade' }),
    product: field.foreignKey(() => Product),
    quantity: field.integer(),
  },
}) {}
```

Index the tenant column. Every query the API issues for `Order` carries
`shop_id = ?`; the foreign key gives you the column, but only an index makes
the filter cheap.

## The policy

Tenancy is declared once per resource, next to everything else the resource
allows:

```ts
import type { ApiConfig } from 'sqlex/api';

export interface Context {
  shopId: number;
}

export const api: ApiConfig<Context> = {
  basePath: '/api',
  resources: {
    Order: {
      path: 'orders',
      operations: ['list', 'get', 'create', 'update', 'aggregate'],
      scope: ({ shopId }) => ({ shop: shopId }),
      assign: ({ shopId }) => ({ shop: shopId }),
      write: { fields: ['code', 'placedAt', 'status'] },
      filter: { fields: ['status', 'placedAt', 'code'] },
      sort: { fields: ['placedAt'], default: ['-placedAt'] },
      include: { relations: ['items'] },
      aggregate: { groupBy: ['status'] },
    },
    OrderItem: {
      path: 'order-items',
      // No shop_id of its own: the tenant is reached through the order.
      scope: ({ shopId }) => ({ order: { shop: shopId } }),
      operations: ['list', 'get', 'create', 'delete'],
      write: { fields: ['order', 'product', 'quantity'] },
      include: { relations: ['order', 'product'] },
    },
  },
};
```

Three things to notice.

**The scope is a sqlex filter**, so it is not limited to a column on the table
itself. `{ order: { shop: shopId } }` confines order items through their order
— sqlex compiles it to the join or subquery it needs. Any filter the
[filter language](./filtering.md) can express can be a scope, including paths
several relations deep and `or` across alternatives (a shop's own rows *or*
rows shared with it).

**`assign` and `write` work together.** `shop` is not in `write.fields`, so a
client naming it gets a `400`; `assign` supplies it on every create and update
from the authenticated context. The client's request for a new order is just
`{"code": "...", "placedAt": "..."}` — the tenant column never crosses the
wire. Assigned values land *after* validation and *on top of* the body, so
even a resource that does let clients write the column cannot be lied to.

**A withheld required column is fine when `assign` exists.** Normally the
compiler rejects a policy whose creates cannot supply a `NOT NULL` column; with
`assign` present it defers to it, and a value assign fails to provide still
surfaces as a `422` from the database rather than a row with the wrong tenant.

## Roles

A real platform is not one persona. Take four:

| Persona | May |
| --- | --- |
| platform staff | everything, everywhere |
| shop owner | close their shop; manage its products and orders |
| shop admin | manage the shop's products and orders — not the shop itself |
| customer | browse every shop; see and place their own orders anywhere |

All four fall out of the same three primitives, because each is a plain
function of the context:

```ts
export interface Context {
  role: 'super' | 'owner' | 'admin' | 'customer';
  shopId?: number;
  customerId?: number;
}

const staff = (role: Context['role']) => role === 'owner' || role === 'admin';
const everything: Filter = {};   // an empty filter: no restriction
const nothing: Filter = [];      // an empty list of alternatives: admits nothing

Order: {
  // The same table, three ways in.
  scope: ({ role, shopId, customerId }) =>
    role === 'super' ? everything
    : staff(role)    ? { shop: shopId ?? -1 }
    :                  { customer: customerId ?? -1 },
  // Customers place orders; staff manage them.
  authorize: ({ role }, operation) =>
    operation === 'create' ? role === 'customer' || role === 'super'
    : operation === 'update' ? role !== 'customer'
    : true,
  // Who placed the order comes from authentication; which shop, from the body.
  assign: ({ role, customerId }): Document =>
    role === 'customer' ? { customer: customerId ?? null } : {},
},

Shop: {
  operations: ['list', 'get', 'update'],
  scope: ({ role, shopId }) => (staff(role) ? { id: shopId ?? -1 } : everything),
  // Only the owner (or the platform) may close or reopen a shop.
  authorize: ({ role }, operation) =>
    operation === 'update' ? role === 'owner' || role === 'super' : true,
  write: { fields: ['status'] },
},
```

The scope contract has three cases, all deliberate:

- **`{}` — unrestricted.** The super-user case: every row is admitted, and no
  filter is added to the query at all.
- **`[]` — nothing.** An empty list of alternatives admits no rows. A dynamic
  grant lookup ("the shops this actor may access") that comes back empty fails
  closed, and shop staff given `nothing` for the customer list see an empty
  collection.
- **Anything else** is a sqlex filter: a column, a relation path, an `or`
  across alternatives.

`authorize` and `scope` divide the work on purpose. "May an admin close a
shop?" is `authorize` — the answer is no regardless of which row, so it is a
`403`. "May this owner close *this* shop?" is `scope` — another owner's shop
reads as absent, a `404`. Keeping them separate means neither has to know about
the other's failure mode.

Also deliberate: `assign` may set different columns per role (a customer's
orders are stamped with `customer`, a staff-created product with `shop`), or
nothing (`{}`) where an actor writes without server-set values. Values it does
set are the developer's — they bypass client validation and land on top of the
body.

Below the operation and the row sits the *value*: a customer may change an
order, but only to cancel it, and only while it is open. That is `beforeWrite`
— it runs after validation and `assign`, and for updates and deletes inside the
transaction with the current row in hand, so a refusal rolls back cleanly:

```ts
beforeWrite: ({ role }, { operation, body, row }) => {
  if (role === 'customer' && operation === 'update') {
    if (Object.keys(body).some(name => name !== 'status') || body.status !== 'cancelled') {
      throw ApiError.unprocessable('a customer may only cancel an order');
    }
    if (row?.status !== 'open') {
      throw ApiError.unprocessable('only an open order can be cancelled');
    }
  }
},
```

The event separates `body` — what the client asked for — from `data`, the final
write with `assign` applied, so a rule about client intent is not confused by
the server's own stamps.

Its read-side counterpart, `afterRead`, transforms rows as they are served —
per-role redaction being the typical use — and follows the resource's rows into
embedded relations and write responses, so a masking cannot be reached around
through an `include`.

## Authenticating into a context

The handler is `(Request, context) => Response`; producing the context is the
one thing the server around it must do:

```ts
import { createApi, problemResponse } from 'sqlex/api';

const api = createApi<Context>(db, config.api);

async function serve(request: Request): Promise<Response> {
  const shopId = shopForApiKey(request.headers.get('x-api-key'));
  if (shopId === undefined) {
    return problemResponse({ title: 'Unauthorized', status: 401 });
  }
  return api.handle(request, { shopId });
}
```

Swap the API-key lookup for JWT verification, a session store, or whatever your
platform uses — the API only ever sees the resulting `{ shopId }`. With an
`express`-style stack, run your existing auth middleware and build the context
from `req.user`.

## What the scope guarantees

With the policy above, for a request authenticated as shop 3:

| Request | Behaviour |
| --- | --- |
| any operation `authorize` refuses | `403`, before anything is parsed or read |
| `GET /orders` | Only shop 3's orders; `total`, pages and cursors count only them |
| `GET /orders?status=open&or=...` | Client filters are ANDed inside the scope; no filter widens past it |
| `GET /orders/17` (another shop's) | `404` — the API does not confirm the row exists |
| `GET /orders?include=items` | Embedded collections are filtered by *their own* resource's scope |
| `GET /order-items?include=order` | An expanded reference outside its scope is withheld, reduced to `{ "id": … }` |
| `GET /orders/aggregate?groupBy=status` | Aggregates compute over shop 3's rows only |
| `POST /orders` | The row is created with `shop = 3`, whatever the body says |
| a body referencing another tenant's row | `422`, worded like a dangling reference, so it confirms nothing |
| `PATCH /orders/17` (another shop's) | `404`, and the row is untouched |
| `PATCH` that would move a row out of scope | `422`, rolled back in the same transaction |
| `POST` that would land outside the scope | `422`, nothing left behind |
| `DELETE /orders/17` (another shop's) | `404`, and the row is untouched |

The include rules deserve emphasis, because they are where naive row filtering
leaks. Reaching rows through another resource never shows more than reading
them directly would:

- An **embedded collection** (`Product` → `include=orderItems` on a shared
  catalogue) is filtered by the *target's* scope, applied inside the nested
  query. Two shops embedding the same product see different item lists.
- An **expanded foreign key** whose target is scoped is checked after the read:
  a reference the scope does not admit is reduced back to the bare `{id}` the
  response would carry without the include. The parent legitimately holds the
  key; it does not get the row behind it. This holds at any depth
  (`include=order.user`).

Writes are transactional with their scope checks: an update first proves the
row is inside the scope (else `404`), applies the change, then proves the row
still is (else `422` and rollback). A `tenant_id` can therefore never be
walked out of its tenant through this API, even where the column is writable.

References are held to the same standard. A foreign key the client supplies —
an order item's `product`, say — must point at a row the *target's* scope
admits for this request, checked inside the write's transaction: writing a
relationship to another tenant's row is refused just as reading one is
withheld. The refusal carries the same message as a dangling reference, so it
does not confirm the row exists. Two deliberate exemptions: values `assign`
stamped (the developer speaking, like the scope itself), and targets that are
unscoped or not exposed as resources, where no policy exists to apply.

One pattern worth knowing for required tenant columns: make the column
*writable* and let `assign` override it for stamped roles. The platform's super
user then supplies `shop` in the body, while a shop admin's body value is
overwritten by their own stamp — the same request shape, per-role behaviour,
and nothing to forge.

## What remains your job

- **Authentication.** The API trusts the context completely; a wrong
  `shopId` in it is a wrong tenant everywhere.
- **The scope functions themselves.** They run on every request of that
  resource; keep them pure and fast (they may be async — a cached permission
  lookup is fine, a query per request is your latency).
- **Indexes** on every tenant column and relation path a scope uses.
- **This is not row-level security.** The confinement lives in this API layer.
  Code that talks to the `Database` directly — jobs, migrations, other
  endpoints — is not scoped by it. If you need defence in depth, PostgreSQL
  RLS composes fine underneath.
- **Shared resources are a decision, not a default.** A resource without a
  scope is visible to every authenticated tenant. That is occasionally right
  (a global catalogue); make it deliberate.
- **`filter`, `sort` and `aggregate` are exposure, independent of `read`.** A
  column you list in any of them can be probed even when `read` hides it: a
  filter is a boolean oracle (`?ssn=…` returns rows or not), a sort or an
  aggregate reveals its ordering or totals. This is deliberate — you named the
  column — but do not list a column you mean to keep secret. (A cursor is the
  exception the API closes for you: a sort column absent from `read` yields no
  cursor, so its value cannot leak through one.)

## Testing isolation

Isolation claims deserve tests that would fail loudly. Seed two tenants whose
rows interleave, then assert both directions:

```ts
const api = createApi<Context>(db, config.api);
const as = (shopId: number, path: string) =>
  api.handle(new Request(`http://test${path}`), { shopId });

// Each sees its own rows and no more.
expect(await rows(as(1, '/api/orders'))).toHaveLength(2);
expect(await rows(as(2, '/api/orders'))).toHaveLength(1);

// Cross-tenant access reads as absence, in both directions.
expect((await as(2, `/api/orders/${shop1Order}`)).status).toBe(404);

// The embedded path cannot leak either.
for (const product of await rows(as(2, '/api/products?include=orderItems'))) {
  for (const item of product.orderItems) expectOwnedBy(item, 2);
}
```

The repository's own suite does exactly this in `tests/api-tenancy.test.ts`,
including the forged-write, moved-row, per-role scope and `403` cases; it is a
reasonable template.

## Trying it

```sh
cd examples/multi-tenant
npm install
npm run migration:make -- initial && npm run migration:up
npm start
```

```sh
curl -H 'x-api-key: key-acme-admin' localhost:3000/api/orders   # Acme's orders
curl -H 'x-api-key: key-alice'      localhost:3000/api/orders   # Alice's, across shops
curl -H 'x-api-key: key-root'       localhost:3000/api/orders   # all of them

curl -i -X PATCH -H 'x-api-key: key-acme-admin' -H 'content-type: application/json' \
  localhost:3000/api/shops/1 -d '{"status":"closed"}'            # 403: admins may not
```

The example's README walks all four personas through their permissions and
refusals.
