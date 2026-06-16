# Filtering

The `where` option (on `select`, and as the filter argument to `get`/`count`/
`update`/`delete`) accepts a plain object. Each key is a field name, optionally
suffixed with an operator; multiple keys are combined with `AND`.

```js
await db.table('product').select('*', {
  where: { name_like: '%Apple%', price_lt: 6 },
});
```

## Operators

Append `_<operator>` to a field name. With no suffix the comparison is equality.

| Suffix     | SQL                         | Example                              |
| ---------- | --------------------------- | ------------------------------------ |
| (none)     | `=`                         | `{ status: 1 }`                      |
| `_ne`      | `<>`                        | `{ status_ne: 1 }`                   |
| `_lt`      | `<`                         | `{ price_lt: 6 }`                    |
| `_le`      | `<=`                        | `{ price_le: 6 }`                    |
| `_gt`      | `>`                         | `{ quantity_gt: 1 }`                 |
| `_ge`      | `>=`                        | `{ quantity_ge: 1 }`                 |
| `_in`      | `in (...)`                  | `{ id_in: [1, 2, 3] }`               |
| `_notIn`   | `not in (...)`              | `{ name_notIn: ['ADMIN', 'STAFF'] }` |
| `_like`    | `like`                      | `{ name_like: '%Apple%' }`           |
| `_ilike`   | case-insensitive `like`     | `{ name_ilike: 'adm%' }`             |
| `_null`    | `is null` / `is not null`   | `{ content_null: true }`             |

`_ilike` is case-insensitive on every supported database (native `ILIKE` on
PostgreSQL, `LIKE` on MySQL/SQLite, which are already case-insensitive).

## Null

Comparing a field to `null` produces `is null` / `is not null`:

```js
await db.table('comment').select('*', { where: { parent: null } });      // parent is null
await db.table('comment').select('*', { where: { content_ne: null } });  // content is not null
```

An array that contains `null` matches null **or** any listed value:

```js
// product.stock_quantity is null OR 0
await db.table('product').select('*', { where: { stockQuantity: [null, 0] } });
```

## Combining conditions: and / or / not

Beyond the implicit `AND` across keys, use the `and`, `or` and `not` keys, each
taking an array of sub-filters:

```js
// and
await db.table('product').select('*', {
  where: { and: [{ name_like: '%Apple%' }, { price_lt: 6 }] },
});

// or
await db.table('product').select('*', {
  where: { or: [{ name_like: '%Apple%' }, { categories_some: { name: 'Banana' } }] },
});

// not (combined with and)
await db.table('product').select('*', {
  where: {
    and: [
      { name_like: '%Australian%' },
      { not: [{ name_like: '%Apple%' }, { categories_some: { name: 'Banana' } }] },
    ],
  },
});
```

A top-level **array** of filters is itself an `OR`:

```js
await db.table('category_tree').select('*', {
  where: [
    { ancestor: { products: [{ id: 3 }] } },
    { descendant: { products: [{ id: 3 }] } },
  ],
});
```

## Filtering across relations

A foreign-key field can take a nested filter on the referenced row. Filters nest
to any depth:

```js
await db.table('order_item').select('*', {
  where: {
    order: {
      user: { id_gt: 2 },
      dateCreated: '2018-03-21',
    },
    product: { id: [1, 2, 3] },
  },
});
```

For to-many relations, use these relation operators with a sub-filter:

| Suffix     | Meaning                                            |
| ---------- | -------------------------------------------------- |
| `_some`    | at least one related row matches                   |
| `_none`    | no related row matches                             |
| `_exists`  | a related row exists matching the sub-filter       |

```js
// users that have at least one matching order
await db.table('user').select('*', {
  where: {
    email: 'grace@example.com',
    orders_some: {
      dateCreated: '2018-03-21T00:00:00.000Z',
      orderItems_none: {
        product: { name_like: '%Lamb%', stockQuantity: [null, 0] },
      },
    },
  },
});

// order items whose product is in a category named like '%Apple'
await db.table('order_item').select('*', {
  where: { product: { categories_exists: { name_like: '%Apple' } } },
});
```

## Empty result

An empty array for a relation filter matches nothing (and short-circuits to a
`false` condition rather than an invalid `in ()`):

```js
await db.table('user_group').select('*', { where: { group: [] } }); // → []
```
