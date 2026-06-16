# Getting started

This guide takes you from installation to your first query and your first write.
For anything deeper, follow the links in [Next steps](#next-steps).

## Install

```sh
npm install sqlex
```

sqlex talks to **MySQL**, **PostgreSQL** and **SQLite**. Install the driver for
the database you use:

```sh
npm install mysql2     # MySQL
npm install pg         # PostgreSQL
npm install sqlite3    # SQLite
```

## Connect

Create a `Database` by passing your connection details. The `dialect` selects the
driver; `connection` is passed through to it.

```js
import { Database } from 'sqlex';

// MySQL
const db = new Database({
  dialect: 'mysql',
  connection: {
    host: '127.0.0.1',
    user: 'root',
    password: 'secret',
    database: 'example',
    timezone: 'Z',
    connectionLimit: 10,
  },
});
```

```js
// PostgreSQL
const db = new Database({
  dialect: 'postgres',
  connection: { host: '127.0.0.1', user: 'postgres', password: 'secret', database: 'example' },
});

// SQLite
const db = new Database({
  dialect: 'sqlite3',
  connection: { database: 'example.db' },
});
```

See [Connecting & schema](./connecting.md) for pooling and all connection options.

## Load the schema

Before querying, sqlex needs to know your tables and relationships. The easiest way
is to let it read them from the database:

```js
await db.buildSchema();
```

`buildSchema()` introspects the live database once and caches the result. You can
also construct a `Schema` yourself from a JSON definition — see
[Connecting & schema](./connecting.md).

The database is now ready to use.

## Your first query

`db.table(name)` returns a table you can query. `select` takes the fields (`'*'`
for all columns) and an options object:

```js
const products = await db.table('product').select('*', {
  where: { name_like: '%Apple%' },
  orderBy: 'name',
  limit: 10,
});
```

Fetch a single row with `get` (by primary key or a unique filter) or `first`:

```js
const user = await db.table('user').get({ email: 'alice@example.com' });
const cheapest = await db.table('product').first('*', {}, 'price');
```

Filters support far more than equality (`name_like`, `price_lt`, `status_in`,
`and`/`or`/`not`, …) — see [Filtering](./filtering.md).

## Selecting related data

Ask for related rows by naming the relation instead of `'*'`. This selects each
order with its user and the product on every order item:

```js
const orders = await db.table('order').select({
  user: '*',
  orderItems: {
    fields: { product: '*' },
  },
});

orders[0].user.email;
orders[0].orderItems[0].product.name;
```

More in [Querying](./querying.md).

## Creating and updating

`insert` returns the new primary key; `create` returns the full row. Foreign keys
are set with `connect` (link an existing row) or `create` (make a new one):

```js
const id = await db.table('category').insert({ name: 'Ice' });

const order = await db.table('order').create({
  user: { connect: { email: 'alice@example.com' } },
  code: 'order-1',
});
```

`update` changes rows matching a filter; `upsert` inserts or updates against a
unique key:

```js
await db.table('category').update({ name: 'Ice Cream' }, { name: 'Ice' });

await db.table('order').upsert(
  { user: { connect: { email: 'alice@example.com' } }, code: 'order-1' },
  { status: 1 },
);
```

Nested relations can be created, connected, updated, deleted and disconnected in a
single call — see [Mutations](./mutations.md).

## Closing

Release the connection pool when you're done:

```js
await db.end();
```

## Next steps

- [Connecting & schema](./connecting.md) — connection options, pooling, schema introspection vs. JSON definitions
- [Querying](./querying.md) — selecting rows and related data, ordering, pagination, counting
- [Filtering](./filtering.md) — operators, `and`/`or`/`not`, nested and dotted-path filters
- [Mutations](./mutations.md) — create/update/upsert/modify/delete and nested relation writes
- [Unit of work](./unit-of-work.md) — `append`/`flush`, cyclic references, `replaceRecordsIn`
- [Views & aggregates](./views-and-aggregates.md) — joins, aggregate functions, `groupBy`/`having`
- [Hierarchical data](./hierarchical-data.md) — closure-table trees, ancestors/descendants, cloning
- [Import & export](./import-export.md) — bulk `load`, `xselect`, surrogate keys, serialisers
- [Raw SQL](./raw-sql.md) — parameterised queries with `?` and `:named` placeholders
- [TypeScript](./typescript.md) — typed tables, the type-map generator, `returning`, JSON columns
- [Testing utilities](./testing.md) — `mock()` / `cleanup()` fixtures
- [Command line interface](./cli.md) — schema dump and code/type generation
