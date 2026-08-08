import {
  Database,
  MigrationCompiler,
  MigrationRunner,
  defineRecord,
  field,
  makeMigration,
} from '../src';
import type { Dialect, DialectEncoder } from '../src/engine';
import * as helper from './helper';

const NAME = 'orm_jsonb';

function encoder(dialect: Dialect): DialectEncoder {
  return {
    dialect,
    escape: value => `'${String(value).replace(/'/g, "''")}'`,
    escapeId: value => dialect === 'mysql' ? `\`${value}\`` : `"${value}"`,
    escapeDate: value => `'${value.toISOString()}'`,
  };
}

interface Payload {
  name: string;
  tags: string[];
}

class Doc extends defineRecord({
  table: 'ojb_doc',
  fields: {
    id: field.id(),
    plain: field.json<Payload>({ nullable: true }),
    binary: field.json<Payload>({ binary: true, nullable: true }),
    localAt: field.datetime({ column: 'local_at', nullable: true }),
    zonedAt: field.datetime({ column: 'zoned_at', timezone: true, nullable: true }),
  },
}) {}

beforeAll(() => helper.createDatabase(NAME, false));
afterAll(() => helper.dropDatabase(NAME));

const createSql = (dialect: Dialect): string => {
  const { migration } = makeMigration('0001_docs', { Doc });
  const create = migration.up.find(op => op.kind === 'createTable')!;
  return new MigrationCompiler(dialect, encoder(dialect)).compile(create)[0];
};

test.each([
  ['postgres', '"plain" json', '"binary" jsonb'],
  ['mysql', '`plain` json', '`binary` json'],
  ['sqlite3', '"plain" text', '"binary" text'],
] as const)('%s maps binary json to its own storage type', (dialect, plain, binary) => {
  const sql = createSql(dialect);
  expect(sql).toContain(plain);
  expect(sql).toContain(binary);
});

test.each([
  ['postgres', '"local_at" timestamp', '"zoned_at" timestamptz'],
  ['mysql', '`local_at` datetime', '`zoned_at` datetime'],
  ['sqlite3', '"local_at" datetime', '"zoned_at" datetime'],
] as const)('%s keeps an offset-aware timestamp distinct', (dialect, local, zoned) => {
  const sql = createSql(dialect);
  expect(sql).toContain(local);
  expect(sql).toContain(zoned);
});

test('binary json round-trips like a plain json column', async () => {
  const db = helper.connectToDatabase(NAME) as Database;
  const { migration } = makeMigration('0001_docs', { Doc });
  await new MigrationRunner(db).up([migration]);

  const models = db.bind({ Doc });
  const payload: Payload = { name: 'first', tags: ['a', 'b'] };
  const created = await models.Doc.create({ plain: payload, binary: payload });

  const loaded = await models.Doc.get({ id: created.id });
  expect(loaded?.plain).toEqual(payload);
  expect(loaded?.binary).toEqual(payload);

  await models.Doc.filter({ id: created.id })
    .update({ binary: { name: 'second', tags: [] } });
  expect((await models.Doc.get({ id: created.id }))?.binary)
    .toEqual({ name: 'second', tags: [] });

  await db.end();
});
