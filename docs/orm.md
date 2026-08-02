# ORM records

The ORM layer adds typed record classes and Django-style managers without
replacing sqlex's `Table` API. Model definitions also provide the schema used by
migrations.

## Defining records

`defineRecord` returns a typed subclass of `Record`. Extend it to add ordinary
methods and getters:

```ts
import { defineRecord, field, sqlDefault } from 'sqlex';

export class User extends defineRecord({
  table: 'app_user',
  fields: {
    id: field.id(),
    email: field.string({ maxLength: 254, unique: true }),
    active: field.boolean({ default: true }),
    createdAt: field.datetime({
      column: 'created_at',
      default: sqlDefault('CURRENT_TIMESTAMP'),
    }),
  },
}) {
  get label() {
    return `${this.id}: ${this.email}`;
  }
}
```

`field.id()` is shorthand for an auto-incrementing integer primary key
(`field.integer({ primaryKey: true, generated: true })`).

Fields support `nullable`, `primaryKey`, `unique`, `generated`, `default`,
`column`, and `index`. String fields accept `maxLength`; decimal fields accept
`precision` and `scale`. Enum fields check `default` against the declared
`values` at compile time.

### Field reference

| Factory | Record value | Notes |
| --- | --- | --- |
| `field.id()` | `number` | Generated integer primary key |
| `field.integer()` | `number` | Integer column |
| `field.bigint()` | `number` | Large integer column |
| `field.float()` | `number` | Floating-point column |
| `field.decimal()` | `number` | Accepts `precision` and `scale` |
| `field.string()` | `string` | `varchar`; accepts `maxLength` |
| `field.text()` | `string` | Unbounded text |
| `field.boolean()` | `boolean` | Uses dialect-appropriate storage |
| `field.date()` | `Date` | Date value |
| `field.time()` | `string` | Time value |
| `field.datetime()` | `Date` | Timestamp/datetime value |
| `field.json<T>()` | `T` | Generic JSON value type |
| `field.vector()` | `number[]` | Requires `dimensions`; dense vector/embedding |
| `field.uuid()` | `string` | Native or dialect-appropriate UUID storage |
| `field.enum()` | Literal union | Requires `values`; accepts `typeName` |
| `field.foreignKey()` | Target record | Accepts a record or primary key when writing |

### Vector and embedding fields

Use `field.vector({ dimensions: N })` for a dense embedding with a fixed
number of finite numeric entries:

```ts
class Document extends defineRecord({
  table: 'document',
  fields: {
    id: field.id(),
    embedding: field.vector({ dimensions: 1536 }),
  },
}) {}
```

The record property and create/update inputs are typed as `number[]`. sqlex
checks the dimension count and rejects `NaN` and infinite entries before it
generates SQL. Equality filters use the same array form:

```ts
await models.Document.filter({ embedding: queryEmbedding }).first();
```

PostgreSQL uses pgvector's native `vector(N)` type, so enable the `vector`
extension before applying the generated table migration. MySQL uses the native
`VECTOR(N)` type and requires MySQL 9.0 or newer. SQLite keeps the same declared
`vector(N)` type and stores the portable JSON vector literal as text; it does
not provide PostgreSQL/MySQL vector distance operations.

Vector fields support `column`, `nullable`, and `default`. They cannot be
primary keys, unique, generated, or configured with the portable `index`
option. Vector similarity indexes require engine-specific migration SQL.

Common options:

| Option | Meaning |
| --- | --- |
| `column` | Physical column name when it differs from the field name |
| `nullable` | Adds `null` to the value type and permits database nulls |
| `primaryKey` | Marks the field as the record primary key |
| `unique` | Creates a unique constraint |
| `generated` | Omits the field from required create values |
| `default` | Literal value or `sqlDefault(...)` expression |
| `index` | `true` for a generated index name, or a custom index name |
| `relatedName` | Reverse relation name for a foreign key |
| `onDelete`, `onUpdate` | Foreign-key referential action |

Foreign keys use a callback so declarations can refer to classes defined later.
Declare the reverse relation with `RecordSet` to make it visible to TypeScript:

```ts
import { RecordSet } from 'sqlex';

export class User extends defineRecord({
  // ... as above
}) {
  declare posts: RecordSet<Post>;
}

export class Post extends defineRecord({
  table: 'post',
  fields: {
    id: field.id(),
    author: field.foreignKey(() => User, {
      relatedName: 'posts',
      onDelete: 'cascade',
    }),
    title: field.string({ maxLength: 200 }),
  },
}) {}
```

Always use `declare` when adding field types to a record class body — an
initialized class field is not model data, and its value is ignored.

TypeScript does not allow a class to reference itself in its own base
expression. For self-references or mutually cyclic class types, use the explicit
form and declare the instance fields:

```ts
import { Record, field } from 'sqlex';

export class Category extends Record {
  static readonly definition = {
    table: 'category',
    fields: {
      id: field.id(),
      parent: field.foreignKey('self', { nullable: true }),
      name: field.string({ maxLength: 100 }),
    },
  } as const;

  declare id: number;
  declare parent: Category | null;
  declare name: string;
}
```

## Binding and querying

Bind record classes to a database instance. Binding creates the runtime `Schema`
from the declarations (replacing any schema the instance already had) and keeps
managers isolated between database instances. Bind all record classes in a
single call — a second `bind` on the same instance throws; use `db.clone()`
when a separate set of models is needed:

```ts
const models = db.bind({ User, Post });

const user = await models.User.get({ email: 'alice@example.com' });
const active = await models.User
  .filter({ active: true })
  .orderBy('email')
  .limit(20);
```

Each bound model is a `Manager`. `models.User.objects` is an alias for
`models.User` for those who prefer the Django spelling, and
`models.User.record` is the record class itself.

### Manager reference

| Method | Result |
| --- | --- |
| `all()` | All records |
| `filter(where)` | Immutable `QuerySet` |
| `get(keyOrFilter)` | One record or `undefined`; throws on multiple matches |
| `first(filter?, orderBy?)` | First matching record or `undefined` |
| `count(filter?)` | Matching row count |
| `build(data)` | Unsaved record |
| `create(data)` | Saved and hydrated record |
| `getOrCreate(lookup, defaults?)` | `[record, created]` |
| `query()` | Unfiltered `QuerySet` |

### QuerySet reference

| Method | Result |
| --- | --- |
| `filter(where)` | A new filtered query set |
| `select(fields)` | A new query set with explicit relation selection |
| `orderBy(order)` | A new ordered query set |
| `limit(n)`, `offset(n)` | A new paginated query set |
| `all()` or `await querySet` | Matching records |
| `first()` | First record or `undefined` |
| `count()` | Matching row count |
| `exists()` | Whether any row matches |
| `update(data)` | Bulk update |
| `delete()` | Bulk delete |
| `for await...of` | Async iteration over matching records |

`QuerySet` is immutable and awaitable: awaiting one executes it and returns the
matching records, as do `all`, `first`, `count`, and `exists`. Query sets also
support `for await`:

```ts
for await (const user of models.User.filter({ active: true })) {
  // ...
}
```

`select(...)` uses the same field-selection syntax as `Table.select`.

Record persistence state is kept outside the instance in an internal
`WeakMap`. Model autocomplete therefore contains declared fields and the public
record methods only; internal table, dirty-state, hydration, and identity data
are neither enumerable nor part of the public type. `console.log` and
`JSON.stringify` still print the record's data.

Public record methods are `get`, `save`, `update`, `delete`, `refresh`, `copy`,
and `toJSON`. Persistence internals are intentionally not part of the public
API.

## Creating and saving

Managers create real `Record` instances through the existing graph-aware flush
path:

```ts
const user = await models.User.create({
  email: 'alice@example.com',
});

user.active = false;
await user.save();
await user.refresh();
await user.update({ active: true }); // assign + save in one call
await user.delete();

const data = user.toJSON();
```

Foreign keys accept either a record instance or a plain primary key value:

```ts
await models.Post.create({ author: user, title: 'First post' });
await models.Post.create({ author: userId, title: 'Second post' });
```

Persisted records can point a foreign key at a different parent; unsaved
records are write-once graph nodes and reject conflicting assignments:

```ts
post.author = anotherUser;
await post.save();
```

`getOrCreate` looks up a record by the given values and creates it (merged with
`defaults`) when absent. The boolean reports whether a new record was created.
When a concurrent caller wins the insert race on a unique key, the loser adopts
the winning row as-is — its `defaults` are discarded and it reports `false`:

```ts
const [user, created] = await models.User.getOrCreate(
  { email: 'alice@example.com' },
  { active: false }
);
```

Race detection relies on the database rejecting the duplicate insert, so the
lookup values must be covered by a unique constraint.

Use `build` when several records need to be connected before saving:

```ts
const user = models.User.build({ email: 'new@example.com' });
const post = models.Post.build({ author: user, title: 'First post' });
await post.save(); // saves the unsaved user dependency first
```

## Bulk operations

`update` and `delete` on a query set act on all matching rows in a single
statement, without loading records:

```ts
await models.User.filter({ active: false }).update({ active: true });
await models.Post.filter({ author: user }).delete();
```

Both throw when the query set has `limit`, `offset`, or `orderBy` set, since
bulk statements cannot honor them; load the records and save or delete them
individually instead.

## Relations

Relations are loaded explicitly. Reverse relation managers expose `all`, `add`,
`remove`, `set`, and `clear`; there are no hidden asynchronous property reads:

```ts
const posts = await user.posts.all(); // Post[] via `declare posts: RecordSet<Post>`
await user.posts.add(post);
```
