# TypeScript

sqlex ships full type definitions and can generate a **type map** for your schema
so that `db.table('...')` returns a fully typed table — inputs and results checked
against your actual columns and relations.

## Generating the type map

Point the [CLI](./cli.md) at your database and emit a `.ts` file:

```sh
node_modules/sqlex/bin/sqlex.js --dialect postgres -u user -p secret --export --typeMap mydb > sqlex-schema.ts
```

Or generate it programmatically from a `Schema` / schema JSON:

```ts
import { printSchemaTypeMap } from 'sqlex';

const ts = printSchemaTypeMap(schema, { importPath: 'sqlex' });
```

The generated file defines, per model:

- `*Row` — the row as returned by `select` (nullable columns are `T | null`)
- `*Create` / `*Update` — accepted shapes for writes (with nested relation verbs)
- `*Filter` — the `where` shape
- `*Relations` / `*Selected` — relations and the row-plus-relations type

and a `SqlexTables` map tying table names to those types, plus a
`SqlexDatabase = Database<SqlexTables>` alias.

Foreign-key references use the exported `Identifiable<T = number>` type
(`{ id: T }`) for the common single-`id` primary key; a model-specific `*Ref` is
generated only when the primary key isn't a single `id` column.

## Using the typed database

Parameterise `Database` with the generated map:

```ts
import { Database } from 'sqlex';
import type { SqlexTables } from './sqlex-schema';

const db = new Database<SqlexTables>({ dialect: 'postgres', connection });
await db.buildSchema();

const user = await db.table('user').get({ email: 'alice@example.com' });
user.email;   // typed
// user.nope; // compile error
```

`db.table(name)` is overloaded on the literal table name, so the returned table's
write methods are checked against that table's generated create/update/filter
types — including nested relation writes. Read methods default to the generated
row type, while dynamic select fields and filters remain permissive for raw
expressions and runtime-built queries.

## Typing query results

`select` defaults to the table's `*Row` type. When you select related data or
aliases, pass a type argument describing the result shape (you can compose the
generated row types):

```ts
import type { OrderRow, UserRow } from './sqlex-schema';

type OrderWithUser = OrderRow & { user: UserRow };

const orders = await db.table('order').select<OrderWithUser>({ user: '*' });
orders[0].user.email;
```

## Typed `returning`

The `returning` option on `create`/`upsert`/`modify` is typed the same way — pass
the expected result type:

```ts
const order = await db.table('order').upsert<OrderWithUser>(
  { user: { connect: { email: 'alice@example.com' } }, code: 'order-1' },
  { status: 1 },
  { returning: { user: '*' } },
);
order.user.email;
```

## JSON columns

`json` / `jsonb` columns are serialised on write and parsed on read, so you work
with plain objects/arrays. In the generated types they appear as `JsonValue`
(`string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }`).

For example, given a table with a `json`/`jsonb` `payload` column:

```ts
await db.table('event').create({ name: 'signup', payload: { plan: 'pro', seats: 5 } });
const row = await db.table('event').get(1);
row.payload; // JsonValue (already parsed)
```
