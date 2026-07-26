#!/usr/bin/env node

const { mkdir, readdir, writeFile } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { resolve, extname, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  Database,
  MigrationRunner,
  makeMigration,
  printMigration,
} = require('../dist');

async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || 'status';
  const parsed = parseArgs(argv.slice(1));
  const configPath = resolve(parsed.config || findConfig());
  const config = await loadDefault(configPath);
  const directory = resolve(
    config.migrationDirectory || join(process.cwd(), 'migrations')
  );
  const migrations = await loadMigrations(directory);

  if (command === 'make') {
    const name = parsed.argv[0];
    if (!name) throw Error('Usage: sqlex migration make <name>');
    if (!config.models) {
      throw Error(`${configPath} must export a models object`);
    }
    const id = migrationId(name);
    // Manual migrations may not carry a schema snapshot; diff against the
    // latest one that does.
    const previous = [...migrations].reverse().find((item) => item.schema);
    const generated = makeMigration(id, config.models, previous);
    await mkdir(directory, { recursive: true });
    const file = join(directory, `${id}.mts`);
    if (existsSync(file)) throw Error(`Migration already exists: ${file}`);
    await writeFile(file, printMigration(generated.migration));
    process.stdout.write(`${file}\n`);
    for (const warning of generated.warnings) {
      process.stderr.write(`warning: ${warning}\n`);
    }
    return;
  }

  const db = config.database || new Database(config.connection);
  if (!db || !db.pool) {
    throw Error(`${configPath} must export database or connection`);
  }
  const runner = new MigrationRunner(db, config.migrationTable);
  try {
    if (command === 'up') {
      const result = await runner.up(migrations, {
        target: parsed.target,
        dryRun: parsed.dryRun,
      });
      printStatements(result.sql, parsed.dryRun);
      for (const id of result.applied) process.stdout.write(`applied ${id}\n`);
    } else if (command === 'down') {
      const count = Number(parsed.argv[0] || 1);
      if (!Number.isInteger(count) || count < 1) {
        throw Error(`Invalid count: ${parsed.argv[0]}`);
      }
      const result = await runner.down(migrations, count, {
        dryRun: parsed.dryRun,
      });
      printStatements(result.sql, parsed.dryRun);
      for (const id of result.applied) process.stdout.write(`reverted ${id}\n`);
    } else if (command === 'status') {
      const status = await runner.status(migrations);
      for (const item of status) {
        const marker = item.applied
          ? (item.valid ? '[x]' : '[!]')
          : '[ ]';
        process.stdout.write(`${marker} ${item.id}\n`);
      }
    } else if (command === 'baseline') {
      const result = await runner.baseline(migrations, {
        target: parsed.target,
        force: parsed.force,
      });
      for (const id of result.applied) process.stdout.write(`baselined ${id}\n`);
    } else if (command === 'sql') {
      printStatements(runner.plan(migrations, { target: parsed.target }), true);
    } else {
      throw Error(`Unknown migration command: ${command}`);
    }
  } finally {
    if (!config.database) await db.end();
  }
}

function parseArgs(argv) {
  const result = { argv: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--force') {
      result.force = true;
    } else if (arg === '--config') {
      result.config = argv[++index];
    } else if (arg === '--target') {
      result.target = argv[++index];
    } else {
      result.argv.push(arg);
    }
  }
  return result;
}

function findConfig() {
  for (const name of [
    'sqlex.config.mts',
    'sqlex.config.cts',
    'sqlex.config.ts',
    'sqlex.config.js',
    'sqlex.config.mjs',
    'sqlex.config.cjs',
  ]) {
    if (existsSync(name)) return name;
  }
  throw Error('No sqlex.config.mts, .cts, .ts, or .js found');
}

async function loadMigrations(directory) {
  if (!existsSync(directory)) return [];
  const files = (await readdir(directory))
    .filter(file => ['.ts', '.mts', '.js', '.mjs', '.cjs'].includes(extname(file)))
    .sort();
  const migrations = [];
  for (const file of files) {
    migrations.push(await loadDefault(join(directory, file)));
  }
  return migrations;
}

async function loadDefault(file) {
  const loaded = await import(pathToFileURL(resolve(file)).href);
  return loaded.default?.default || loaded.default || loaded;
}

function migrationId(name) {
  const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!safe) throw Error(`Invalid migration name: ${name}`);
  if (/^\d/.test(safe)) return safe;
  const now = new Date();
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('');
  return `${stamp}_${safe}`;
}

function printStatements(statements, enabled) {
  if (!enabled) return;
  for (const statement of statements) {
    process.stdout.write(`${statement};\n`);
  }
}

module.exports = { main };

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}
