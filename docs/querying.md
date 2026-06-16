# Querying

Read rows and related data with `select`, `get`, `first` and `count`. This page
covers the shapes of those calls; for the `where` language see
[Filtering](./filtering.md), and for cross-table joins and aggregates see
[Views & aggregates](./views-and-aggregates.md).

## Selecting rows

`table.select(fields, options?)` returns an array of rows. Use `'*'` for all
columns, or pass a field object to also pull in related data (see
[Selecting related data](#selecting-related-data) below).

```js
const products = await db.table('product').select('*', {
  where: { name_like: '%Apple%' },
  orderBy: 'name',
  offset: 10,
  limit: 10,
});
```

### Options

| Option    | Type                         | Description                                  |
| --------- | ---------------------------- | -------------------------------------------- |
| `where`   | filter object or array       | Row filter — see [Filtering](./filtering.md) |
| `orderBy` | string or string[]           | Sort fields; prefix with `-` for descending  |
| `offset`  | number                       | Rows to skip                                 |
| `limit`   | number                       | Maximum rows to return                       |

`orderBy` accepts dotted paths across relations, and `-` for descending order:

```js
await db.table('order_item').select('*', {
  where: { quantity_gt: 1 },
  orderBy: ['-order.code', 'order.user.email', 'quantity'],
});
```

## A single row

`get` fetches one row by primary key or by a unique filter, and throws if the
filter isn't a unique key:

```js
const byId = await db.table('user').get(1);
const byEmail = await db.table('user').get({ email: 'alice@example.com' });
```

`first` returns the first row matching a filter (or `undefined`), with an optional
`orderBy`:

```js
const cheapest = await db.table('product').first('*', { price_gt: 0 }, 'price');
```

## Counting

```js
const total = await db.table('product').count();
const apples = await db.table('product').count({ name_like: '%Apple%' });
```

## Selecting related data

Instead of `'*'`, pass an object that names the relations to expand. Each
foreign-key or related field can be `'*'` (all of its columns) or a nested
options object.

This selects every order together with its `user` and, for each order item, the
`product`:

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

A nested relation block accepts the same options as a top-level select
(`fields`, `where`, `orderBy`, `limit`, …), so you can filter and order related
rows independently:

```js
const users = await db.table('user').select({
  orders: {
    fields: '*',
    where: { status: 1 },
    orderBy: '-dateCreated',
    limit: 5,
  },
});
```

This works across one-to-one, many-to-one and many-to-many relations. By default
a foreign-key field that you don't expand comes back as a reference object
carrying just the key (e.g. `{ id: 7 }`); name it explicitly to get the full row.

## Selecting a tree

For a model backed by a closure table, `selectTree` returns the row plus its
descendant relations resolved recursively:

```js
const tree = await db.table('product').selectTree({ id: 3 });
```

See [Hierarchical data](./hierarchical-data.md) for closure-table setup.

## Running a query on a specific connection

Every read accepts an optional `connection` as the last argument, which is useful
when you want several queries to share one pooled connection (for example to read
within a transaction or to count queries in a test):

```js
const connection = await db.pool.getConnection();
const rows = await db.table('user_group').select('*', { where: { group: [] } }, undefined, connection);
connection.release();
```
