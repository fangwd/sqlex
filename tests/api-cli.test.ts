import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Database, MigrationRunner, defineRecord, field, makeMigration } from '../src';

const run = promisify(execFile);
const CLI = join(__dirname, '..', 'bin', 'sqlex.js');
const BUILT = join(__dirname, '..', 'dist', 'api', 'index.js');

class Widget extends defineRecord({
  table: 'widget',
  fields: {
    id: field.id(),
    name: field.string({ maxLength: 40, unique: true }),
    price: field.float({ nullable: true }),
  },
}) {}

// The CLI runs against dist, so it can only be exercised after a build.
const describeCli = existsSync(BUILT) ? describe : describe.skip;

describeCli('sqlex openapi', () => {
  let directory: string;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'sqlex-openapi-'));
    const database = join(directory, 'cli.db');
    const db = new Database({ dialect: 'sqlite3', connection: { database } });
    const { migration } = makeMigration('0001_widgets', { Widget });
    await new MigrationRunner(db).up([migration]);
    await db.end();

    writeFileSync(
      join(directory, 'sqlex.config.mjs'),
      `export default {
        connection: { dialect: 'sqlite3', connection: { database: ${JSON.stringify(database)} } },
        api: {
          basePath: '/api',
          resources: {
            Widget: {
              read: { exclude: ['price'] },
              filter: { fields: ['name'] },
            },
          },
        },
        openapi: { title: 'Widgets', version: '2.0.0' },
      };\n`
    );
  });

  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  test('writes the document to stdout', async () => {
    const { stdout } = await run('node', [CLI, 'openapi'], { cwd: directory });
    const document = JSON.parse(stdout);
    expect(document.openapi).toBe('3.1.1');
    expect(document.info).toEqual({ title: 'Widgets', version: '2.0.0' });
    expect(Object.keys(document.paths)).toEqual(['/widgets', '/widgets/{id}']);
    expect(document.servers).toEqual([{ url: '/api' }]);
    // The policy reaches the document: price is excluded from reads.
    expect(stdout).not.toContain('price');
  });

  test('writes the document to a file', async () => {
    const out = join(directory, 'openapi.json');
    await run('node', [CLI, 'openapi', '--out', out], { cwd: directory });
    expect(JSON.parse(readFileSync(out).toString()).info.title).toBe('Widgets');
  });

  test('takes a config path', async () => {
    const { stdout } = await run(
      'node',
      [CLI, 'openapi', '--config', join(directory, 'sqlex.config.mjs')],
      { cwd: tmpdir() }
    );
    expect(JSON.parse(stdout).info.title).toBe('Widgets');
  });

  test('reports a configuration error and fails', async () => {
    writeFileSync(
      join(directory, 'broken.mjs'),
      `export default {
        connection: { dialect: 'sqlite3', connection: { database: ':memory:' } },
      };\n`
    );
    await expect(
      run('node', [CLI, 'openapi', '--config', join(directory, 'broken.mjs')], { cwd: directory })
    ).rejects.toThrow('must export an api configuration');
  });

  test('reports an invalid policy and fails', async () => {
    writeFileSync(
      join(directory, 'invalid.mjs'),
      `export default {
        connection: { dialect: 'sqlite3', connection: { database: ':memory:' } },
        api: { resources: { Nonexistent: {} } },
      };\n`
    );
    await expect(
      run('node', [CLI, 'openapi', '--config', join(directory, 'invalid.mjs')], { cwd: directory })
    ).rejects.toThrow('unknown model or table');
  });

  test('prints usage for an unknown command', async () => {
    await expect(run('node', [CLI, 'nonsense'], { cwd: directory })).rejects.toThrow(
      'sqlex openapi'
    );
  });
});
