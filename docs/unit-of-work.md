# Unit of work

Instead of persisting each row as you go, you can **append** records to the
database instance, wire up references between them — even cyclic ones — and then
**flush** everything in dependency order in a single unit of work. sqlex figures
out the correct insert/update ordering and fills in foreign keys for you.

For one-off writes, the per-row operations in [Mutations](./mutations.md) are
simpler; reach for this when you're building a graph of related records.

## Appending records

`append` adds an in-memory record to a table without touching the database yet.
You can pass data up front and/or set fields and relations afterwards:

```js
const user = db.table('user').append({ email: 'alice@example.com' });
user.status = 200;

const order = db.table('order').append();
order.code = 'order-1';
order.user = user; // assign the record directly as the foreign key
```

`db.append(name, data)` is shorthand for `db.table(name).append(data)`.

Appending data that matches an existing record by a unique key returns the same
in-memory record, so references stay consistent:

```js
const a = db.table('user').append({ email: 'alice@example.com' });
const b = db.table('user').append({ email: 'alice@example.com' });
a === b; // true
```

## Cyclic references

Records can reference each other before either is persisted. Here a user and an
order point at one another (the `user.status = order` line is only to demonstrate
a cycle):

```js
const user = db.table('user').append();
user.email = 'random';

const order = db.table('order').append({ code: 'random' });
order.user = user;
user.status = order;

await db.flush();

const u = await db.table('user').get({ email: 'random' });
const o = await db.table('order').get({ code: 'random' });
u.status === o.id; // true
```

## Flushing

`db.flush()` persists every dirty record across all tables, ordering inserts and
updates so foreign keys resolve, then back-fills generated keys onto the in-memory
records:

```js
await db.flush();
```

Use `db.getDirtyCount()` to see how many records are pending, and `db.clear()` to
drop the in-memory records without persisting them.

### Record helpers

Records returned by `append` (and by `db.getModels()`) also expose their own
write helpers, which flush just that record and its dependencies:

```js
const models = db.getModels();
const user = models.User({ email: 'saved@example.com' });
const row = await user.save();   // also: user.update({...}), user.delete()
```

## Replacing a set of records

When you re-import data, you often want the flushed records to **become** the
complete set for certain tables — deleting any pre-existing rows that aren't in
the new graph. Pass `replaceRecordsIn` with the table names to replace:

```js
// rebuild an order and its items from scratch
db.clear();
const order = db.table('order').append({ code: 'order-1', user });
for (const item of items) {
  db.table('order_item').append({ order, product: item.product, quantity: item.quantity });
}

await db.flush({ replaceRecordsIn: ['order', 'order_item'] });
```

For each listed table, rows that reference the same parents but are absent from
the newly appended set are deleted; the appended rows are inserted or updated.
This correctly handles self-referential tables (such as a `comment.parent_id`
hierarchy) by deleting obsolete rows leaf-first rather than relying on database
cascades.

## Flush hooks

`flush` accepts `afterBegin` and `beforeCommit` callbacks to run extra work inside
the same transaction:

```js
await db.flush({
  afterBegin: (connection) => connection.query('set ...'),
  beforeCommit: (connection) => connection.query('...'),
});
```
