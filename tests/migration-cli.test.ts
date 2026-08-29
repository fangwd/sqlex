import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CLI = join(__dirname, '..', 'bin', 'sqlex.js');
const BUILT = join(__dirname, '..', 'dist', 'index.js');

// The CLI runs against dist, so it can only be exercised after a build.
const describeCli = existsSync(BUILT) ? describe : describe.skip;

describeCli('sqlex migration reconcile', () => {
  let directory: string;

  const writeConfig = (fields: string) =>
    writeFileSync(
      join(directory, 'sqlex.config.mjs'),
      `import sqlex from ${JSON.stringify(BUILT)};
      const { defineRecord, field } = sqlex;
      class Widget extends defineRecord({
        table: 'widget',
        fields: { id: field.id(), ${fields} },
      }) {}
      export default {
        connection: {
          dialect: 'sqlite3',
          connection: { database: ${JSON.stringify(join(directory, 'cli.db'))} },
        },
        models: { Widget },
      };\n`
    );
  const reconcile = (...flags: string[]) =>
    run('node', [CLI, 'migration', 'reconcile', ...flags], { cwd: directory });

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'sqlex-reconcile-'));
  });
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  test('creates, extends, and destructively syncs the schema', async () => {
    writeConfig("name: field.string({ maxLength: 40 })");
    expect((await reconcile()).stdout).toContain('create table');
    expect((await reconcile()).stdout).toBe('');

    writeConfig(
      "name: field.string({ maxLength: 40 }), note: field.text({ nullable: true })"
    );
    const planned = (await reconcile('--dry-run')).stdout;
    expect(planned).toContain('add column');
    expect((await reconcile()).stdout).toBe(planned);

    writeConfig("name: field.string({ maxLength: 40 })");
    await expect(reconcile()).rejects.toThrow('widget.note is not declared');
    expect((await reconcile('--destructive')).stdout).toContain('drop column');
    expect((await reconcile()).stdout).toBe('');
  });

  test('requires models in the config', async () => {
    writeFileSync(
      join(directory, 'no-models.mjs'),
      `export default {
        connection: { dialect: 'sqlite3', connection: { database: ':memory:' } },
      };\n`
    );
    await expect(
      reconcile('--config', join(directory, 'no-models.mjs'))
    ).rejects.toThrow('must export a models object');
  });
});
