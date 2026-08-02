import {
  Database,
  MigrationCompiler,
  MigrationRunner,
  defineRecord,
  encodeFilter,
  exportSchemaJava,
  field,
  makeMigration,
  printSchema,
  printSchemaTypeMap,
  schemaFromRecords,
} from '../src';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _toCamel, Table } from '../src/database';
import type { Dialect, DialectEncoder } from '../src/engine';
import { isValue, SimpleField } from '../src/schema';
import { decodeVector } from '../src/vector';
import * as helper from './helper';

const NAME = 'vector';

class VectorItem extends defineRecord({
  table: 'vector_item',
  fields: {
    id: field.id(),
    label: field.string({ maxLength: 100, unique: true }),
    embedding: field.vector({ dimensions: 3 }),
    defaultEmbedding: field.vector({
      column: 'default_embedding',
      dimensions: 3,
      default: [0, 0, 0],
    }),
    optionalEmbedding: field.vector({
      column: 'optional_embedding',
      dimensions: 3,
      nullable: true,
    }),
  },
}) {}

const bindVectorModels = (database: Database) => database.bind({ VectorItem });

function assertVectorTypes(item: InstanceType<typeof VectorItem>) {
  const embedding: number[] = item.embedding;
  const optional: number[] | null = item.optionalEmbedding;
  // @ts-expect-error vector fields are numeric arrays, not strings
  const invalid: string = item.embedding;
  return { embedding, optional, invalid };
}
void assertVectorTypes;

function assertInvalidVectorOptions() {
  // @ts-expect-error vector columns cannot be primary keys
  field.vector({ dimensions: 3, primaryKey: true });
  // @ts-expect-error native vector columns cannot be unique
  field.vector({ dimensions: 3, unique: true });
  // @ts-expect-error vectors cannot use auto-increment generation
  field.vector({ dimensions: 3, generated: true });
  // @ts-expect-error portable vector indexes require engine-specific definitions
  field.vector({ dimensions: 3, index: true });
  // @ts-expect-error vector defaults must be vectors or SQL expressions
  field.vector({ dimensions: 3, default: 1 });
}
void assertInvalidVectorOptions;

function encoder(dialect: Dialect): DialectEncoder {
  return {
    dialect,
    escape: value => `'${String(value).replace(/'/g, "''")}'`,
    escapeId: value => dialect === 'mysql' ? `\`${value}\`` : `"${value}"`,
    escapeDate: value => `'${value.toISOString()}'`,
  };
}

function vectorField(dimensions = 3): SimpleField {
  return {
    column: { name: 'embedding', type: 'vector', dimensions },
  } as SimpleField;
}

describe('vector field definition', () => {
  test('keeps vector metadata in the generated schema', () => {
    const schema = schemaFromRecords({ VectorItem });
    const column = schema.model('VectorItem')!.field('embedding') as SimpleField;

    expect(column.column).toEqual(expect.objectContaining({
      name: 'embedding',
      type: 'vector',
      dimensions: 3,
      nullable: undefined,
    }));
  });

  test.each([0, -1, 1.5, Number.NaN])(
    'rejects invalid dimension count %s',
    dimensions => {
      expect(() => field.vector({ dimensions })).toThrow(
        'vector dimensions must be a positive integer'
      );
    }
  );

  test.each(['primaryKey', 'unique', 'generated', 'index'] as const)(
    'rejects the unsupported %s option at runtime',
    option => {
      expect(() => field.vector({
        dimensions: 3,
        [option]: true,
      } as any)).toThrow(`vector fields do not support the ${option} option`);
    }
  );

  test('validates vector defaults when the field is defined', () => {
    expect(() => field.vector({
      dimensions: 3,
      default: [1, 2],
    })).toThrow('2 dimensions; expected 3');
  });
});

describe('vector schema output', () => {
  const schema = schemaFromRecords({ VectorItem });

  test('prints vector fields as numeric arrays', () => {
    expect(printSchema(schema)).toMatch(/embedding\?: number\[\];/);
    expect(printSchemaTypeMap(schema)).toMatch(/embedding: number\[\] \| null;/);
  });

  test('exports vector fields to Java arrays', () => {
    const path = mkdtempSync(join(tmpdir(), 'sqlex-vector-java-'));
    try {
      exportSchemaJava(schema, { path });
      const java = readFileSync(join(path, 'VectorItem.java'), 'utf8');
      expect(java).toContain('private double[] embedding');
      expect(java).toContain('public double[] getEmbedding()');
    } finally {
      rmSync(path, { recursive: true, force: true });
    }
  });
});

