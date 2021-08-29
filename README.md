*sqlex* is a library to help retrieve, update, import and export data from a relational database easily. Apart from standard database relations like one-to-one, many-to-one and many-to-many, it also has built-in support for hierarchical data (trees) using closure tables, including cloning a tree rooted at a specific object.

Supported databases: MySQL, Postgres, SQLite

# Installation

`$ npm install sqlex`

# Usage

The easiest way to use sqlex is to create an instance of `Database` by passing in your database connection details:

```js
const Database = require('sqlex').Database;

const db = new Database({
  dialect: 'mysql',
  connection: {
    user: 'root',
    password: 'secret',
    database: 'example',
    timezone: 'Z',
    connectionLimit: 10
  }
});
```

After creating the database instance, you'll need to let sqlex retrieve the schema information about your database:

```js
await db.buildSchema();
```

Now the database instance is ready for use. Let's play with some data.

## Making queries

Select the 2nd 10 products ordered by their names:

```js
const db = helper.connectToDatabase(NAME);
const options = {
  where: {
    name_like: '%Apple'
  },
  orderBy: 'name',
  offset: 10,
  limit: 10
};
db.table('product').select('*', options);
```

This example selects all rows from the order table of your database along with the user details and items in that order:

```js
const rows = await db.table('order').select({
  user: '*',
  orderItems: {
    fields: {
      product: '*'
    }
  }
});
```

Views and aggregate functions are supported:

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
      {
        table: 'product',
        on: `oi.product_id = product.id`,
      },
      {
        table: 'service_log sl',
        on: `sl.product_code = product.sku`,
      },
    ],
  },
  groupBy: ['oi.order.user.email', 'product.name'],
  where: { 'product.name_like': '%Apple%' },
};
expect(typeof rows[0].userEmail).toBe('string');
expect(typeof rows[0].price).toBe('number');
```

## Updating

This example creates a new category and then renames its name:

```js
db.table('category')
  .insert({ name: 'Ice' })
  .then(id => {
    expect(id).toBeGreaterThan(0);
    db.table('category')
      .update({ name: 'Ice Cream' }, { name: 'Ice' })
      .then(() => {
        db.table('category')
          .select('*', { where: { id } })
          .then(rows => {
            expect(rows.length).toBe(1);
            expect(rows[0].name).toBe('Ice Cream');
            done();
          });
      });
  });
```

This example does an upsert to the order table:

```js
  table.upsert(
      {
        user: { connect: { email: 'alice@example.com' } },
        code: `test-order-${ID}`
      },
      {
        user: { create: { email: 'nobody@example.com' } },
        code: `test-order-${ID}2`
      }
    );
  }
```

This example creates a category and populates it with some products:

```js
const data = {
  name: 'Vegetable',
  parent: {
    connect: {
      id: 1
    }
  },
  categories: {
    create: [
      {
        name: 'Cucumber'
      },
      {
        name: 'Tomato'
      }
    ],
    connect: [
      { parent: { id: 2 }, name: 'Apple' },
      { parent: { id: 2 }, name: 'Banana' }
    ]
  }
};

await table.create(data);
```

This example creates a category tree:

```js
  const root = await table.create({
    name: 'All',
    parent: null
  });

  const fruit = await table.create({
    name: 'Fruit',
    parent: { connect: { id: root.id } }
  });

  const apple = await table.create({
    name: 'Apple',
    parent: { connect: { id: fruit.id } }
  });

  await table.create({
    name: 'Fuji',
    parent: { connect: { id: apple.id } }
  });

  await table.create({
    name: 'Gala',
    parent: { connect: { id: apple.id } }
  });
```

## Bulk loading/updating

You don't have to wait for an object to be persisted to the database before referencing it. Objects can even have cyclic references before they are persisted.

This example create a user and an order which reference each other (note the `user.status = order` line is for demo purposes only):

```js
const user = db.table('user').append();
user.email = 'random';
const order = db.table('order').append({ code: 'random' });
order.user = user;
user.status = order;

db.flush().then(async () => {
  const user = await db.table('user').get({ email: 'random' });
  const order = await db.table('order').get({ code: 'random' });
  expect(user.status).toBe(order.id);
  done();
});
```

## Creating testing records

sqlex provides an extremely way to create table records for testing purposes and to delete the records afterwards. Here is an example to create an order with 2 items:
```js
 const order = await table.table('order').mock({
      orderItems: [
        {
          product: {
            price: 0,
          },
          quantity: 100,
        },
        {
          quantity: 200,
        },
      ],
    });
// making tests...
await db.cleanup();
```

You only need to specify fields that you are goint to test against, and sqlex will automatically populate other fields that cannot be null. When you are done with the test records, `db.cleanup()` will delete them from the database so that they don't affect other tests.

## Importing and exporting

This example populates the category table with a list of objects. Properties other than `name`, `parent_name`, and `parent_parent` are saved to a table called `category_attribute` table using a key/value fashion:

```js
const table = db.table('category');

const config = {
  category: {
    name: 'name',
    parent_name: 'parent.name',
    parent_parent: 'parent.parent',
    '*': 'categoryAttributes[name, value]'
  }
};

const data = [
  {
    categoryName: 'Example B1',
    parent_name: 'Example B1 Parent',
    parent_parent: null,
    colour: 'Red',
    weight: '100kg'
  }
];

await table.load(data, config.category);
```

This example extracts data from a number of tables and returns a flat list of objects:

```js
const config = {
  name: 'name',
  parent_name: 'parent.name',
  product_name: 'products.name',
  product_price: 'products.price',
  '*': 'categoryAttributes[name, value]'
};

const docs = await db.table('category').xselect(config);
```

More examples can be found in the `test` folder.

## Command line interface

sqlex comes with a command line tool that does a few useful things.

To dump the database schema into a json file:

```
node_modules/sqlex/bin/sqlex.js --dialect postgres -u user1 -p secret1 mydb
```

# Development

## Testing

```
# Test for SQLite
$ DB_TYPE=sqlite3 npm run test

# Test for Postgres
$ DB_TYPE=postgres DB_USER=postgres npm run test

# Test for MySQL
$ DB_TYPE=mysql DB_USER=root DB_PASS=secret npm run test
```
