import {
  Database,
  MigrationCompiler,
  MigrationRunner,
  defineRecord,
  field,
  makeMigration,
  schemaFromRecords,
} from '../src';
import type { RecordClass } from '../src';
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

/**
 * A table-level composite foreign key keeps a redundant identifier honest:
 * the zone a room references must belong to the room's project.
 */
class Zone extends defineRecord({
  table: 'otc_zone',
  fields: {
    id: field.id(),
    project: field.integer(),
    name: field.string({ maxLength: 40 }),
  },
  indexes: [{ fields: ['id', 'project'], unique: true, name: 'otc_zone_id_project_uidx' }],
}) {}
class Room extends defineRecord({
  table: 'otc_room',
  fields: {
    id: field.id(),
    project: field.integer(),
    zone: field.foreignKey(() => Zone, { nullable: true, onDelete: 'set null' }),
  },
  foreignKeys: [
    {
      fields: ['zone', 'project'],
      references: { target: () => Zone, fields: ['id', 'project'] },
    },
  ],
}) {}

test('a composite foreign key reaches the generated DDL', () => {
  const { migration } = makeMigration('0001_rooms', { Zone, Room });
  const create = migration.up.find(
    item => item.kind === 'createTable' && item.table.name === 'otc_room'
  )!;
  const compiler = new MigrationCompiler('postgres', encoder('postgres'));
  expect(compiler.compile(create)[0]).toContain(
    'constraint "otc_room_zone_id_project_fkey" ' +
    'foreign key ("zone_id", "project") references "otc_zone" ("id", "project")'
  );
  // the field-level key keeps its own action and is untouched
  expect(compiler.compile(create)[0]).toContain(
    'constraint "otc_room_zone_id_fkey" foreign key ("zone_id") ' +
    'references "otc_zone" ("id") on delete set null'
  );
  expect(new MigrationCompiler('mysql', encoder('mysql')).compile(create)[0])
    .toContain(
      'foreign key (`zone_id`, `project`) references `otc_zone` (`id`, `project`)'
    );
});

test('a table-level foreign key action wins over the field options', () => {
  class Cascade extends defineRecord({
    table: 'otc_cascade',
    fields: {
      id: field.id(),
      project: field.integer(),
      zone: field.foreignKey(() => Zone, { nullable: true, onDelete: 'set null' }),
    },
    foreignKeys: [
      {
        fields: ['zone', 'project'],
        references: { target: () => Zone, fields: ['id', 'project'] },
        onDelete: 'cascade',
      },
    ],
  }) {}
  const { migration } = makeMigration('0001_cascade', { Zone, Cascade });
  const create = migration.up.find(
    item => item.kind === 'createTable' && item.table.name === 'otc_cascade'
  )!;
  const sql = new MigrationCompiler('postgres', encoder('postgres'))
    .compile(create)[0];
  expect(sql).toContain(
    'foreign key ("zone_id", "project") references "otc_zone" ("id", "project") ' +
    'on delete cascade'
  );
  expect(sql).toContain(
    'foreign key ("zone_id") references "otc_zone" ("id") on delete set null'
  );
});

