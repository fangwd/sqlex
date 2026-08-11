# Changelog

All notable changes to this project are documented in this file.

## [4.5.0]

### Removed

- The Java schema exporter (`exportSchemaJava`, `shouldSkip`) and
  `XstreamSerialiser`. Neither had documentation or a runtime caller — the Java
  exporter wrote POJOs well outside sqlex's scope, and the XStream serialiser
  only appeared in a doc example. `printSchema`, `printSchemaTypeMap` and
  `JsonSerialiser` are unchanged, as is `getTypeName`, which the mock generator
  uses.


### Added

- `sqlex/api` puts a read-only REST API and an OpenAPI 3.1 document over an
  existing database, both generated from one declared policy so they cannot
  disagree. `createApi(db, config)` returns `handle(request, context)`, which is
  a plain `Request` to `Response` function with no framework and no new
  dependencies, alongside `openapi()` and the compiled `plan`.
- Nothing is exposed unless the configuration names it, and `filter`, `sort` and
  `include` grant nothing by default, so exposing a column does not silently
  make it a query dimension. A configuration that cannot mean what it says —
  an unknown model or column, a relation whose target is not exposed, a filter
  colliding with a reserved parameter — is rejected when it is compiled rather
  than when a request arrives.
- `scope` returns a filter ANDed into every read of a resource, including rows
  reached through `include`. It is combined rather than merged, so a request
  filter containing `or` cannot widen past it.
- `sqlex openapi` writes the document to stdout or `--out`, reading the `api`
  key of the same `sqlex.config.*` file the migration commands use.
- Writes: `POST` on a collection creates, `PATCH` on an item changes the columns
  named, `DELETE` removes it. Each is opted into through `operations`, and
  `write` says which columns a client may set, independently of `read`. A
  relation is set by its key value: an object would be a nested mutation, which
  sqlex would carry out, so it is refused before reaching it. Statuses are
  `201`/`200`/`204`, with `409` for a duplicate, `422` for a refused reference,
  `415` for a body that is not JSON, and `400` listing every rejected column.
- A write and the check that follows it share one transaction, so a change that
  would move a row outside its `scope` is refused and rolled back rather than
  quietly handing the row to someone else.
- The write methods on `Table` (`insert`, `create`, `update`, `upsert`,
  `modify`, `delete`, `get`) now take an optional `connection`, so they can join
  a transaction the caller opened with `db.transaction` instead of taking a
  connection of their own.
- Cursor pagination: a full page's `meta.next` is an opaque cursor naming the
  next one, immune to concurrent inserts and cheaper than a deep offset. The
  listing follows the sort plus the primary key as a tiebreaker, so duplicate
  sort values cannot lose or repeat rows across a page boundary; a cursor is
  tied to the sort it was minted under and cannot be combined with `offset`.
- Aggregates: `GET /{path}/aggregate` counts, groups and applies `sum`, `avg`,
  `min` and `max` over the rows the resource's filters and scope admit, once the
  `aggregate` operation is exposed and its columns are named.
- See [REST API](./docs/api.md) and `examples/rest-api`.

- Table and column comments. `defineRecord` and every field factory accept
  `comment`; migrations store them on MySQL (inline) and PostgreSQL
  (`comment on` statements), and introspection reads them back there. SQLite
  has no comment storage, so nothing is emitted or reflected for it. The
  generated OpenAPI document uses comments as its documentation — a table
  comment describes the resource's schema and tag, a column comment its
  property in row schemas and request bodies — and a resource's `description`
  overrides its table comment. With record definitions the comments work on
  every engine, since the database never needs to store them; `sqlex openapi`
  now derives the schema from the config's `models` when present, for the same
  reason.

- An `include` can no longer reach around an `authorize` gate: embedding a
  resource requires its read authorization to pass too, checked at every depth
  before the query runs, so a relation cannot expose rows the resource refuses
  directly. Row-level access through the include is still the target's scope.
- Malformed percent-encoding in the path is a `404` for a resource segment and
  a `400` for an identity value, rather than an uncaught `URIError` surfacing
  as a `500`.
