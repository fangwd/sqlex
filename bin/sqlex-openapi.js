#!/usr/bin/env node

const { writeFile } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { Database, schemaFromRecords } = require('../dist');
const { createApi } = require('../dist/api');

async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  const configPath = resolve(parsed.config || findConfig());
  const config = await loadDefault(configPath);

  if (!config.api) {
    throw Error(`${configPath} must export an api configuration`);
  }

  const db = config.database || new Database(config.connection);
  if (!db || !db.pool) {
    throw Error(`${configPath} must export database or connection`);
  }

  try {
    // Record definitions carry more than introspection can return everywhere
    // (comments and decimal scales on sqlite), so they win when present.
    if (!db.schema && config.models) db.useSchema(schemaFromRecords(config.models));
    if (!db.schema) await db.buildSchema(config.schema);
    const api = createApi(db, config.api);
    for (const warning of api.plan.warnings) {
      process.stderr.write(`warning: ${warning}\n`);
    }
    const document = JSON.stringify(api.openapi(config.openapi), null, 2);
    if (parsed.out) {
      await writeFile(resolve(parsed.out), `${document}\n`);
      process.stderr.write(`${resolve(parsed.out)}\n`);
    } else {
      process.stdout.write(`${document}\n`);
    }
  } finally {
    if (!config.database) await db.end();
  }
}

function parseArgs(argv) {
  const result = { argv: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--config') {
      result.config = argv[++index];
    } else if (arg === '--out') {
      result.out = argv[++index];
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

async function loadDefault(file) {
  const loaded = await import(pathToFileURL(resolve(file)).href);
  return loaded.default?.default || loaded.default || loaded;
}

module.exports = { main };