test('a foreign key reference needs unique backing', () => {
  class Unbacked extends defineRecord({
    table: 'otc_unbacked',
    fields: { id: field.id(), project: field.integer(), name: field.string({ maxLength: 40 }) },
  }) {}
  class Partial extends defineRecord({
    table: 'otc_partial',
    fields: { id: field.id(), project: field.integer() },
    indexes: [
      { fields: ['id', 'project'], unique: true, where: 'project > 0' },
    ],
  }) {}
  const child = (target: () => RecordClass<any, any>, fields: readonly string[]) =>
    class extends defineRecord({
      table: 'otc_child',
      fields: {
        id: field.id(),
        project: field.integer(),
        zone: field.integer({ nullable: true }),
      },
      foreignKeys: [
        { fields: ['zone', 'project'], references: { target, fields } },
      ],
    }) {};
  expect(() => schemaFromRecords({
    Child: child(() => Unbacked, ['id', 'project']),
    Unbacked,
  })).toThrow('must reference the primary key, a unique constraint, or a full unique index');
  expect(() => schemaFromRecords({
    Child: child(() => Partial, ['id', 'project']),
    Partial,
  })).toThrow('must reference the primary key, a unique constraint, or a full unique index');
  expect(() => schemaFromRecords({
    Child: child(() => Zone, ['id', 'nope']),
    Zone,
  })).toThrow('unknown field nope');
  // the primary key and a full unique index both back a reference
  expect(() => schemaFromRecords({ Child: child(() => Zone, ['id', 'project']), Zone }))
    .not.toThrow();
  class Keyed extends defineRecord({
    table: 'otc_keyed',
    fields: { id: field.id(), code: field.string({ maxLength: 10 }) },
    unique: [['id', 'code']],
  }) {}
  expect(() => schemaFromRecords({
    Child: child(() => Keyed, ['id', 'code']),
    Keyed,
  })).not.toThrow();
});

test('generated migrations order backing keys before foreign keys', () => {
  class ParentV1 extends defineRecord({
    table: 'otc_diff_parent',
    fields: { id: field.id(), project: field.integer() },
  }) {}
  class ChildV1 extends defineRecord({
    table: 'otc_diff_child',
    fields: {
      id: field.id(),
      project: field.integer(),
      parent: field.foreignKey(() => ParentV1, { nullable: true }),
    },
  }) {}
  class ParentV2 extends defineRecord({
    table: 'otc_diff_parent',
    fields: { id: field.id(), project: field.integer() },
    indexes: [
      { fields: ['id', 'project'], unique: true, name: 'otc_diff_parent_id_project_uidx' },
    ],
  }) {}
  class ChildV2 extends defineRecord({
    table: 'otc_diff_child',
    fields: {
      id: field.id(),
      project: field.integer(),
      parent: field.foreignKey(() => ParentV2, { nullable: true }),
    },
    foreignKeys: [
      {
        fields: ['parent', 'project'],
        references: { target: () => ParentV2, fields: ['id', 'project'] },
      },
    ],
  }) {}
  const initial = makeMigration('0001_diff', { Parent: ParentV1, Child: ChildV1 });
  const changed = makeMigration(
    '0002_diff',
    { Parent: ParentV2, Child: ChildV2 },
    initial.migration
  );
  expect(changed.warnings).toEqual([]);
  const kinds = changed.migration.up.map(item => item.kind);
  expect(kinds).toEqual(['createIndex', 'addConstraint']);
  expect(changed.migration.down.map(item => item.kind))
    .toEqual(['dropConstraint', 'dropIndex']);
});

test('an unknown field name in an index is rejected', () => {
  class Bad extends defineRecord({
    table: 'otc_bad',
    fields: { id: field.id() },
    indexes: [{ fields: ['nope'] }],
  }) {}
  expect(() => makeMigration('0001_bad', { Bad })).toThrow('unknown field nope');
});

// MySQL cannot create the partial index at all, as the test above asserts, so
// Asset is left out of the migration there and its assertions are skipped.
const partialIndexSupported = helper.DB_TYPE !== 'mysql';

test('the constraints are enforced by the database', async () => {
  const db = helper.connectToDatabase(NAME) as Database;
  const { migration, warnings } = partialIndexSupported
    ? makeMigration('0001_items', { Item, Asset })
    : makeMigration('0001_items', { Item });
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
  if (partialIndexSupported) {
    await models.Asset.create({ code: 'sys' });
    await expect(models.Asset.create({ code: 'sys' })).rejects.toThrow();
    // rows with an owner fall outside the predicate and may repeat the code
    await models.Asset.create({ ownerId: 1, code: 'sys' });
    await models.Asset.create({ ownerId: 2, code: 'sys' });
    expect(await models.Asset.filter({ code: 'sys' }).count()).toBe(3);
  }

  await db.end();
});