- A client-supplied foreign key must reference a row the target resource's
  scope admits for the request, checked inside the write's transaction; a
  cross-tenant reference is refused with the same 422 a dangling one gets, so
  it confirms nothing. `assign`-stamped values and unscoped or unexposed
  targets are exempt.
- The OpenAPI document can declare authentication: `securitySchemes` (and
  optionally `security`) reach the document, and every operation gains a 401.
  Component schema names are validated at compile time, so a model named
  `Problem`, or one colliding with a generated `<Model>Create` body, is
  rejected instead of silently overwriting part of the document.
- Two hooks close the gap below operations and rows. `beforeWrite(context,
  { operation, data, row })` holds value-level rules — a customer may only
  cancel an open order — running after validation and `assign`, and for update
  and delete inside the write's transaction with the current row in hand;
  throwing an `ApiError` refuses with that status, returning a document
  replaces the data, and the event separates `body` (what the client sent)
  from `data` (the final write with `assign` applied). `afterRead(context, row)` transforms rows as they are
  served — per-role redaction, derived values — over the serialised shape, and
  follows the resource's rows into embedded relations and write responses.
- `authorize(context, operation)` gates operations per request — an admin may
  change products but not close the shop — answering `403` before anything is
  parsed or read, and documented as such in the OpenAPI output. The scope
  contract is pinned down for roles: `{}` is unrestricted (the super-user
  case), an empty array admits nothing (a grant lookup that found no tenants
  fails closed), and `assign` may stamp different columns per role or none.
- Multi-tenancy is now airtight and ergonomic. A resource's `scope` follows
  its rows wherever they are reached: an embedded collection is filtered by its
  own resource's scope inside the nested query, and an expanded foreign key
  whose target's scope does not admit the row is reduced back to the bare
  `{id}` reference, at any include depth. `assign` is the write-side
  counterpart: server-set values applied after validation and on top of every
  create and update body, so a tenant column comes from the authenticated
  context rather than the client — and the compiler accepts a required column
  being withheld from clients when `assign` is there to supply it. See
  [Multi-tenancy](./docs/multi-tenancy.md) and `examples/multi-tenant`.

### Fixed

- A keyset cursor encodes the value of every column it orders by, so a sort
  column excluded from `read` leaked that value through the otherwise-opaque
  `meta.next`. Such a sort now yields no cursor and pagination falls back to
  `offset`; sorting by a hidden column is still allowed, only the cursor is
  withheld. The tiebreaker key is held to the same rule. (`filter`, `sort` and
  `aggregate` remain deliberately independent of `read` for columns you name
  explicitly; only the automatic cursor is guarded.)

- A filter addressing a foreign key by a scalar (`{ user: 1 }`) crashed — or,
  worse, silently mis-resolved the joined columns — when the same select also
  expanded that key with nested fields. The scalar is now lifted to the object
  form it abbreviates before the expansion's joins are recorded.
- `field.decimal({ precision, scale })` now carries both into the schema it
  derives, alongside the `maxLength`, `dimensions` and enum metadata that were
  already there. Only the migration compiler read them before, re-deriving them
  from the field options, so an introspected schema described a decimal column
  and a record-defined one did not — leaving anything reading a column back
  unable to tell the declared scale. Generated DDL and migration checksums are
  unchanged.

## [4.2.3]

### Added

- `db.transaction(callback)` runs the callback on a pooled connection inside a
  transaction, committing when it resolves and rolling back when it rejects.
  The connection is released either way. Pass it to the query builders that
  take one (`table.select(fields, options, undefined, connection)`) to keep
  several statements on the same transaction.

### Changed

- **Breaking.** `date`, `datetime`, and `timestamp` columns are read back as
  `Date` objects rather than ISO 8601 strings, matching the types that
  `field.date` and `field.datetime` already declared. `JSON.stringify` still
  produces an ISO string, but code comparing a column to a string, or relying
  on `toJSON()` returning one, needs updating. SQL `time` columns are read back
  as strings, which previously threw a `RangeError`.
- **Breaking.** `printSchemaTypeScript` is gone. It generated classes against a
  decorator API that no longer exists, so its output has not compiled since
  v4.0.0. Use `printSchemaTypeMap`, which emits the typed `Database` table map.