describe('vector migration SQL', () => {
  const migration = makeMigration('0001_vectors', { VectorItem }).migration;
  const create = migration.up.find(operation => operation.kind === 'createTable')!;

  test.each(['postgres', 'mysql', 'sqlite3'] as const)(
    '%s preserves the native/custom vector declaration',
    dialect => {
      const sql = new MigrationCompiler(dialect, encoder(dialect)).compile(create)[0];
      const id = dialect === 'mysql' ? '`embedding`' : '"embedding"';
      expect(sql).toContain(`${id} vector(3) not null`);
      const defaultId = dialect === 'mysql'
        ? '`default_embedding`'
        : '"default_embedding"';
      const defaultSql = dialect === 'mysql'
        ? "default (string_to_vector('[0,0,0]'))"
        : "default '[0,0,0]'";
      expect(sql).toContain(`${defaultId} vector(3) not null ${defaultSql}`);
    }
  );
});

describe('vector values', () => {
  test('classifies only non-empty numeric arrays as scalar values', () => {
    expect(isValue([1, 2, 3])).toBe(true);
    expect(isValue([])).toBe(false);
    expect(isValue(['1', '2'])).toBe(false);
  });

  test.each([
    ['postgres', "'[1,2.5,-3]'"],
    ['mysql', "string_to_vector('[1,2.5,-3]')"],
    ['sqlite3', "'[1,2.5,-3]'"],
  ] as const)('%s encodes vectors correctly', (dialect, expected) => {
    const table = {
      db: { pool: encoder(dialect) },
    } as unknown as Table;
    expect(
      Table.prototype.escapeValue.call(table, vectorField(), [1, 2.5, -3])
    ).toBe(expected);
  });

  test('decodes PostgreSQL/SQLite text and already-decoded arrays', () => {
    expect(_toCamel('[1,2.5,-3]', vectorField())).toEqual([1, 2.5, -3]);
    expect(_toCamel([1, 2.5, -3], vectorField())).toEqual([1, 2.5, -3]);
  });

  test('decodes MySQL little-endian float32 buffers', () => {
    const value = Buffer.alloc(12);
    [1, 2.5, -3].forEach((entry, index) => value.writeFloatLE(entry, index * 4));
    expect(decodeVector(value, vectorField().column)).toEqual([1, 2.5, -3]);
  });

  test('normalizes empty nullable vector driver representations', () => {
    const field = vectorField();
    field.column.nullable = true;
    expect(_toCamel([], field)).toBeNull();
    expect(_toCamel(Buffer.alloc(0), field)).toBeNull();
    expect(_toCamel(new Float32Array(0), field)).toBeNull();

    const required = vectorField();
    expect(() => _toCamel(Buffer.alloc(0), required)).toThrow('non-empty array');
  });

  test.each([
    [[1, 2], /2 dimensions; expected 3/],
    [[1, Number.NaN, 3], /finite numbers/],
    [[1, Number.POSITIVE_INFINITY, 3], /finite numbers/],
    [['1', 2, 3], /finite numbers/],
    [[], /non-empty array/],
  ])('rejects invalid vector %p', (value, message) => {
    expect(() => _toCamel(value, vectorField())).toThrow(message as RegExp);
  });
});

describe('vector filters', () => {
  const model = schemaFromRecords({ VectorItem }).model('VectorItem')!;

  test.each([
    ['postgres', '"vector_item"."embedding" = \'[1,2,3]\''],
    ['mysql', '`vector_item`.`embedding` = string_to_vector(\'[1,2,3]\')'],
    ['sqlite3', '"vector_item"."embedding" = \'[1,2,3]\''],
  ] as const)('%s uses a vector equality literal', (dialect, expected) => {
    expect(encodeFilter({ embedding: [1, 2, 3] }, model, encoder(dialect)))
      .toBe(expected);
  });

  test('validates dimensions before producing filter SQL', () => {
    expect(() =>
      encodeFilter({ embedding: [1, 2] }, model, encoder('sqlite3'))
    ).toThrow('2 dimensions; expected 3');
  });

  test.each([
    ['embedding_in', 'in'],
    ['embedding_notIn', 'notIn'],
  ] as const)('explains that flat %s values are not vector lists', (key, operator) => {
    expect(() => encodeFilter(
      { [key]: [1, 2, 3] },
      model,
      encoder('sqlite3')
    )).toThrow(
      `vector '${operator}' filter expects an array of vectors; ` +
      "use 'embedding' for equality"
    );
  });

  test.each([
    ['postgres', '"vector_item"."embedding" <> \'[1,2,3]\''],
    ['mysql', '`vector_item`.`embedding` <> string_to_vector(\'[1,2,3]\')'],
    ['sqlite3', '"vector_item"."embedding" <> \'[1,2,3]\''],
  ] as const)('%s supports vector inequality', (dialect, expected) => {
    expect(encodeFilter({ embedding_ne: [1, 2, 3] }, model, encoder(dialect)))
      .toBe(expected);
  });

  test.each([
    ['postgres', '"vector_item"."embedding" in (\'[1,2,3]\', \'[4,5,6]\')'],
    ['mysql', '`vector_item`.`embedding` in (string_to_vector(\'[1,2,3]\'), string_to_vector(\'[4,5,6]\'))'],
    ['sqlite3', '"vector_item"."embedding" in (\'[1,2,3]\', \'[4,5,6]\')'],
  ] as const)('%s supports vector inclusion lists', (dialect, expected) => {
    expect(encodeFilter(
      { embedding_in: [[1, 2, 3], [4, 5, 6]] },
      model,
      encoder(dialect)
    )).toBe(expected);
  });

  test.each([
    ['postgres', '"vector_item"."embedding" not in (\'[1,2,3]\', \'[4,5,6]\')'],
    ['mysql', '`vector_item`.`embedding` not in (string_to_vector(\'[1,2,3]\'), string_to_vector(\'[4,5,6]\'))'],
    ['sqlite3', '"vector_item"."embedding" not in (\'[1,2,3]\', \'[4,5,6]\')'],
  ] as const)('%s supports vector exclusion lists', (dialect, expected) => {
    expect(encodeFilter(
      { embedding_notIn: [[1, 2, 3], [4, 5, 6]] },
      model,
      encoder(dialect)
    )).toBe(expected);
  });

  test.each(['postgres', 'mysql', 'sqlite3'] as const)(
    '%s supports nullable vector filters',
    dialect => {
      const id = dialect === 'mysql'
        ? '`vector_item`.`optional_embedding`'
        : '"vector_item"."optional_embedding"';
      expect(encodeFilter(
        { optionalEmbedding_null: true },
        model,
        encoder(dialect)
      )).toBe(`${id} is null`);
    }
  );
});

