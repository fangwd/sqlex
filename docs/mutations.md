# Mutations

Write data one row at a time, and create/update related rows in the same call.
To build a whole graph of records in memory and persist it together, see
[Unit of work](./unit-of-work.md) instead.

## Single-row operations

| Method                      | Returns          | Notes                                            |
| --------------------------- | ---------------- | ------------------------------------------------ |
| `insert(data)`              | new primary key  | plain column insert                              |
| `create(data)`              | the created row  | supports nested relations                        |
| `update(data, filter)`      | result metadata  | updates every row matching `filter`              |
| `upsert(data, update?)`     | the row          | insert, or update against a unique key           |
| `modify(data, filter)`      | the row          | update one row by unique key; nested relations   |
| `delete(filter)`            | result metadata  | deletes rows matching `filter`                   |

```js
const id = await db.table('category').insert({ name: 'Ice' });

await db.table('category').update({ name: 'Ice Cream' }, { name: 'Ice' });

await db.table('category').delete({ name: 'Ice Cream' });
```

### upsert

`upsert` matches on a unique key in the first argument. If no row exists it
creates one from that argument; if a row exists it applies the (optional) second
argument:

```js
await db.table('order').upsert(
  { user: { connect: { email: 'alice@example.com' } }, code: 'order-1' }, // match / create
  { user: { create: { email: 'nobody@example.com' } }, code: 'order-1b' }, // applied if it already exists
);
```

## Foreign keys: connect vs create

A foreign-key field accepts either `connect` (link an existing row, matched by a
unique key) or `create` (insert a new row and link it):

```js
await db.table('order').create({
  user: { connect: { email: 'alice@example.com' } },
  code: 'order-1',
});

await db.table('order').create({
  user: { create: { email: 'new@example.com' } },
  code: 'order-2',
});
```

## Nested relation writes

`create`, `upsert` and `modify` accept nested writes on to-many relations.
Each relation key takes one or more of these verbs:

| Verb         | Effect                                                        |
| ------------ | ------------------------------------------------------------ |
| `create`     | create new related rows and link them                        |
| `connect`    | link existing rows (matched by a unique key)                 |
| `upsert`     | `{ create, update }` per row — create or update              |
| `update`     | `{ where, data }` per row — update linked rows               |
| `delete`     | delete linked rows matching a filter                         |
| `disconnect` | unlink rows (clear the foreign key) without deleting them    |
| `set`        | replace the entire related set with the given rows           |

### create / connect

```js
await db.table('category').create({
  name: 'Vegetable',
  parent: { connect: { id: 1 } },
  categories: {
    create: [{ name: 'Cucumber' }, { name: 'Tomato' }],
    connect: [
      { parent: { id: 2 }, name: 'Apple' },
      { parent: { id: 2 }, name: 'Banana' },
    ],
  },
});
```

### upsert / update / delete / disconnect

These are typically applied to an existing parent via `modify`:

```js
const where = { name: 'Vegetable', parent: { id: 1 } };

// upsert: create the row, or update it if the create's unique key already exists
await db.table('category').modify(
  { categories: { upsert: [{ create: { name: 'Cucumber' }, update: { name: 'Garlic' } }] } },
  where,
);

// update linked rows by sub-filter
await db.table('category').modify(
  { categories: { update: [{ where: { name: 'Garlic' }, data: { name: 'Cucumber' } }] } },
  where,
);

// delete linked rows
await db.table('category').modify(
  { categories: { delete: [{ name: 'Tomato' }] } },
  where,
);

// disconnect: clears the foreign key, leaving the rows in place
await db.table('category').modify(
  { categories: { disconnect: [{ name: 'Apple' }] } },
  where,
);
```

### Many-to-many

The same verbs drive many-to-many relations (sqlex maintains the join table for
you). For example, creating a category and attaching products by creating some
and connecting others:

```js
await db.table('category').create({
  name: 'Dairy',
  parent: { connect: { id: 1 } },
  products: {
    create: [{ sku: 'yoghurt', name: 'Yoghurt' }, { sku: 'butter', name: 'Butter' }],
    connect: [{ sku: 'cream' }],
  },
});
```

## Returning data after a write

`create`, `upsert` and `modify` accept a `{ returning }` option to fetch columns
and relations after the write. The shape mirrors the
[select field syntax](./querying.md#selecting-related-data):

```js
// expand the related user
const order = await db.table('order').create(
  { user: { connect: { email: 'alice@example.com' } }, code: 'order-1' },
  { returning: { user: '*' } },
);
order.user.email;

// all scalar columns
const updated = await db.table('order').modify(
  { status: 9 },
  { code: 'order-1' },
  { returning: '*' },
);
updated.status;
```