- Record definitions now state column nullability explicitly instead of leaving
  it absent, so generated types distinguish a field that omitted `nullable`
  (NOT NULL, the record default) from a genuinely nullable column. Row types for
  record-defined schemas lose spurious `| null`, and `Create` types lose the
  matching spurious `?`.

- Table and column comments. `defineRecord` and every field factory accept
  `comment`; migrations store them on MySQL (inline) and PostgreSQL
  (`comment on` statements), and introspection reads them back there. SQLite
  has no comment storage, so nothing is emitted or reflected for it. The
  generated OpenAPI document uses comments as its documentation — a table
  comment describes the resource's schema and tag, a column comment its
  property in row schemas and request bodies — and a resource's `description`
  overrides its table comment. With record definitions the comments work on
  every engine, since the database never needs to store them; `sqlex openapi`
  now derives the schema from the config's `models` when present, for the same
  reason.

- An `include` can no longer reach around an `authorize` gate: embedding a
  resource requires its read authorization to pass too, checked at every depth
  before the query runs, so a relation cannot expose rows the resource refuses
  directly. Row-level access through the include is still the target's scope.
- Malformed percent-encoding in the path is a `404` for a resource segment and
  a `400` for an identity value, rather than an uncaught `URIError` surfacing
  as a `500`.
- A client-supplied foreign key must reference a row the target resource's
  scope admits for the request, checked inside the write's transaction; a
  cross-tenant reference is refused with the same 422 a dangling one gets, so
  it confirms nothing. `assign`-stamped values and unscoped or unexposed
  targets are exempt.
- The OpenAPI document can declare authentication: `securitySchemes` (and
  optionally `security`) reach the document, and every operation gains a 401.
  Component schema names are validated at compile time, so a model named
  `Problem`, or one colliding with a generated `<Model>Create` body, is
  rejected instead of silently overwriting part of the document.
- Two hooks close the gap below operations and rows. `beforeWrite(context,
  { operation, data, row })` holds value-level rules — a customer may only
  cancel an open order — running after validation and `assign`, and for update
  and delete inside the write's transaction with the current row in hand;
  throwing an `ApiError` refuses with that status, returning a document
  replaces the data, and the event separates `body` (what the client sent)
  from `data` (the final write with `assign` applied). `afterRead(context, row)` transforms rows as they are
  served — per-role redaction, derived values — over the serialised shape, and
  follows the resource's rows into embedded relations and write responses.
- `authorize(context, operation)` gates operations per request — an admin may
  change products but not close the shop — answering `403` before anything is
  parsed or read, and documented as such in the OpenAPI output. The scope
  contract is pinned down for roles: `{}` is unrestricted (the super-user
  case), an empty array admits nothing (a grant lookup that found no tenants
  fails closed), and `assign` may stamp different columns per role or none.
- Multi-tenancy is now airtight and ergonomic. A resource's `scope` follows
  its rows wherever they are reached: an embedded collection is filtered by its
  own resource's scope inside the nested query, and an expanded foreign key
  whose target's scope does not admit the row is reduced back to the bare
  `{id}` reference, at any include depth. `assign` is the write-side
  counterpart: server-set values applied after validation and on top of every
  create and update body, so a tenant column comes from the authenticated
  context rather than the client — and the compiler accepts a required column
  being withheld from clients when `assign` is there to supply it. See
  [Multi-tenancy](./docs/multi-tenancy.md) and `examples/multi-tenant`.

### Fixed

- `printSchema` had its optional marker inverted, marking NOT NULL fields `?`
  and leaving nullable ones required.
- A failing query leaked its pooled connection in `db.flush`, `db.select`,
  `table.count`, `table.replace`, `table.getAncestors`, and
  `table.getDescendants`. Each now releases in a `finally`.
- `table.claim()` never settled once it exhausted its retries — it threw inside
  a `then` callback, which rejected an inner promise nobody awaited. It now
  rejects with the last error, and its return type admits the `null` it has
  always returned when nothing matches.
- `db.clone()` dropped the custom operator map and JSON filter options, so the
  clones made internally by `copyRecord` and flush's map tables silently lost
  that configuration.
