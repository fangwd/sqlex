# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- `field.json({ binary: true })` stores in the engine's binary JSON type:
  `jsonb` on PostgreSQL, which is indexable, supports the containment and path
  operators, and is what `jsonb_typeof` requires. MySQL's `json` is already
  binary and SQLite keeps `text`, so only the PostgreSQL column type changes.

## [4.2.0]

### Added

- Composite primary keys in the ORM: several fields may be marked `primaryKey`
  and are keyed as one constraint. A generated field cannot take part, and a
  record with a composite key cannot be a foreign-key target.
- Table-level `unique`, `indexes`, and `checks` on a record definition, for
  composite unique keys, multi-column indexes, partial indexes (`where`, on
  PostgreSQL and SQLite), and named check constraints.

### Fixed

- Reverse relation loading keyed rows by the referencing model's own primary
  key, which returned nothing when the child had a composite primary key and
  was wrong whenever the parent's key was not named `id`. It now uses the field
  the foreign key references.
- Compiling a partial index for MySQL raises an error instead of emitting an
  index without its predicate.

## [4.0.0]

### Added

- Typed `Record` definitions, per-database managers, immutable query sets,
  relation managers, hydration, dirty persistence, and identity mapping.
- Declarative field metadata shared by the ORM and migration generator.
- Structured PostgreSQL, MySQL, and SQLite migrations with checksums, status,
  dry runs, rollback, baseline adoption, advisory locks, and additive schema
  generation.
- `sqlex migration make|sql|up|down|status|baseline` commands.
- `field.id()` shorthand for auto-incrementing integer primary keys.
- Foreign keys accept plain primary key values in `create`/`build`/`update`.
- Query sets are awaitable and async-iterable, and support `exists()` and bulk
  `update()`/`delete()`.
- `Manager.getOrCreate()`.
- Typed reverse relations via `RecordSet<T>` declarations.
- Records print their data in `console.log`/`util.inspect`.
- Node.js 24.12 and TypeScript 7 build support.

### Fixed

- `Record.save()` now commits or rolls back once and always releases its
  connection.
- Query-set `update()`/`delete()` throw when `limit`, `offset`, or `orderBy`
  is set instead of silently mutating every matching row.
- The write-once guard for unsaved foreign keys now compares the referenced
  key values; previously record-to-record reassignment slipped through.
- `getOrCreate()` no longer overwrites a concurrently created row with its
  defaults; the losing caller adopts the existing row and reports
  `created: false`.
- `field.float` compiles to `double precision` on PostgreSQL (previously the
  invalid type `double`).
- `migration up --target` with an unknown id now throws instead of silently
  applying nothing; `sqlex migration down` rejects non-numeric counts.
- `up --dry-run` and `down --dry-run` now consult the migration ledger, so
  the preview matches what a real run would execute.
- `migration make` and `baseline` use the latest migration that carries a
  schema snapshot, so a trailing manual migration no longer breaks generation
  or verification.
- `baseline` verification no longer false-fails on enum, decimal, and uuid
  columns whose storage type differs per dialect.
- The MySQL migration lock now fails loudly on `get_lock` timeout instead of
  proceeding without a lock.
- Adding a column with a raw-SQL default on SQLite fails at compile time with
  guidance to use a table rebuild, instead of failing mid-migration.
- The foreign-key write-once guard no longer rejects loader null placeholders
  or `Table.append` merges that re-express a parent by key; it now compares
  referenced key values and flags distinct unsaved record instances.
- Reading a declared field on a record subclass with a class-field initializer
  now returns the model data instead of the initializer value.
- Relation loads on records without unique field values throw instead of
  silently returning another row's children.
- Persistence setup failures and misclassified insert errors (e.g. a lock
  timeout) during flush now reject instead of hanging the save.
- Removed duplicate record proxy wrapping and fixed record getters and
  disconnection dirty-state handling.
- Migration checksums now cover rollback operations and schema snapshots, and
  are enforced by real and dry-run rollbacks.
- Generated migrations warn instead of adding required columns without a
  default, and reject mutually cyclic new tables with explicit guidance.
- Dry runs only ignore a genuinely absent migration ledger; other database
  errors are propagated.
- Baseline verification now checks nullability, generated columns, defaults,
  varchar/decimal dimensions, and foreign-key update/delete actions.
- Migration commands reject duplicate ids, invalid rollback counts, and ledgers
  whose applied migration files are missing.

### Changed

- Moved all `Record` persistence internals into a hidden `WeakMap` runtime.
  Record instances now expose only declared fields and public methods, including
  the conventional `toJSON()`.
- Removed the legacy schema and maintenance CLI. `sqlex` and `sqlex-migrate`
  now provide migration commands only.
- Bound models are managers: `models.User.filter(...)` works directly, with
  `.objects` kept as an alias and `.record` exposing the record class.
- Persisted records may reassign foreign keys; unsaved records remain
  write-once graph nodes.
- `Database.bind()` throws when called twice on the same instance; enum
  `default` values are checked against the declared `values`.

