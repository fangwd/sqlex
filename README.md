# sqlex

sqlex is a typed ORM, migration toolkit, and relation-aware database API for
PostgreSQL, MySQL, and SQLite. It supports declarative record classes,
checksum-protected migrations, nested relational reads and writes, bulk
import/export, and graph-aware persistence without hiding the underlying SQL
model.

Use the typed ORM for new applications, or introspect an existing database and
work directly with the lower-level `Table` API.

## Requirements

- Node.js 24.12 or newer
- One database driver: `pg`, `mysql2`, or `sqlite3`

```sh
npm install sqlex sqlite3
```

## Typed ORM

Define records once and use the same metadata for TypeScript inference,
relations, and migrations:

```ts
import { Database, defineRecord, field } from 'sqlex';

class User extends defineRecord({
  table: 'app_user',
  fields: {
    id: field.id(),
    email: field.string({ maxLength: 254, unique: true }),
    active: field.boolean({ default: true }),
  },
}) {}

const db = new Database({
  dialect: 'sqlite3',
  connection: { database: 'app.db' },
});
const models = db.bind({ User });

const [user, created] = await models.User.getOrCreate({
  email: 'alice@example.com',
});
const activeUsers = await models.User
  .filter({ active: true })
  .orderBy('email');

console.log({ user, created, activeUsers });
await db.end();
```

The **[ORM and migrations quickstart](./docs/orm-quickstart.md)** covers a
complete SQLite application, including model definitions, generated
migrations, relations, and queries.

## Migrations

Migration files contain structured, reversible operations and a schema
snapshot. Applied migrations are tracked with checksums.

```sh
npx sqlex migration make initial
npx sqlex migration sql
npx sqlex migration up
npx sqlex migration status
```

See **[Migrations](./docs/migrations.md)** for configuration, rollback,
baselining an existing database, manual operations, and dialect limitations.

## Table API

The Table API works from an introspected database and does not require record
classes:

```ts
import { Database } from 'sqlex';

const db = new Database({
  dialect: 'postgres',
  connection: process.env.DATABASE_URL!,
});

await db.buildSchema();

const orders = await db.table('order').select({
  user: '*',
  orderItems: { fields: { product: '*' } },
}, {
  where: { status_in: [10, 20] },
});

await db.end();
```

Start with **[Getting started with the Table API](./docs/getting-started.md)**
when adopting sqlex around an existing schema or when you want direct,
relation-aware table operations.

## Which API?

| Use case | Start here |
| --- | --- |
| New TypeScript application | [ORM quickstart](./docs/orm-quickstart.md) |
| Generated and reversible schema changes | [Migrations](./docs/migrations.md) |
| Existing database with no model declarations | [Table API](./docs/getting-started.md) |
| Nested relational import/export | [Import and export](./docs/import-export.md) |
| Trees backed by closure tables | [Hierarchical data](./docs/hierarchical-data.md) |
| Parameterized SQL with named placeholders | [Raw SQL](./docs/raw-sql.md) |

## Features

- Typed record fields, managers, immutable query sets, and reverse relations
- PostgreSQL, MySQL, and SQLite migration compilation
- Explicit nested relation selection and mutation
- Identity mapping and graph-aware persistence for connected records
- Schema introspection for existing databases
- JSON-path filtering and configurable filter operator syntax
- Closure-table tree traversal and cloning
- Bulk loading, export, serialization, views, and aggregates
- Parameterized raw SQL with positional and named placeholders

## Documentation

**Start here**

- [ORM and migrations quickstart](./docs/orm-quickstart.md)
- [Getting started with the Table API](./docs/getting-started.md)
- [Upgrading to v4](./docs/upgrading-to-4.md)

**ORM and schema**

- [ORM records](./docs/orm.md)
- [Migrations](./docs/migrations.md)
- [Connecting and schema](./docs/connecting.md)
- [TypeScript](./docs/typescript.md)

**Queries and writes**

- [Querying](./docs/querying.md)
- [Filtering](./docs/filtering.md)
- [Mutations](./docs/mutations.md)
- [Unit of work](./docs/unit-of-work.md)

**Advanced**

- [Views and aggregates](./docs/views-and-aggregates.md)
- [Hierarchical data](./docs/hierarchical-data.md)
- [Import and export](./docs/import-export.md)
- [Raw SQL](./docs/raw-sql.md)
- [Testing utilities](./docs/testing.md)

## Community

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local setup, tests, and pull
request guidance. Please report security issues through the process in
[SECURITY.md](./SECURITY.md).

sqlex is released under the [MIT License](./LICENSE).