- `deepCopy`/`clone` round-tripped through JSON, which turned `Date` values into
  strings, corrupted `Buffer` and typed-array values, dropped `undefined`
  properties, and threw on cyclic input.
- The Java export compared primary keys with `==` and hashed a `getId()` accessor
  that does not exist unless the key is named `id`.

## [4.2.2]

### Added

- `field.datetime({ timezone: true })` compiles to `timestamptz` on PostgreSQL,
  which keeps the offset and compares correctly across session time zones.
  MySQL and SQLite have a single timestamp type, so only PostgreSQL changes.
  Note that migration baselining normalises every `timestamp*` column to one
  type, so it does not report a plain/offset-aware mismatch.
- `field.json({ binary: true })` stores in the engine's binary JSON type:
  `jsonb` on PostgreSQL, which is indexable, supports the containment and path
  operators, and is what `jsonb_typeof` requires. MySQL's `json` is already
  binary and SQLite keeps `text`, so only the PostgreSQL column type changes.

- Table and column comments. `defineRecord` and every field factory accept
  `comment`; migrations store them on MySQL (inline) and PostgreSQL
  (`comment on` statements), and introspection reads them back there. SQLite
  has no comment storage, so nothing is emitted or reflected for it. The
  generated OpenAPI document uses comments as its documentation — a table
  comment describes the resource's schema and tag, a column comment its
  property in row schemas and request bodies — and a resource's `description`
  overrides its table comment. With record definitions the comments work on
  every engine, since the database never needs to store them; `sqlex openapi`
  now derives the schema from the config's `models` when present, for the same
  reason.

- An `include` can no longer reach around an `authorize` gate: embedding a
  resource requires its read authorization to pass too, checked at every depth
  before the query runs, so a relation cannot expose rows the resource refuses
  directly. Row-level access through the include is still the target's scope.
- Malformed percent-encoding in the path is a `404` for a resource segment and
  a `400` for an identity value, rather than an uncaught `URIError` surfacing
  as a `500`.
- A client-supplied foreign key must reference a row the target resource's
  scope admits for the request, checked inside the write's transaction; a
  cross-tenant reference is refused with the same 422 a dangling one gets, so
  it confirms nothing. `assign`-stamped values and unscoped or unexposed
  targets are exempt.
- The OpenAPI document can declare authentication: `securitySchemes` (and
  optionally `security`) reach the document, and every operation gains a 401.
  Component schema names are validated at compile time, so a model named
  `Problem`, or one colliding with a generated `<Model>Create` body, is
  rejected instead of silently overwriting part of the document.
- Two hooks close the gap below operations and rows. `beforeWrite(context,
  { operation, data, row })` holds value-level rules — a customer may only
  cancel an open order — running after validation and `assign`, and for update
  and delete inside the write's transaction with the current row in hand;
  throwing an `ApiError` refuses with that status, returning a document
  replaces the data, and the event separates `body` (what the client sent)
  from `data` (the final write with `assign` applied). `afterRead(context, row)` transforms rows as they are
  served — per-role redaction, derived values — over the serialised shape, and
  follows the resource's rows into embedded relations and write responses.
- `authorize(context, operation)` gates operations per request — an admin may
  change products but not close the shop — answering `403` before anything is
  parsed or read, and documented as such in the OpenAPI output. The scope
  contract is pinned down for roles: `{}` is unrestricted (the super-user
  case), an empty array admits nothing (a grant lookup that found no tenants
  fails closed), and `assign` may stamp different columns per role or none.
- Multi-tenancy is now airtight and ergonomic. A resource's `scope` follows
  its rows wherever they are reached: an embedded collection is filtered by its
  own resource's scope inside the nested query, and an expanded foreign key
  whose target's scope does not admit the row is reduced back to the bare
  `{id}` reference, at any include depth. `assign` is the write-side
  counterpart: server-set values applied after validation and on top of every
  create and update body, so a tenant column comes from the authenticated
  context rather than the client — and the compiler accepts a required column
  being withheld from clients when `assign` is there to supply it. See
  [Multi-tenancy](./docs/multi-tenancy.md) and `examples/multi-tenant`.

### Fixed

