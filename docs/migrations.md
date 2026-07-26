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
```

All commands accept `--config <file>`. `up` and `sql` accept
`--target <migration-id>`, while `up` and `down` accept `--dry-run`.

| Command | Purpose |
| --- | --- |
| `make <name>` | Diff record declarations against the latest schema snapshot |
| `sql` | Print forward SQL without consulting the migration ledger |
| `up` | Apply pending migrations |
| `down [count]` | Revert the latest applied migrations |
| `status` | Show pending, applied, and checksum-invalid migrations |
| `baseline` | Adopt an existing matching database without running DDL |

Use `baseline` when adopting migrations for an existing database. It verifies
that declared tables, column types and dimensions, nullability, defaults,
generated values, constraints, and referential actions match the latest schema
snapshot. It then records the migrations without executing their DDL.
`baseline --force` skips this structural check.

`make` compares the current model declarations with the schema snapshot in the
latest migration. It generates new tables, columns, constraints, and indexes.
Column changes, removals, and other destructive differences are warnings and
must be written explicitly.

Adding a required column without a default also requires an explicit migration:
add it as nullable, backfill existing rows, and then apply the desired
constraint using operations appropriate for the database. Mutually cyclic new
tables cannot be generated portably; create their tables and foreign-key
constraints in an explicit dialect-aware migration.

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
| Add/drop constraints in place | Yes | Yes | No; rebuild the table |
| Raw SQL defaults on added columns | Yes | Yes | Non-constant defaults require a rebuild |
| Mutually cyclic new tables | Explicit migration | Explicit migration | Explicit migration |
| Baseline verification | Yes | Yes | Yes |

PostgreSQL and SQLite run each migration transactionally. MySQL may implicitly
commit DDL, so the ledger is only written after all statements succeed but a
failed migration can still require manual cleanup. SQLite cannot add or drop
constraints in place; use an explicit table-rebuild migration for those changes.