const nativeVectorIntegration =
  helper.DB_TYPE === 'sqlite3' || process.env.SQLEX_VECTOR_TESTS === '1';
const describeVectorIntegration = nativeVectorIntegration ? describe : describe.skip;

describeVectorIntegration(`vector integration (${helper.DB_TYPE})`, () => {
  let db: Database;
  let models: ReturnType<typeof bindVectorModels>;
  let runner: MigrationRunner;
  let migration: ReturnType<typeof makeMigration>['migration'];

  beforeAll(async () => {
    await helper.createDatabase(NAME, false);
    if (helper.DB_TYPE === 'postgres') {
      const connection = helper.createTestConnection(NAME);
      await connection._query('create extension if not exists vector');
      await connection.end();
    }
    db = helper.connectToDatabase(NAME) as Database;
    migration = makeMigration('0001_vectors', { VectorItem }).migration;
    runner = new MigrationRunner(db);
    await runner.up([migration]);
    models = bindVectorModels(db);
  });

  afterAll(async () => {
    if (db) await db.end();
    await helper.dropDatabase(NAME);
  });

  test('creates, reads, filters, updates, and introspects vectors', async () => {
    const created = await models.VectorItem.create({
      label: 'first',
      embedding: [1, 2.5, -3],
      optionalEmbedding: null,
    });
    expect(created.embedding).toEqual([1, 2.5, -3]);
    expect(created.defaultEmbedding).toEqual([0, 0, 0]);
    expect(created.optionalEmbedding).toBeNull();

    const filtered = await models.VectorItem
      .filter({ embedding: [1, 2.5, -3] })
      .first();
    expect(filtered?.id).toBe(created.id);

    expect(await models.VectorItem
      .filter({ embedding_in: [[1, 2.5, -3], [9, 9, 9]] })
      .count()).toBe(1);
    expect(await models.VectorItem
      .filter({ embedding_notIn: [[9, 9, 9]] })
      .count()).toBe(1);
    expect(await models.VectorItem
      .filter({ optionalEmbedding_null: true })
      .count()).toBe(1);

    created.embedding = [4, 5, 6];
    created.optionalEmbedding = [0.25, 0.5, 0.75];
    await created.save();
    await created.refresh();
    expect(created.embedding).toEqual([4, 5, 6]);
    expect(created.optionalEmbedding).toEqual([0.25, 0.5, 0.75]);

    const schema = await db.buildSchema();
    const table = schema.model('vector_item')!;
    const embedding = table.field('embedding') as SimpleField;
    expect(embedding.column.type).toBe('vector');
    expect(embedding.column.dimensions).toBe(3);

    // Re-baselining an already-applied migration still verifies its snapshot,
    // including vector dimensions and defaults, against the live schema.
    expect((await runner.baseline([migration])).applied).toEqual([]);
  });

  test('rejects wrong dimensions and non-finite values before writing', () => {
    expect(() => models.VectorItem.build({
      label: 'short',
      embedding: [1, 2],
    })).toThrow('2 dimensions; expected 3');
    expect(() => models.VectorItem.build({
      label: 'nan',
      embedding: [1, Number.NaN, 3],
    })).toThrow('finite numbers');
  });
});