- Selecting a foreign key on a table with a composite primary key threw. The
  table's own key is only needed to group reverse (to-many) relations, so it is
  now resolved lazily, and a to-many relation that genuinely needs a single key
  reports that instead of failing on a null assertion.
- `QuerySet.exists()` probed the primary key's *field* name, which differs from
  its column when the first key part is a foreign key (`scene` vs `scene_id`) —
  as it is on a composite-key link table. It now probes by column.

## [4.2.0]

### Added

- Composite primary keys in the ORM: several fields may be marked `primaryKey`
  and are keyed as one constraint. A generated field cannot take part, and a
  record with a composite key cannot be a foreign-key target.
- Table-level `unique`, `indexes`, and `checks` on a record definition, for
  composite unique keys, multi-column indexes, partial indexes (`where`, on
  PostgreSQL and SQLite), and named check constraints.

- Table and column comments. `defineRecord` and every field factory accept
  `comment`; migrations store them on MySQL (inline) and PostgreSQL
  (`comment on` statements), and introspection reads them back there. SQLite
  has no comment storage, so nothing is emitted or reflected for it. The
  generated OpenAPI document uses comments as its documentation — a table
  comment describes the resource's schema and tag, a column comment its
  property in row schemas and request bodies — and a resource's `description`
  overrides its table comment. With record definitions the comments work on
  every engine, since the database never needs to store them; `sqlex openapi`
  now derives the schema from the config's `models` when present, for the same
  reason.

- An `include` can no longer reach around an `authorize` gate: embedding a
  resource requires its read authorization to pass too, checked at every depth
  before the query runs, so a relation cannot expose rows the resource refuses
  directly. Row-level access through the include is still the target's scope.
- Malformed percent-encoding in the path is a `404` for a resource segment and
  a `400` for an identity value, rather than an uncaught `URIError` surfacing
  as a `500`.
- A client-supplied foreign key must reference a row the target resource's
  scope admits for the request, checked inside the write's transaction; a
  cross-tenant reference is refused with the same 422 a dangling one gets, so
  it confirms nothing. `assign`-stamped values and unscoped or unexposed
  targets are exempt.
- The OpenAPI document can declare authentication: `securitySchemes` (and
  optionally `security`) reach the document, and every operation gains a 401.
  Component schema names are validated at compile time, so a model named
  `Problem`, or one colliding with a generated `<Model>Create` body, is
  rejected instead of silently overwriting part of the document.
- Two hooks close the gap below operations and rows. `beforeWrite(context,
  { operation, data, row })` holds value-level rules — a customer may only
  cancel an open order — running after validation and `assign`, and for update
  and delete inside the write's transaction with the current row in hand;
  throwing an `ApiError` refuses with that status, returning a document
  replaces the data, and the event separates `body` (what the client sent)
  from `data` (the final write with `assign` applied). `afterRead(context, row)` transforms rows as they are
  served — per-role redaction, derived values — over the serialised shape, and
  follows the resource's rows into embedded relations and write responses.
- `authorize(context, operation)` gates operations per request — an admin may
  change products but not close the shop — answering `403` before anything is
  parsed or read, and documented as such in the OpenAPI output. The scope
  contract is pinned down for roles: `{}` is unrestricted (the super-user
  case), an empty array admits nothing (a grant lookup that found no tenants
  fails closed), and `assign` may stamp different columns per role or none.
- Multi-tenancy is now airtight and ergonomic. A resource's `scope` follows
  its rows wherever they are reached: an embedded collection is filtered by its
  own resource's scope inside the nested query, and an expanded foreign key
  whose target's scope does not admit the row is reduced back to the bare
  `{id}` reference, at any include depth. `assign` is the write-side
  counterpart: server-set values applied after validation and on top of every
  create and update body, so a tenant column comes from the authenticated
  context rather than the client — and the compiler accepts a required column
  being withheld from clients when `assign` is there to supply it. See
  [Multi-tenancy](./docs/multi-tenancy.md) and `examples/multi-tenant`.

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

