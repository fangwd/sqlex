# Import & export

Bulk-load external data into related tables, extract flattened views back out,
and serialise whole object graphs.

## Importing with `xappend`

`table.xappend(data, fields)` loads an array of plain objects into a table,
mapping each source property to a column or a path across relations. Dotted paths
create/connect related rows automatically.

```js
const table = db.table('category');

const fields = {
  categoryName: 'name',           // source `categoryName` -> column `name`
  parent_name: 'parent.name',     // create/link a parent by name
  parent_parent: 'parent.parent', // grandparent
};

const data = [
  { categoryName: 'Example A1', parent_name: 'Example A1 Parent', parent_parent: '' },
  { categoryName: 'Example A2', parent_name: 'Example A2 Parent', parent_parent: 42 },
];

await table.xappend(data, fields);
```

### Key/value attribute tables

A `'*'` entry routes every *unmapped* source property into a child table as
name/value rows — useful for entity-attribute-value designs:

```js
const fields = {
  categoryName: 'name',
  parent_name: 'parent.name',
  '*': 'categoryAttributes[name, value]', // leftover props -> category_attribute(name, value)
};

const data = [
  { categoryName: 'Example B1', parent_name: 'B1 Parent', colour: 'Red', weight: '100kg' },
];

await table.xappend(data, fields);
```

`xappend` also accepts `defaults` (applied to every row) and `keys` (surrogate-key
fields) arguments.

## Extracting with `xselect`

`table.xselect(fields)` is the inverse: it reads related data and flattens it into
plain objects shaped by the field map.

```js
const config = {
  name: 'name',
  parent_name: 'parent.name',
  product_name: 'products.name',
  product_price: 'products.price',
  '*': 'categoryAttributes[name, value]',
};

const docs = await db.table('category').xselect(config);
```

## Replacing a record graph

`table.replace(data)` makes the database match a given object graph: it upserts
the row and reconciles its nested collections, deleting related rows that are no
longer present. It's a declarative alternative to issuing individual
[mutations](./mutations.md).

```js
await db.table('user').replace({
  id: 3,
  orders: [
    { id: 1, status: 100 },         // updated
    { code: 'order-3', status: 300 }, // upserted
  ],
  // any other orders belonging to user 3 are removed
});
```

Nested collections can themselves carry children (e.g. each order's
`orderItems`), and the same reconcile-and-prune applies at every level.

## Surrogate keys

When importing/exporting data keyed by natural (non-`id`) values, sqlex can encode
and decode surrogate keys. The helpers `decodeSurrogateKey`,
`getDefaultSurrogateKeyFields` and `surrogateKeyToFields` (and the `keys` argument
to `xappend`/`xselect`) support this; see `tests/loader2.test.ts` for worked
examples.

## Serialising object graphs

`selectTree` collects a row and everything reachable from it into a set of related
records, which a serialiser can render. `JsonSerialiser` produces nested JSON and
`XstreamSerialiser` produces XStream-style XML:

```js
import { selectTree, XstreamSerialiser } from 'sqlex';

const result = await selectTree(db.table('order'), { id: 1 });
const xml = new XstreamSerialiser(result).serialise(db.table('order').model, []);
```
