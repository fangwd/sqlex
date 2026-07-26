# Upgrading to v4

sqlex 4 is a major release that adds the typed ORM and migration system while
removing legacy interfaces. It intentionally does not preserve compatibility
with deprecated internals.

## Runtime and tooling

- Node.js 24.12 or newer is required.
- TypeScript config and migration files may use Node's erasable TypeScript
  support through `.mts` or `.cts`.
- Install the driver for the selected database: `pg`, `mysql2`, or `sqlite3`.

## CLI changes

The legacy schema export and maintenance CLI has been removed. The `sqlex`
command now exposes migration commands:

```sh
sqlex migration make <name>
sqlex migration sql
sqlex migration up
sqlex migration down [count]
sqlex migration status
sqlex migration baseline
```

The same runner is available through the `sqlex-migrate` executable.

## Typed records

New applications can define record classes with `defineRecord` and `field`,
then bind them to a database:

```ts
class User extends defineRecord({
  table: 'app_user',
  fields: {
    id: field.id(),
    email: field.string({ maxLength: 254, unique: true }),
  },
}) {}

const models = db.bind({ User });
const user = await models.User.get({ email: 'alice@example.com' });
```

Bound models are managers. Use `models.User.filter(...)` directly;
`models.User.objects` remains an alias.

Record persistence internals are no longer public properties. Replace access to
names such as `__data`, `__state`, or `__table` with public fields and methods:

- Read and assign declared record fields directly.
- Use `save`, `update`, `delete`, and `refresh` for persistence.
- Use `toJSON()` for a plain object representation.

## Adopting migrations

For an existing database:

1. Define record classes that match the current schema.
2. Configure `sqlex.config.mts`.
3. Run `sqlex migration make initial`.
4. Review the generated SQL with `sqlex migration sql`.
5. Run `sqlex migration baseline`.

`baseline` verifies table, column, default, generated-value, and constraint
semantics before recording the migration without executing its DDL. Use
`--force` only after independently verifying the database.

Migration checksums cover ids, forward operations, rollback operations, and
schema snapshots. Never edit an applied migration; add a new migration instead.

## Schema-generation limits

Generated migrations are additive. Removed or changed columns and constraints
produce warnings and require explicit operations. Required columns without a
default need a backfill migration. Mutually cyclic new tables require a manual,
dialect-aware migration.

SQLite cannot add or remove constraints in place. Such changes require an
explicit table rebuild.

## Migration checklist

- Update Node.js and the database driver.
- Replace removed CLI commands.
- Stop accessing `Record` internals.
- Add and review an initial migration.
- Baseline existing production databases before applying later migrations.
- Run the test suite against every database used in production.

See the [ORM quickstart](./orm-quickstart.md), [ORM guide](./orm.md), and
[migration guide](./migrations.md) for the complete v4 APIs.
