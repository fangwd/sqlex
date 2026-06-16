# sqlex

*sqlex* helps you retrieve, update, import and export data from a relational
database with minimal ceremony. Alongside the usual one-to-one, many-to-one and
many-to-many relations, it has built-in support for hierarchical data (trees) via
closure tables — including cloning a tree rooted at a given node — and a parameterised
raw-SQL layer with positional (`?`) and named (`:id`) placeholders.

**Supported databases:** MySQL, PostgreSQL, SQLite.

## Install

```sh
npm install sqlex
# plus a driver: mysql2 | pg | sqlite3
```

## Quick example

```js
import { Database } from 'sqlex';

const db = new Database({
  dialect: 'mysql',
  connection: { user: 'root', password: 'secret', database: 'example' },
});

await db.buildSchema(); // read tables & relations from the database

// create an order linked to an existing user
const order = await db.table('order').create({
  user: { connect: { email: 'alice@example.com' } },
  code: 'order-1',
});

// read it back with the user and each item's product expanded
const orders = await db.table('order').select({
  user: '*',
  orderItems: { fields: { product: '*' } },
});

await db.end();
```

New here? Start with the **[Getting started](./docs/getting-started.md)** guide.

## Documentation

**Getting started**
- [Getting started](./docs/getting-started.md) — install, connect, first query and write

**Guides**
- [Connecting & schema](./docs/connecting.md) — connection options, pooling, schema introspection
- [Querying](./docs/querying.md) — selecting rows and related data, ordering, pagination, counting
- [Filtering](./docs/filtering.md) — operators, `and`/`or`/`not`, nested and dotted-path filters
- [Mutations](./docs/mutations.md) — create/update/upsert/modify/delete and nested relation writes
- [Unit of work](./docs/unit-of-work.md) — `append`/`flush`, cyclic references, `replaceRecordsIn`

**Advanced**
- [Views & aggregates](./docs/views-and-aggregates.md) — joins, aggregate functions, `groupBy`/`having`
- [Hierarchical data](./docs/hierarchical-data.md) — closure-table trees, ancestors/descendants, cloning
- [Import & export](./docs/import-export.md) — bulk `load`, `xselect`, surrogate keys, serialisers
- [Raw SQL](./docs/raw-sql.md) — parameterised queries with `?` and `:named` placeholders

**TypeScript & tooling**
- [TypeScript](./docs/typescript.md) — typed tables, the type-map generator, `returning`, JSON columns
- [Testing utilities](./docs/testing.md) — `mock()` / `cleanup()` fixtures
- [Command line interface](./docs/cli.md) — schema dump and code/type generation

## Development

### Testing

```sh
# SQLite
DB_TYPE=sqlite3 npm test

# PostgreSQL
DB_TYPE=postgres DB_USER=postgres npm test

# MySQL
DB_TYPE=mysql DB_USER=root DB_PASS=secret npm test

# generic driver
DB_TYPE=generic SQLEX_DRIVER=/path/to/sqlex.node npm test
```
