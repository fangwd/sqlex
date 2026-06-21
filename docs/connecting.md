# Connecting & schema

How sqlex connects to a database and learns its structure.

## Connection options

Construct a `Database` with `{ dialect, connection }`. `dialect` picks the driver;
when `connection` is a supported database URL, sqlex can infer it. Object
connection options are passed through to the driver, so any option that driver
supports is available.

```js
import { Database } from 'sqlex';

// MySQL (mysql2)
const db = new Database({
  dialect: 'mysql',
  connection: {
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'secret',
    database: 'example',
    timezone: 'Z',
    connectionLimit: 10,
  },
});

// PostgreSQL (pg)
const db = new Database({
  dialect: 'postgres',
  connection: { host: '127.0.0.1', port: 5432, user: 'postgres', password: 'secret', database: 'example' },
});

// PostgreSQL URL
const db = new Database({
  connection: 'postgresql://postgres:secret@127.0.0.1:5432/example',
});

// SQLite (sqlite3)
const db = new Database({
  dialect: 'sqlite3',
  connection: { database: 'example.db' },
});
```

Supported dialects are `mysql`, `postgres`, `sqlite3` and `generic` (a pluggable
driver selected with `driver`).

## Connection pooling

For MySQL and PostgreSQL, `connectionLimit` sizes the pool. For PostgreSQL this
is mapped to `pg`'s `max` option; passing `max` directly also works. Reads and writes
acquire a pooled connection and release it automatically. When you need several
queries on one connection (e.g. inside a transaction, or to count queries), grab
one yourself and release it when done:

```js
const connection = await db.pool.getConnection();
try {
  await db.table('user').select('*', {}, undefined, connection);
} finally {
  connection.release();
}
```

Call `db.end()` to drain the pool when your process is shutting down.

## Loading the schema

sqlex needs the table and relationship metadata before it can build queries.

### Introspect a live database

```js
await db.buildSchema();
```

`buildSchema()` reads the schema from the database once and caches it. You can
pass a config to augment what's introspected (see [Schema config](#schema-config)):

```js
await db.buildSchema({ name: 'example' });
```

### Provide a schema explicitly

If you already have the schema as JSON (for example dumped via the
[CLI](./cli.md)), build a `Schema` and pass it as the second constructor argument
— no introspection round trip:

```js
import { Database, Schema } from 'sqlex';

const schema = new Schema(schemaJson, config);
const db = new Database({ dialect: 'mysql', connection }, schema);
```

## Schema config

The optional config (second argument to `new Schema`, or the argument to
`buildSchema`) layers extra metadata that can't be introspected from the database
alone.

**Closure tables** — declare which model is backed by a closure table for
hierarchical queries (see [Hierarchical data](./hierarchical-data.md)):

```js
const config = {
  models: [
    { table: 'category', closureTable: { name: 'category_tree' } },
  ],
};
```

**Many-to-many through fields** — expose a join table as a relation on both
sides:

```js
const config = {
  models: [
    {
      table: 'product_category',
      fields: [
        { column: 'category_id', throughField: 'product_id' },
        { column: 'product_id', throughField: 'category_id', relatedName: 'categorySet' },
      ],
    },
  ],
};
```

**Virtual foreign keys** — treat columns as foreign keys even when the database
has no constraint, so you can filter and select across them:

```js
const config = {
  virtualForeignKeys: {
    'service_log.product_code': 'product.sku',
    'service_log.customer_email': 'user.email',
  },
  models: [],
};
```

## Custom filter operators

A third `Database` argument remaps filter operator suffixes to dialect-specific
SQL — for example mapping `_like` to `rlike`:

```js
const db = new Database({ dialect, connection }, schema, { like: 'rlike' });
```

See [Filtering](./filtering.md) for the operator suffixes.
