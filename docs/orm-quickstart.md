# ORM and migrations quickstart

This walkthrough creates a small typed application with SQLite. It uses record
declarations for both the ORM and migration generation, so no separate schema
file or code-generation step is required.

## 1. Create the project

sqlex requires Node.js 24.12 or newer.

```sh
mkdir sqlex-example
cd sqlex-example
npm init -y
npm install sqlex sqlite3
```

The example uses `.mts` files so Node can run erasable TypeScript directly.

## 2. Define records

Create `models.mts`:

```ts
import {
  defineRecord,
  field,
  type RecordSet,
} from 'sqlex';

export class User extends defineRecord({
  table: 'app_user',
  fields: {
    id: field.id(),
    email: field.string({ maxLength: 254, unique: true }),
    active: field.boolean({ default: true }),
  },
}) {
  declare posts: RecordSet<Post>;
}

export class Post extends defineRecord({
  table: 'post',
  fields: {
    id: field.id(),
    author: field.foreignKey(() => User, {
      relatedName: 'posts',
      onDelete: 'cascade',
    }),
    title: field.string({ maxLength: 200 }),
    published: field.boolean({ default: false }),
  },
}) {}
```

The inferred create type requires `email`, `author`, and `title`. Generated,
nullable, and defaulted fields are optional. Foreign keys accept either a record
instance or its primary-key value.

## 3. Configure migrations

Create `sqlex.config.mts`:

```ts
import { join } from 'node:path';
import { Post, User } from './models.mts';

export const connection = {
  dialect: 'sqlite3' as const,
  connection: { database: 'app.db' },
};

export default {
  connection,
  models: { User, Post },
  migrationDirectory: join(import.meta.dirname, 'migrations'),
};
```

Generate and inspect the initial migration:

```sh
npx sqlex migration make initial
npx sqlex migration sql
```

Migration files should be committed with the application. Apply them with:

```sh
npx sqlex migration up
npx sqlex migration status
```

## 4. Bind and use the models

Create `app.mts`:

```ts
import { Database } from 'sqlex';
import config, { connection } from './sqlex.config.mts';

const db = new Database(connection);
const models = db.bind(config.models);

const [user, created] = await models.User.getOrCreate({
  email: 'alice@example.com',
});

if (created) {
  await models.Post.create({
    author: user,
    title: 'Hello from sqlex',
  });
}

const posts = await user.posts.all();
const drafts = await models.Post
  .filter({ published: false })
  .orderBy('title');

console.log({ user, posts, drafts });
await db.end();
```

Run it directly:

```sh
node app.mts
```

## 5. Change the schema

Add a nullable or defaulted field to a record, then generate the next migration:

```sh
npx sqlex migration make add-post-summary
npx sqlex migration sql
npx sqlex migration up
```

Required columns without defaults need an explicit backfill migration so
existing rows remain valid. See [Migrations](./migrations.md) for manual
operations, rollback, baselining, and database-specific limitations.

## Next steps

- [ORM records](./orm.md) for fields, managers, query sets, and relations
- [Filtering](./filtering.md) for comparison, logical, and JSON-path operators
- [Migrations](./migrations.md) for the migration runner and operation helpers
- [Testing utilities](./testing.md) for isolated fixtures

A runnable copy of this walkthrough is available in
[`examples/orm-sqlite`](../examples/orm-sqlite).
