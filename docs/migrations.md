# Migrations

Migrations are ordered, checksum-protected TypeScript files containing
structured operations. sqlex keeps applied state in `_sqlex_migrations`.
The checksum covers the migration id, forward and rollback operations, and
schema snapshot. Applied migrations must remain unchanged.

## Configuration

Create `sqlex.config.mts`:

```ts
import { join } from 'node:path';
import { User, Post } from './models.ts';

export default {
  connection: {
    dialect: 'postgres',
    connection: process.env.DATABASE_URL!,
  },
  models: { User, Post },
  migrationDirectory: join(import.meta.dirname, 'migrations'),
};
```

Node 24.12 or newer loads this erasable TypeScript directly. `.mts` keeps the
module format unambiguous in both ESM and CommonJS projects; use `.cts` with
`module.exports` for a CommonJS config. Use `import type` for type-only imports
and avoid enums or parameter properties in config and migration files.

## Commands

```sh
sqlex migration make add-users
sqlex migration sql
sqlex migration up
sqlex migration status
sqlex migration baseline
sqlex migration down
sqlex migration down 2
sqlex migration reconcile --dry-run
```

All commands accept `--config <file>`. `up` and `sql` accept
`--target <migration-id>`, while `up`, `down`, and `reconcile` accept
`--dry-run`. `reconcile` also accepts `--destructive`.

| Command | Purpose |
| --- | --- |
| `make <name>` | Diff record declarations against the latest schema snapshot |
| `sql` | Print forward SQL without consulting the migration ledger |
| `up` | Apply pending migrations |
| `down [count]` | Revert the latest applied migrations |
| `status` | Show pending, applied, and checksum-invalid migrations |
| `baseline` | Adopt an existing matching database without running DDL |
| `reconcile` | Apply the DDL that brings the database up to the declared models, bypassing the ledger |

Use `baseline` when adopting migrations for an existing database. It verifies
that declared tables, column types and dimensions, nullability, defaults,
generated values, constraints, and referential actions match the latest schema
snapshot. It then records the migrations without executing their DDL.
`baseline --force` skips this structural check.

`make` compares the current model declarations with the schema snapshot in the
latest migration. It generates new tables, columns, constraints, and indexes,
and `alterColumn` operations for columns whose definition changed. Removals
and other destructive differences are warnings and must be written explicitly.
`alterColumn` cannot turn an existing PostgreSQL column into a generated
(`serial`) one; write that migration explicitly.

Adding a required column without a default also requires an explicit migration:
add it as nullable, backfill existing rows, and then apply the desired
constraint using operations appropriate for the database. When new tables
reference each other in a cycle, the foreign key closing the cycle is left out
of its `createTable` and added with `addConstraint` once every table exists,
which SQLite cannot do in place. Inserting rows into such a cycle still needs one
of the foreign keys to be nullable: a flush writes that row without it first and
fills the key in once the row it points at exists.

## Reconciling without migrations

`MigrationRunner.reconcile` compares the record declarations with the live
database and applies the additive DDL needed to match them, without touching
the migration ledger. It suits development databases and tests; production
schemas should keep using migrations.

```ts
const runner = new MigrationRunner(db);
const sql = await runner.reconcile({ User, Post });
const planned = await runner.reconcile({ User, Post }, { dryRun: true });
const synced = await runner.reconcile({ User, Post }, { destructive: true });
```

`sqlex migration reconcile` does the same from the `models` and `connection`
in `sqlex.config.mts` and prints the SQL it ran, so an application can expose
it as a package script:

```json
{ "scripts": { "db:sync": "sqlex migration reconcile" } }
```

Reconciling creates missing tables (with their constraints, checks, and
indexes), adds missing columns that are nullable or have a default, and adds
missing constraints and indexes to existing tables. Indexes are matched by
name. The returned array holds the executed SQL; it is empty when the database
already matches.

By default anything else is reported in one error before any DDL runs: a
required column without a default, a column whose type, nullability,
generation, dimensions, default, or enum values differ from the declaration,
and a column or constraint in a declared table that the declaration does not
mention. With `destructive: true`, changed columns are altered in place and
undeclared columns and constraints are dropped; existing data may be cast,
truncated, or lost, so preview with `dryRun` first. A renamed field is a drop
plus an add, not a rename.

Not compared: index definitions (only names), comments, check constraints on
existing tables, and enum values stored as text with a check. Tables the
declarations do not mention are never touched. Dialect limits apply as for
migrations: SQLite cannot alter columns or add or drop constraints in place, or
add columns with non-constant defaults; PostgreSQL cannot make an existing
column generated, which is reported rather than attempted; MySQL commits DDL
implicitly, so a statement failing mid-run leaves the earlier ones applied.

## Manual migrations

Use operation helpers when a generated migration needs adjustment:

```ts
import { defineMigration, operation } from 'sqlex';

export default defineMigration({
  id: '0003_normalize_email',
  up: [
    operation.sql('update app_user set email=lower(email)'),
  ],
  down: [
    operation.sql('select 1'),
  ],
});
```

Available operations cover tables, columns, constraints, indexes, renames, and
raw SQL. Raw SQL always requires an explicit down operation.

| Helper | Structured operation |
| --- | --- |
| `operation.createTable(table)` | Create a table and its inline constraints |
| `operation.dropTable(name)` | Drop a table |
| `operation.addColumn(table, column)` | Add a column |
| `operation.alterColumn(table, column, from?)` | Change a column's type, nullability, or default; `from` enables rollback |
| `operation.dropColumn(table, column)` | Drop a column |
| `operation.renameColumn(table, from, to)` | Rename a column |
| `operation.addConstraint(table, constraint)` | Add a constraint |
| `operation.dropConstraint(table, constraint)` | Drop a named constraint |
| `operation.createIndex(table, index)` | Create an index |
| `operation.dropIndex(table, index)` | Drop an index |
| `operation.sql(statementOrStatements)` | Execute explicit SQL |

## Dialect behavior

| Capability | PostgreSQL | MySQL | SQLite |
| --- | --- | --- | --- |
| Transactional migration DDL | Yes | Limited by implicit DDL commits | Yes |
| Migration lock | Advisory lock | Named lock | Database transaction |
| Add/drop table or column | Yes | Yes | Yes, subject to SQLite version |
| Alter column in place | Yes | Yes | No; rebuild the table |
| Add/drop constraints in place | Yes | Yes | No; rebuild the table |
| Raw SQL defaults on added columns | Yes | Yes | Non-constant defaults require a rebuild |
| Mutually cyclic new tables | Yes | Yes | No; explicit migration |
| Baseline verification | Yes | Yes | Yes |

PostgreSQL and SQLite run each migration transactionally. MySQL may implicitly
commit DDL, so the ledger is only written after all statements succeed but a
failed migration can still require manual cleanup. SQLite cannot add or drop
constraints in place; use an explicit table-rebuild migration for those changes.
