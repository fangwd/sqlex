# Hierarchical data (trees)

sqlex has built-in support for tree-structured data backed by a **closure table**
— a table that stores every ancestor/descendant pair so subtree queries stay
fast regardless of depth.

## Configuring a closure table

Declare the closure table for a model in the schema config (see
[Connecting & schema](./connecting.md#schema-config)). The model has a
self-referential `parent` foreign key; the closure table records the transitive
relationships:

```js
import { Schema, Database } from 'sqlex';

const config = {
  models: [
    { table: 'category', closureTable: { name: 'category_tree' } },
  ],
};

const schema = new Schema(schemaJson, config);
const db = new Database({ dialect, connection }, schema);
```

sqlex keeps the closure table in sync as you insert, re-parent and delete nodes.

## Building a tree

Create nodes like any other row, linking each to its parent with `connect` (or
`parent: null` for a root):

```js
const root = await db.table('category').create({ name: 'All', parent: null });
const fruit = await db.table('category').create({ name: 'Fruit', parent: { connect: { id: root.id } } });
const apple = await db.table('category').create({ name: 'Apple', parent: { connect: { id: fruit.id } } });
await db.table('category').create({ name: 'Fuji', parent: { connect: { id: apple.id } } });
await db.table('category').create({ name: 'Gala', parent: { connect: { id: apple.id } } });
```

## Querying ancestors and descendants

Pass a primary key (or a row) to walk the tree:

```js
const descendants = await db.table('category').getDescendants(root.id); // All, Fruit, Apple, Fuji, Gala
const ancestors = await db.table('category').getAncestors(apple.id);    // Apple, Fruit, All
```

Both accept an optional filter to narrow the result:

```js
await db.table('category').getDescendants(root.id, { name_like: 'F%' });
```

`selectTree` returns a node with its descendant relations resolved recursively —
see [Querying](./querying.md#selecting-a-tree).

## Moving a subtree

Re-parent a node by changing its `parent` with `modify`; sqlex moves the whole
subtree and updates the closure table accordingly:

```js
const node = await db.table('category').get({ name: 'Apple' });
const newParent = await db.table('category').get({ name: 'All' });

await db.table('category').modify({ parent: { connect: newParent } }, node);
```

Deleting a node removes its subtree as well.

## Cloning a subtree

A record's `copy` method deep-clones it together with its child rows, applying
any field overrides you pass. Combined with `getModels()` you can clone the tree
(or any record graph) rooted at a given node:

```js
const order = db.getModels().Order({ id: 1 });
const clone = await order.copy({ code: 'order-1-copy' });
// the clone has fresh order_item rows copied from the original
```
