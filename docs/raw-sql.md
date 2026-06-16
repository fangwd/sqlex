# Raw SQL

When the query builder isn't enough, run SQL directly with `db.query`. It
substitutes placeholders safely and returns the driver's rows.

## Positional parameters

Use `?` and pass values as trailing arguments, in order:

```js
const rows = await db.query(
  'select * from user where email = ? and status = ?',
  email,
  status,
);
```

## Named parameters

Use `:name` and pass a single object of values:

```js
await db.query(
  'select * from user where email = :email and status = :status',
  { email, status },
);
```

## Array values

A value may be an array, which expands for `in (...)` clauses — with either
placeholder style:

```js
await db.query('update user set status = 0 where id in (?)', [1, 2, 3]);

await db.query('update user set status = 0 where id in (:id)', { id: [1, 2, 3] });
```

## Return type

`db.query` returns whatever the underlying driver returns for the statement
(an array of rows for `select`, result metadata for writes). In TypeScript you can
annotate the expected shape:

```ts
const rows = await db.query<UserRow[]>('select * from "user" where id = ?', id);
```

## On a pooled connection

The same `query` method exists on a connection, so you can run raw SQL alongside
builder calls on a shared connection (for example within a transaction):

```js
const connection = await db.pool.getConnection();
try {
  await connection.query('update user set status = 0 where id = ?', id);
} finally {
  connection.release();
}
```
