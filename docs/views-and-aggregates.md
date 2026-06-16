# Views & aggregates

For queries that span tables with explicit joins, or that compute aggregates,
use `db.select` with a `from` view, or pass aggregate expressions and `groupBy`
to a table `select`.

## Aggregates on a table

A table `select` accepts a list of field expressions — including aggregate
functions and `... as alias` — together with `groupBy`:

```js
const rows = await db.table('order_item').select(
  ['order.user.email', 'count(*) as itemCount', 'sum(quantity) as totalQuantity'],
  { groupBy: ['order.id', 'order.user.email'] },
);

rows[0].itemCount;
rows[0].totalQuantity;
```

Field expressions and `groupBy` may use dotted paths to traverse relations
(`order.user.email`); sqlex adds the necessary joins.

## Filtering aggregates with `having`

`where` filters rows before grouping; `having` filters the grouped results and
can reference both aggregate aliases and grouped columns:

```js
const rows = await db.table('order_item').select(
  ['product.name', 'count(*) as itemCount'],
  {
    groupBy: ['product.name'],
    having: { itemCount_lt: 2, name_like: 'Australia%' },
  },
);
```

`having` uses the same operator suffixes as [Filtering](./filtering.md).

## Ad-hoc views with `db.select`

`db.select` (on the database, not a table) builds a query from an explicit `from`
clause with joins. This is the most flexible form and is handy for reporting
queries that don't map cleanly onto a single table:

```js
const rows = await db.select({
  fields: [
    'oi.order.user.email as userEmail',
    'product.name',
    'count(*)',
    'avg(product.price) as price',
  ],
  from: {
    table: 'order_item oi',
    joins: [
      { table: 'product', on: 'oi.product_id = product.id' },
      { table: 'service_log sl', on: 'sl.product_code = product.sku' },
    ],
  },
  groupBy: ['oi.order.user.email', 'product.name'],
  where: { 'product.name_like': '%Apple%' },
});

typeof rows[0].userEmail; // 'string'
typeof rows[0].price;     // 'number'
```

`db.select` accepts the same `groupBy`/`having`/`orderBy`/`limit`/`offset`
options, and the `from` definition can also be a plain table name when you only
need aggregates without joins.
