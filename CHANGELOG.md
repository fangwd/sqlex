# Changelog

All notable changes to this project are documented in this file.

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