- Table and column comments. `defineRecord` and every field factory accept
  `comment`; migrations store them on MySQL (inline) and PostgreSQL
  (`comment on` statements), and introspection reads them back there. SQLite
  has no comment storage, so nothing is emitted or reflected for it. The
  generated OpenAPI document uses comments as its documentation — a table
  comment describes the resource's schema and tag, a column comment its
  property in row schemas and request bodies — and a resource's `description`
  overrides its table comment. With record definitions the comments work on
  every engine, since the database never needs to store them; `sqlex openapi`
  now derives the schema from the config's `models` when present, for the same
  reason.

- An `include` can no longer reach around an `authorize` gate: embedding a
  resource requires its read authorization to pass too, checked at every depth
  before the query runs, so a relation cannot expose rows the resource refuses
  directly. Row-level access through the include is still the target's scope.
- Malformed percent-encoding in the path is a `404` for a resource segment and
  a `400` for an identity value, rather than an uncaught `URIError` surfacing
  as a `500`.
- A client-supplied foreign key must reference a row the target resource's
  scope admits for the request, checked inside the write's transaction; a
  cross-tenant reference is refused with the same 422 a dangling one gets, so
  it confirms nothing. `assign`-stamped values and unscoped or unexposed
  targets are exempt.
- The OpenAPI document can declare authentication: `securitySchemes` (and
  optionally `security`) reach the document, and every operation gains a 401.
  Component schema names are validated at compile time, so a model named
  `Problem`, or one colliding with a generated `<Model>Create` body, is
  rejected instead of silently overwriting part of the document.
- Two hooks close the gap below operations and rows. `beforeWrite(context,
  { operation, data, row })` holds value-level rules — a customer may only
  cancel an open order — running after validation and `assign`, and for update
  and delete inside the write's transaction with the current row in hand;
  throwing an `ApiError` refuses with that status, returning a document
  replaces the data, and the event separates `body` (what the client sent)
  from `data` (the final write with `assign` applied). `afterRead(context, row)` transforms rows as they are
  served — per-role redaction, derived values — over the serialised shape, and
  follows the resource's rows into embedded relations and write responses.
- `authorize(context, operation)` gates operations per request — an admin may
  change products but not close the shop — answering `403` before anything is
  parsed or read, and documented as such in the OpenAPI output. The scope
  contract is pinned down for roles: `{}` is unrestricted (the super-user
  case), an empty array admits nothing (a grant lookup that found no tenants
  fails closed), and `assign` may stamp different columns per role or none.
- Multi-tenancy is now airtight and ergonomic. A resource's `scope` follows
  its rows wherever they are reached: an embedded collection is filtered by its
  own resource's scope inside the nested query, and an expanded foreign key
  whose target's scope does not admit the row is reduced back to the bare
  `{id}` reference, at any include depth. `assign` is the write-side
  counterpart: server-set values applied after validation and on top of every
  create and update body, so a tenant column comes from the authenticated
  context rather than the client — and the compiler accepts a required column
  being withheld from clients when `assign` is there to supply it. See
  [Multi-tenancy](./docs/multi-tenancy.md) and `examples/multi-tenant`.

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

- Table and column comments. `defineRecord` and every field factory accept
  `comment`; migrations store them on MySQL (inline) and PostgreSQL
  (`comment on` statements), and introspection reads them back there. SQLite
  has no comment storage, so nothing is emitted or reflected for it. The
  generated OpenAPI document uses comments as its documentation — a table
  comment describes the resource's schema and tag, a column comment its
  property in row schemas and request bodies — and a resource's `description`
  overrides its table comment. With record definitions the comments work on
  every engine, since the database never needs to store them; `sqlex openapi`
  now derives the schema from the config's `models` when present, for the same
  reason.

- An `include` can no longer reach around an `authorize` gate: embedding a
  resource requires its read authorization to pass too, checked at every depth
  before the query runs, so a relation cannot expose rows the resource refuses
  directly. Row-level access through the include is still the target's scope.
- Malformed percent-encoding in the path is a `404` for a resource segment and
  a `400` for an identity value, rather than an uncaught `URIError` surfacing
  as a `500`.
- A client-supplied foreign key must reference a row the target resource's
  scope admits for the request, checked inside the write's transaction; a
  cross-tenant reference is refused with the same 422 a dangling one gets, so
  it confirms nothing. `assign`-stamped values and unscoped or unexposed
  targets are exempt.
