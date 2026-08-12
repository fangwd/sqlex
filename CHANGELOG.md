# Changelog

All notable changes to this project are documented in this file.

## [4.5.0]

### Removed

- Removed the unused Java schema exporter and `XstreamSerialiser`.

### Added

- Added `sqlex/api`, a framework-free REST API and OpenAPI 3.1 generator driven
  by one configuration. It supports explicit resource exposure, filtering,
  sorting, includes, cursor pagination, aggregates, and opt-in `POST`, `PATCH`
  and `DELETE` operations. `sqlex openapi` writes the same document to stdout
  or `--out`.
- Added request authorization and row-level `scope` policies, including nested
  reads, scoped foreign-key validation, and server-side `assign` values for
  multi-tenant writes. `beforeWrite` and `afterRead` hooks support value rules,
  transformations, and redaction. See [REST API](./docs/api.md) and
  [Multi-tenancy](./docs/multi-tenancy.md).
- Added table and column comments to record definitions, migrations, and
  introspection where supported. Comments now document generated OpenAPI
  schemas; record-defined models can supply the schema without database
  comments.
- Added configurable OpenAPI authentication metadata and compile-time schema
  name validation.
- Table write methods accept an optional connection, allowing them to join a
  caller-owned `db.transaction`.

### Fixed

- Hidden cursor sort keys no longer leak through `meta.next`; pagination falls
  back to offset when a safe cursor cannot be produced.
- Scalar foreign-key filters now work when the same relation is expanded.
- Decimal precision and scale are preserved in derived field schemas.
- Malformed URL encoding returns `404` for resource paths and `400` for identity
  values instead of surfacing as a server error.

## [4.2.3]

### Added

- Added `db.transaction(callback)`, which commits on success, rolls back on
  failure, and always releases its pooled connection.
- Added PostgreSQL `timestamptz` support for `field.datetime({ timezone: true })`
  and binary JSON (`jsonb`) for `field.json({ binary: true })`.

### Changed

- **Breaking:** Date, datetime, and timestamp columns now read as `Date`
  objects; SQL `time` columns read as strings.
- **Breaking:** Removed `printSchemaTypeScript`; use `printSchemaTypeMap`.
- Record-defined schemas now represent nullability explicitly, removing
  spurious `null` and optional markers from generated types.

### Fixed

- Fixed pooled-connection leaks on failed queries and transaction-like writes.
- Fixed `table.claim()` retry rejection, `db.clone()` configuration loss, and
  `deepCopy` corruption of dates, buffers, typed arrays, `undefined`, and cycles.
- Fixed schema optional markers and composite-key foreign-key lookups.

## [4.2.2]

### Fixed

- Fixed relation selection on composite-primary-key tables and key-column
  detection when a foreign key is part of the key.

## [4.2.0]

### Added

- Added composite primary keys and table-level `unique`, `indexes`, and
  `checks` constraints, including supported partial indexes.

### Fixed

- Reverse relations now use the referenced foreign-key field correctly, and
  MySQL rejects partial indexes instead of silently dropping their predicates.

## [4.0.0]

### Added

- Added typed `Record` models, per-database managers, immutable and awaitable
  query sets, relation managers, hydration, dirty persistence, identity
  mapping, and declarative field metadata.
- Added structured PostgreSQL, MySQL, and SQLite migrations with checksums,
  status, dry runs, rollback, baselining, advisory locks, and schema
  generation. Added the `sqlex migration make|sql|up|down|status|baseline`
  commands.
- Added typed reverse relations, `field.id()`, plain foreign-key values in
  writes, bulk query-set updates/deletes, `exists()`, `Manager.getOrCreate()`,
  and Node.js 24.12 / TypeScript 7 build support.

### Fixed

- Fixed record transaction cleanup, unsafe query-set mutations, foreign-key
  write-once checks, concurrent `getOrCreate()`, PostgreSQL float DDL, and
  migration targeting, locking, checksums, baselining, and dry-run validation.
- Fixed record proxy/getter state, relation loading, persistence failures, and
  generated migrations for unsafe required columns or cyclic tables.

### Changed

- Record persistence internals now live in a hidden `WeakMap`; `toJSON()` is
  part of the public record surface.
- Removed the legacy schema and maintenance CLI. Bound models are managers,
  persisted records may reassign foreign keys, and `Database.bind()` rejects
  duplicate binding.

## [3.6.2]

### Fixed

- PostgreSQL `query()` now returns rows for raw `INSERT ... RETURNING`; inserts
  without `RETURNING` still return an empty array.

## [3.5.0]

### Added

- Added nested JSON/JSONB path filtering, explicit `$` operators, configurable
  operator syntax, and consistent `encodeFilter` options across query paths.

### Fixed

- Fixed MySQL pool dialect detection and row duplication when JSON columns hold
  arrays or objects.

## [3.4.0]

### Added

- Added typed table APIs and the `printSchemaTypeMap` generator, including
  row/create/update/filter types and reusable foreign-key references.
- Added `{ returning }` mutation results, JSON/JSONB serialization and typing,
  and full TypeScript `strict`-mode support.

### Fixed

- Fixed MySQL self-referential cascade deletes, PostgreSQL `ilike`, JSON scalar
  escaping, and record serialization of JSON values.
