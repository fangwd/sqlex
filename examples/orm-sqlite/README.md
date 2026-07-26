# SQLite ORM example

This is the runnable version of the
[ORM and migrations quickstart](../../docs/orm-quickstart.md).

From this directory:

```sh
npm install
npm run migration:make -- initial
npm run migration:sql
npm run migration:up
npm run typecheck
npm start
```

Generated migration files belong in source control. The local `app.db` file
does not.
