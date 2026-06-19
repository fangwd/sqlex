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

## JSON fields

A `json`/`jsonb` column takes a nested object that filters into the JSON
document, using the same operator suffixes as regular fields. Each key is a key
in the stored JSON; nest objects to descend, or use a dotted key as shorthand.

```js
await db.table('user').select('*', {
  where: {
    meta: {
      name: 'Joe',                    // meta -> name = 'Joe'
      age_gt: 18,                     // (meta -> age) > 18
      active: true,                   // meta -> active is true
      role_in: ['admin', 'editor'],   // meta -> role in (...)
      'address.city': 'NYC',          // meta -> address -> city = 'NYC'
      address: { zip_like: '100%' },  // meta -> address -> zip like '100%'
    },
  },
});
```

All of the operators in the table above work (`_ne`, `_lt`, `_in`, `_like`,
`_null`, …). Two JSON-specific behaviors:

| Form               | Meaning                                                       |
| ------------------ | ------------------------------------------------------------- |
| `field_contains: v`| the JSON value at `field` contains the scalar `v`             |
| `field_null: true` | `field` is JSON null **or** absent                            |

`_contains` is JSON containment at the path: it matches when the value is an
array holding `v`, and (on all backends) also when the value is the scalar `v`
itself. `v` must be a scalar (`string`, `number`, `boolean`, or `null`).

```js
// meta.tags is an array containing 'vip'
await db.table('user').select('*', { where: { meta: { tags_contains: 'vip' } } });
```

### Operator syntax

By default a suffix is only treated as an operator when it is a known operator
name, so a snake_case key such as `first_name` stays a literal key. The cost is
that a key whose own name ends in an operator word collides — `opt_in` parses as
path `opt` with the `in` operator. To address such a key, use the explicit `$`
operator form, where keys are never split:

```js
await db.table('user').select('*', {
  where: {
    meta: {
      first_name: 'Joe',           // literal key
      opt_in: { $eq: 'news' },     // literal key 'opt_in', not the `in` operator
      age: { $gt: 18, $lt: 65 },   // a range (multiple operators on one path)
    },
  },
});
```

Every suffix operator has a `$`-prefixed equivalent (`$eq`, `$ne`, `$lt`, `$le`,
`$gt`, `$ge`, `$in`, `$notIn`, `$like`, `$ilike`, `$null`, `$contains`). An
object whose keys are **all** `$`-prefixed is read as operators on the current
path; an object with no `$` keys is a path descent; mixing the two is an error.
JSON keys that start with `$` are reserved.

The behavior is configurable when constructing the `Database`:

```js
const db = new Database(connection, schema, operatorMap, {
  operatorSyntax: 'both', // 'explicit' | 'suffix' | 'both' (default 'both')
  operatorDelimiter: '_', // '_' | '__' (default '_')
});
```

Use `operatorDelimiter: '__'` to keep the suffix form (`age__gt`) while avoiding
single-underscore collisions, or `operatorSyntax: 'explicit'` to disable suffix
parsing entirely.

JSON-path filtering is supported on PostgreSQL, MySQL and SQLite. Top-level
dotted keys (`{ 'meta.address.city': 'NYC' }`) are **not** JSON paths — they
remain reserved for foreign-key traversal; nest under the column instead.

## Empty result

An empty array for a relation filter matches nothing (and short-circuits to a
`false` condition rather than an invalid `in ()`):

```js
await db.table('user_group').select('*', { where: { group: [] } }); // → []
```
