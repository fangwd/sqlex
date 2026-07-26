# Contributing to sqlex

Contributions are welcome as focused bug fixes, tests, documentation
improvements, and well-scoped feature proposals.

## Prerequisites

- Node.js 24.12 or newer
- npm
- SQLite for the default test path
- PostgreSQL or MySQL when changing dialect-specific behavior

## Setup

```sh
git clone https://github.com/fangwd/sqlex.git
cd sqlex
npm install
npm run typecheck
npm run build
DB_TYPE=sqlite3 npm test
```

The SQLite suite is the fastest feedback loop. Run the applicable server suite
before submitting changes to SQL generation, schema introspection, migrations,
or connection handling:

```sh
DB_TYPE=postgres DB_HOST=127.0.0.1 DB_USER=postgres DB_PASS=secret npm test
DB_TYPE=mysql DB_HOST=127.0.0.1 DB_USER=root DB_PASS=secret npm test
```

The test helper creates and drops databases whose names begin with
`sqlex_test_`. Use a disposable local database server.

## Repository layout

- `src/orm.ts` defines record metadata, managers, and query sets.
- `src/record.ts` implements record behavior and private runtime state.
- `src/migration.ts` contains schema diffs, DDL compilation, and the runner.
- `src/engine/` contains database adapters and schema introspection.
- `src/database.ts` exposes the relation-aware Table API.
- `tests/` contains unit and cross-dialect integration tests.
- `docs/` contains user guides.

## Pull requests

- Keep changes scoped and preserve existing public behavior unless the change is
  explicitly intended for a major release.
- Add regression tests for bugs and behavior tests for new features.
- Add dialect-specific coverage when generated SQL or introspection changes.
- Update README, guides, types, and changelog entries when public behavior
  changes.
- Run `npm run typecheck`, `npm run build`, and the relevant test suites.
- Do not include generated `dist`, local database files, credentials, or
  dependency directories.

For substantial API changes, open an issue first with the use case, proposed
surface, dialect implications, and alternatives considered.

## Reporting issues

A useful bug report includes:

- sqlex, Node.js, TypeScript, and database versions
- dialect and driver
- a minimal schema or record declaration
- the smallest reproduction and complete error
- expected and actual behavior

Report security-sensitive issues privately as described in
[SECURITY.md](./SECURITY.md).