## [3.6.2]

### Fixed

- **PostgreSQL: `query()` now returns rows for raw `INSERT ... RETURNING`.**
  Previously a raw `db.query('insert ... returning id')` resolved to `undefined`
  (rows were discarded unless the insert went through `table.insert()`, which
  passes the primary key internally). The Postgres engine now returns
  `result.rows` for a pk-less INSERT, so `const [row] = await db.query('insert
  ... returning id', ...)` works; an INSERT with no `returning` clause yields an
  empty array. `table.insert()` is unchanged — it still returns the new id
  scalar.

## [3.5.0]

### Added

- **JSON field filtering.** `where` now filters into `json`/`jsonb` columns using
  the same operator suffixes as regular fields. Pass a nested object on the
  column (`{ config: { name: 'Joe', age_gt: 18, 'address.city': 'NYC' } }`);
  descend with nested objects or dotted-key shorthand. Supported operators
  include comparisons, `_in`/`_notIn`, `_like`/`_ilike`, `_null` (JSON null or
  absent) and `_contains` (containment at the path). Works on PostgreSQL, MySQL
  and SQLite. See README/`docs/filtering.md` "JSON fields". Previously an object
  value on a JSON column produced broken SQL; it now means path filtering.
- **Explicit `$` operators and configurable syntax.** Operators can be written
  as `{ age: { $gt: 18, $lt: 65 } }`, which is unambiguous and reaches keys that
  collide with operator words (e.g. `{ opt_in: { $eq: 'x' } }`). The behaviour is
  configurable via a fourth `Database` argument:
  `new Database(conn, schema, operatorMap, { operatorSyntax, operatorDelimiter })`
  (defaults `'both'` / `'_'`). The `JsonFilterOptions` and `JsonOperatorSyntax`
  types are exported from the package root.
- **`encodeFilter` options.** `encodeFilter` accepts optional `operatorMap` and
  `jsonFilterOptions` arguments, so the configured options are honoured
  consistently across every `where`-filter path (`select`, `count`, `update`,
  `delete`, and the internal flush/tree queries), not just `select`.

### Fixed

- **MySQL connection pool missing `dialect`.** The MySQL pool never set its
  `dialect` (cf. the Postgres `ilike` fix in 3.4.0), so a pooled query saw an
  `undefined` dialect. Harmless until JSON extraction required the real value;
  now set to `'mysql'`.
- **`xselect`/`mapDocument` row duplication on JSON columns.** `flatten` expanded
  every object/array value, so a `json`/`jsonb` column holding an array
  multiplied result rows. It now expands only the relation paths declared by the
  select config, leaving JSON column values intact.

## [3.4.0]

### Added

- **Typed table API.** `Database<TTables>` and `Table<TSpec>` now carry per-table
  types, so `db.table('order')` returns a typed table and `create`/`update`/
  `upsert`/`modify`/`select`/`get`/`first` are checked against the table's row,
  create, update and filter shapes.
- **Schema type-map generator.** `printSchemaTypeMap` (CLI: `sqlex --typeMap`)
  emits a TypeScript `SqlexTables` map (plus `*Row`/`*Create`/`*Update`/`*Filter`
  interfaces) to drive the typed API. See README "TypeScript table maps".
  Foreign-key references reuse the exported `Identifiable<T = number>` type for
  the common single-`id` primary key (a model-specific `*Ref` is generated only
  for non-`id` keys).
- **`returning` mutation option.** `create`, `upsert` and `modify` accept
  `{ returning }` to fetch and return selected columns/relations after the write
  (e.g. `returning: { user: '*' }`).
- **JSON column support.** `json`/`jsonb` columns are serialised on write and
  parsed on read, mock data generates JSON values, and the type map exposes them
  as `JsonValue`.
- **`strict: true`.** The codebase now compiles under TypeScript `strict` mode
  (`noImplicitAny`, `strictNullChecks`, et al.), so the published typings and
  public API surface are precise and null-aware.

### Fixed

- **MySQL 9 self-referential cascade delete.** `flush({ replaceRecordsIn })` on a
  self-referencing table (e.g. `comment.parent_id`) no longer relies on the
  database's `ON DELETE CASCADE`, which MySQL 9 caps (error 6575, "Foreign key
  cascade delete/update exceeds max tables limit"). Such rows are now deleted
  leaf-first.
- **PostgreSQL `ilike`.** The Postgres connection pool was missing its `dialect`,
  causing `*_ilike` filters to be downgraded to case-sensitive `like`. `ilike` is
  now correctly case-insensitive on Postgres.
- **JSON values for scalars.** `escapeValue` no longer emits a bare SQL `true`/
  `false` (or unquoted number) for a boolean/number stored in a `json`/`jsonb`
  column; non-null values are JSON-encoded (a `null` value remains SQL `NULL`).
- **Record serialisation with JSON values.** `Record.__json`/`__dump` no longer
  mistake a JSON array/object column value for a related collection.