- The OpenAPI document can declare authentication: `securitySchemes` (and
  optionally `security`) reach the document, and every operation gains a 401.
  Component schema names are validated at compile time, so a model named
  `Problem`, or one colliding with a generated `<Model>Create` body, is
  rejected instead of silently overwriting part of the document.
- Two hooks close the gap below operations and rows. `beforeWrite(context,
  { operation, data, row })` holds value-level rules — a customer may only
  cancel an open order — running after validation and `assign`, and for update
  and delete inside the write's transaction with the current row in hand;
  throwing an `ApiError` refuses with that status, returning a document
  replaces the data, and the event separates `body` (what the client sent)
  from `data` (the final write with `assign` applied). `afterRead(context, row)` transforms rows as they are
  served — per-role redaction, derived values — over the serialised shape, and
  follows the resource's rows into embedded relations and write responses.
- `authorize(context, operation)` gates operations per request — an admin may
  change products but not close the shop — answering `403` before anything is
  parsed or read, and documented as such in the OpenAPI output. The scope
  contract is pinned down for roles: `{}` is unrestricted (the super-user
  case), an empty array admits nothing (a grant lookup that found no tenants
  fails closed), and `assign` may stamp different columns per role or none.
- Multi-tenancy is now airtight and ergonomic. A resource's `scope` follows
  its rows wherever they are reached: an embedded collection is filtered by its
  own resource's scope inside the nested query, and an expanded foreign key
  whose target's scope does not admit the row is reduced back to the bare
  `{id}` reference, at any include depth. `assign` is the write-side
  counterpart: server-set values applied after validation and on top of every
  create and update body, so a tenant column comes from the authenticated
  context rather than the client — and the compiler accepts a required column
  being withheld from clients when `assign` is there to supply it. See
  [Multi-tenancy](./docs/multi-tenancy.md) and `examples/multi-tenant`.

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

- Table and column comments. `defineRecord` and every field factory accept
  `comment`; migrations store them on MySQL (inline) and PostgreSQL
  (`comment on` statements), and introspection reads them back there. SQLite
  has no comment storage, so nothing is emitted or reflected for it. The
  generated OpenAPI document uses comments as its documentation — a table
  comment describes the resource's schema and tag, a column comment its
  property in row schemas and request bodies — and a resource's `description`
  overrides its table comment. With record definitions the comments work on
  every engine, since the database never needs to store them; `sqlex openapi`
  now derives the schema from the config's `models` when present, for the same
  reason.

- An `include` can no longer reach around an `authorize` gate: embedding a
  resource requires its read authorization to pass too, checked at every depth
  before the query runs, so a relation cannot expose rows the resource refuses
  directly. Row-level access through the include is still the target's scope.
- Malformed percent-encoding in the path is a `404` for a resource segment and
  a `400` for an identity value, rather than an uncaught `URIError` surfacing
  as a `500`.
- A client-supplied foreign key must reference a row the target resource's
  scope admits for the request, checked inside the write's transaction; a
  cross-tenant reference is refused with the same 422 a dangling one gets, so
  it confirms nothing. `assign`-stamped values and unscoped or unexposed
  targets are exempt.
- The OpenAPI document can declare authentication: `securitySchemes` (and
  optionally `security`) reach the document, and every operation gains a 401.
  Component schema names are validated at compile time, so a model named
  `Problem`, or one colliding with a generated `<Model>Create` body, is
  rejected instead of silently overwriting part of the document.
- Two hooks close the gap below operations and rows. `beforeWrite(context,
  { operation, data, row })` holds value-level rules — a customer may only
  cancel an open order — running after validation and `assign`, and for update
  and delete inside the write's transaction with the current row in hand;
  throwing an `ApiError` refuses with that status, returning a document
  replaces the data, and the event separates `body` (what the client sent)
  from `data` (the final write with `assign` applied). `afterRead(context, row)` transforms rows as they are
  served — per-role redaction, derived values — over the serialised shape, and
  follows the resource's rows into embedded relations and write responses.
