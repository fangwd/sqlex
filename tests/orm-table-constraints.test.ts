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

const NAME = 'orm_table_constraints';

function encoder(dialect: Dialect): DialectEncoder {
  return {
    dialect,
    escape: value => `'${String(value).replace(/'/g, "''")}'`,
    escapeId: value => dialect === 'mysql' ? `\`${value}\`` : `"${value}"`,
    escapeDate: value => `'${value.toISOString()}'`,
  };
}

/**
 * `unique` declares a real unique key: the model uses it for identity, so
 * create() resolves an existing row by it, and every member must be supplied.
 */
class Item extends defineRecord({
  table: 'otc_item',
  fields: {
    id: field.id(),
    ownerId: field.integer({ column: 'owner_id' }),
    code: field.string({ maxLength: 40 }),
    bucket: field.string({ maxLength: 20 }),
    score: field.float({ default: 0 }),
  },
  unique: [['ownerId', 'code']],
  indexes: [{ fields: ['bucket', 'score'], name: 'otc_item_bucket_score_idx' }],
  checks: [
    { name: 'otc_item_score_range', expression: 'score >= 0 and score <= 100' },
  ],
}) {}

/**
 * A unique `index` is database-only enforcement with no identity semantics,
 * which is what a partial index needs: `owner_id` may be null here.
 */
class Asset extends defineRecord({
  table: 'otc_asset',
  fields: {
    id: field.id(),
    ownerId: field.integer({ column: 'owner_id', nullable: true }),
    code: field.string({ maxLength: 40 }),
  },
  indexes: [
    {
      fields: ['code'],
      name: 'otc_asset_system_code_key',
      unique: true,
      where: 'owner_id is null',
    },
  ],
}) {}

beforeAll(() => helper.createDatabase(NAME, false));
afterAll(() => helper.dropDatabase(NAME));

const compile = (dialect: Dialect): string => {
  const { migration } = makeMigration('0001_items', { Item, Asset });
  const compiler = new MigrationCompiler(dialect, encoder(dialect));
  return migration.up.flatMap(op => compiler.compile(op)).join(';\n');
};

test('table-level declarations reach the generated DDL', () => {
  const sql = compile('postgres');

  expect(sql).toContain('unique ("owner_id", "code")');
  expect(sql).toContain(
    'constraint "otc_item_score_range" check (score >= 0 and score <= 100)'
  );
  expect(sql).toContain(
    'create index "otc_item_bucket_score_idx" on "otc_item" ("bucket", "score")'
  );
  expect(sql).toContain(
    'create unique index "otc_asset_system_code_key" on "otc_asset" ' +
    '("code") where owner_id is null'
  );
});

test('MySQL rejects a partial index instead of emitting invalid SQL', () => {
  expect(() => compile('mysql')).toThrow('does not support partial indexes');
});

test('an unknown field name in an index is rejected', () => {
  class Bad extends defineRecord({
    table: 'otc_bad',
    fields: { id: field.id() },
    indexes: [{ fields: ['nope'] }],
  }) {}
  expect(() => makeMigration('0001_bad', { Bad })).toThrow('unknown field nope');
});

test('the constraints are enforced by the database', async () => {
  const db = helper.connectToDatabase(NAME) as Database;
  const { migration, warnings } = makeMigration('0001_items', { Item, Asset });
  expect(warnings).toEqual([]);
  await new MigrationRunner(db).up([migration]);

  const models = db.bind({ Item, Asset });

  const first = await models.Item.create({
    ownerId: 1, code: 'a', bucket: 'x', score: 10,
  });

  // The composite constraint is a real unique key, so the model resolves an
  // existing row by it exactly as it would for a single-column unique key.
  const again = await models.Item.create({
    ownerId: 1, code: 'a', bucket: 'y', score: 30,
  });
  expect(again.id).toBe(first.id);

  // Only the pair is unique, so the same code under another owner is new.
  const other = await models.Item.create({
    ownerId: 2, code: 'a', bucket: 'x', score: 20,
  });
  expect(other.id).not.toBe(first.id);
  expect(await models.Item.filter({ code: 'a' }).count()).toBe(2);

  // The check constraint is not part of the model, so the database rejects it.
  await expect(
    models.Item.create({ ownerId: 3, code: 'b', bucket: 'x', score: 999 })
  ).rejects.toThrow();

  // The partial unique index constrains only the rows it covers.
  await models.Asset.create({ code: 'sys' });
  await expect(models.Asset.create({ code: 'sys' })).rejects.toThrow();
  // rows with an owner fall outside the predicate and may repeat the code
  await models.Asset.create({ ownerId: 1, code: 'sys' });
  await models.Asset.create({ ownerId: 2, code: 'sys' });
  expect(await models.Asset.filter({ code: 'sys' }).count()).toBe(3);

  await db.end();
});
