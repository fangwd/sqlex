# Command line interface

sqlex ships a small CLI at `node_modules/sqlex/bin/sqlex.js`. It connects to a
database (or reads a schema file) and can dump the schema, generate code/types,
extract data, and run a few maintenance tasks.

## Connecting

The database name is positional; connection flags configure the driver:

| Flag                | Description                                    |
| ------------------- | ---------------------------------------------- |
| `--dialect`         | `mysql` (default), `postgres`, `sqlite3`, `generic` |
| `-h`, `--host`      | host (default `localhost`)                     |
| `-P`, `--port`      | port (default 3306, or 5432 for postgres)      |
| `-u`, `--user`      | user (default `root`)                          |
| `-p`, `--password`  | password (or set `DATABASE_PASSWORD`)          |
| `--driver`          | module for the `generic` dialect               |
| `--schemaFile`      | read schema from a JSON file instead of introspecting |
| `--config`          | schema config JSON to apply during introspection |

## Dumping the schema

With no action flag, the CLI prints the introspected schema as JSON:

```sh
node_modules/sqlex/bin/sqlex.js --dialect postgres -u user -p secret mydb
```

## Code & type generation

Combine `--export` with a format:

```sh
# TypeScript table map (see docs/typescript.md)
sqlex ... --export --typeMap mydb > sqlex-schema.ts

# TypeScript interfaces
sqlex ... --export --typescript mydb > schema.ts

# Java classes
sqlex ... --export --java --path ./src/main/java --package com.example.model mydb

# Schema JSON
sqlex ... --export mydb > schema.json
```

## Extracting data

`--select <table>:<key>` selects a record tree by primary key. By default it
prints JSON; `--xstream` / `--xml` render XStream-style XML (with optional
`--types`):

```sh
sqlex ... --select order:1 mydb
sqlex ... --select order:1 --xstream --types OrderItem,Product mydb
```

## Inspecting references

`--references <model>` lists the fields that reference a model:

```sh
sqlex ... --references product mydb
```

## Maintenance

- `--rename <model> <NewName> --config <file>` — record a model rename in a config file
- `--fixForeignKeys <rule>` — re-create foreign keys with a given `on delete` rule (MySQL)
- `--fixNextVal <n>` — reset PostgreSQL sequences (`<= 0` uses `max(id)`)
- `--zap [--exclude a,b]` — empty tables (excluding the listed ones)

> ⚠️ The maintenance commands modify your database. Run them against the right
> environment and with care.