- `authorize(context, operation)` gates operations per request — an admin may
  change products but not close the shop — answering `403` before anything is
  parsed or read, and documented as such in the OpenAPI output. The scope
  contract is pinned down for roles: `{}` is unrestricted (the super-user
  case), an empty array admits nothing (a grant lookup that found no tenants
  fails closed), and `assign` may stamp different columns per role or none.
- Multi-tenancy is now airtight and ergonomic. A resource's `scope` follows
  its rows wherever they are reached: an embedded collection is filtered by its
  own resource's scope inside the nested query, and an expanded foreign key
  whose target's scope does not admit the row is reduced back to the bare
  `{id}` reference, at any include depth. `assign` is the write-side
  counterpart: server-set values applied after validation and on top of every
  create and update body, so a tenant column comes from the authenticated
  context rather than the client — and the compiler accepts a required column
  being withheld from clients when `assign` is there to supply it. See
  [Multi-tenancy](./docs/multi-tenancy.md) and `examples/multi-tenant`.

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

- Table and column comments. `defineRecord` and every field factory accept
  `comment`; migrations store them on MySQL (inline) and PostgreSQL
  (`comment on` statements), and introspection reads them back there. SQLite
  has no comment storage, so nothing is emitted or reflected for it. The
  generated OpenAPI document uses comments as its documentation — a table
  comment describes the resource's schema and tag, a column comment its
  property in row schemas and request bodies — and a resource's `description`
  overrides its table comment. With record definitions the comments work on
  every engine, since the database never needs to store them; `sqlex openapi`
  now derives the schema from the config's `models` when present, for the same
  reason.

- An `include` can no longer reach around an `authorize` gate: embedding a
  resource requires its read authorization to pass too, checked at every depth
  before the query runs, so a relation cannot expose rows the resource refuses
  directly. Row-level access through the include is still the target's scope.
- Malformed percent-encoding in the path is a `404` for a resource segment and
  a `400` for an identity value, rather than an uncaught `URIError` surfacing
  as a `500`.
- A client-supplied foreign key must reference a row the target resource's
  scope admits for the request, checked inside the write's transaction; a
  cross-tenant reference is refused with the same 422 a dangling one gets, so
  it confirms nothing. `assign`-stamped values and unscoped or unexposed
  targets are exempt.
- The OpenAPI document can declare authentication: `securitySchemes` (and
  optionally `security`) reach the document, and every operation gains a 401.
  Component schema names are validated at compile time, so a model named
  `Problem`, or one colliding with a generated `<Model>Create` body, is
  rejected instead of silently overwriting part of the document.
- Two hooks close the gap below operations and rows. `beforeWrite(context,
  { operation, data, row })` holds value-level rules — a customer may only
  cancel an open order — running after validation and `assign`, and for update
  and delete inside the write's transaction with the current row in hand;
  throwing an `ApiError` refuses with that status, returning a document
  replaces the data, and the event separates `body` (what the client sent)
  from `data` (the final write with `assign` applied). `afterRead(context, row)` transforms rows as they are
  served — per-role redaction, derived values — over the serialised shape, and
  follows the resource's rows into embedded relations and write responses.
- `authorize(context, operation)` gates operations per request — an admin may
  change products but not close the shop — answering `403` before anything is
  parsed or read, and documented as such in the OpenAPI output. The scope
  contract is pinned down for roles: `{}` is unrestricted (the super-user
  case), an empty array admits nothing (a grant lookup that found no tenants
  fails closed), and `assign` may stamp different columns per role or none.
- Multi-tenancy is now airtight and ergonomic. A resource's `scope` follows
  its rows wherever they are reached: an embedded collection is filtered by its
  own resource's scope inside the nested query, and an expanded foreign key
  whose target's scope does not admit the row is reduced back to the bare
  `{id}` reference, at any include depth. `assign` is the write-side
  counterpart: server-set values applied after validation and on top of every
  create and update body, so a tenant column comes from the authenticated
  context rather than the client — and the compiler accepts a required column
  being withheld from clients when `assign` is there to supply it. See
  [Multi-tenancy](./docs/multi-tenancy.md) and `examples/multi-tenant`.

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
