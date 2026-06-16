# Testing utilities

sqlex can fabricate throwaway records for tests — filling in every required
column automatically — and delete them all afterwards.

## Mocking records

`table.mock(data?)` inserts a row, generating values for any non-null column you
don't supply. You only specify the fields your test actually asserts on:

```js
const order = await db.table('order').mock();
order.id; // > 0

const dated = await db.table('order').mock({
  dateCreated: new Date('2020-01-01T00:00:00.000Z'),
});
typeof dated.code; // 'string' — auto-generated
```

### Nested relations

Mock related rows inline; required columns on those are generated too:

```js
const order = await db.table('order').mock({
  orderItems: [
    { product: { price: 0 }, quantity: 100 },
    { quantity: 200 }, // product auto-created
  ],
});

const items = await db
  .table('order_item')
  .select('*', { where: { order }, orderBy: ['quantity'] });
items.length; // 2
```

This works across many-to-one and many-to-many relations.

## Cleanup

`db.cleanup()` deletes every record created via `mock` (in dependency order), so
mocked data from one test doesn't leak into the next:

```js
afterEach(async () => {
  await db.cleanup();
});
```

## Customising generated strings

Generated string values use a prefix you can change with `setMockStringPrefix`,
which is handy for making test data recognisable or avoiding collisions:

```js
import { setMockStringPrefix } from 'sqlex';
setMockStringPrefix('test-');
```
