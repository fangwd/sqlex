import {
  Database,
  MigrationCompiler,
  MigrationRunner,
  defineRecord,
  field,
  makeMigration,
  schemaFromRecords,
} from '../src';
import { SimpleField } from '../src/schema';
import type { Dialect, DialectEncoder } from '../src/engine';
import * as helper from './helper';

const NAME = 'comments';

class Supplier extends defineRecord({
  table: 'cmt_supplier',
  comment: 'A company we buy stock from.',
  fields: {
    id: field.id(),
    name: field.string({ maxLength: 60, unique: true, comment: 'Trading name.' }),
  },
}) {}

class Part extends defineRecord({
  table: 'cmt_part',
  comment: "A physical part in the catalogue. Includes O'Brien's specials.",
  fields: {
    id: field.id(),
    supplier: field.foreignKey(() => Supplier, {
      comment: 'Who we buy it from.',
    }),
    code: field.string({ maxLength: 20, unique: true }),
    price: field.decimal({ precision: 8, scale: 2, comment: 'Unit price in AUD.' }),
  },
}) {}

function encoder(dialect: Dialect): DialectEncoder {
  return {
    dialect,
    escape: value => `'${String(value).replace(/'/g, "''")}'`,
    escapeId: value => (dialect === 'mysql' ? `\`${value}\`` : `"${value}"`),
    escapeDate: value => `'${value.toISOString()}'`,
  };
}

describe('derived schema', () => {
  test('comments reach the columns and the table', () => {
    const schema = schemaFromRecords({ Supplier, Part });
    const part = schema.model('Part')!;
    expect(part.table.comment).toBe(
      "A physical part in the catalogue. Includes O'Brien's specials."
    );
    expect((part.field('price') as SimpleField).column.comment).toBe('Unit price in AUD.');
    // The foreign key carries its own comment, not the target column's.
    expect((part.field('supplier') as SimpleField).column.comment).toBe('Who we buy it from.');
    expect((part.field('code') as SimpleField).column.comment).toBe(undefined);
    expect(schema.model('Supplier')!.table.comment).toBe('A company we buy stock from.');
  });
});

describe('generated DDL', () => {
  const { migration } = makeMigration('0001_comments', { Supplier, Part });
  const createPart = migration.up.find(
    item => item.kind === 'createTable' && item.table.name === 'cmt_part'
  )!;

  test('mysql keeps comments inline, with quotes escaped', () => {
    const [sql] = new MigrationCompiler('mysql', encoder('mysql')).compile(createPart);
    expect(sql).toContain("`price` decimal(8,2) not null comment 'Unit price in AUD.'");
    expect(sql).toContain(
      ") comment 'A physical part in the catalogue. Includes O''Brien''s specials.'"
    );
  });

  test('postgres emits comment statements after the create', () => {
    const statements = new MigrationCompiler('postgres', encoder('postgres')).compile(createPart);
    expect(statements[0]).toMatch(/^create table/);
    expect(statements).toContain(
      `comment on table "cmt_part" is 'A physical part in the catalogue. Includes O''Brien''s specials.'`
    );
    expect(statements).toContain(`comment on column "cmt_part"."price" is 'Unit price in AUD.'`);
    expect(statements).toContain(
      `comment on column "cmt_part"."supplier_id" is 'Who we buy it from.'`
    );
    // Uncommented columns produce no statement.
    expect(statements.join('\n')).not.toContain('"cmt_part"."code" is');
  });

  test('sqlite has nowhere to store a comment, so none is emitted', () => {
    const statements = new MigrationCompiler('sqlite3', encoder('sqlite3')).compile(createPart);
    expect(statements).toHaveLength(1);
    expect(statements[0].toLowerCase()).not.toContain('comment');
  });

  test('an added column carries its comment too', () => {
    const addColumn = {
      kind: 'addColumn' as const,
      table: 'cmt_part',
      column: { name: 'notes', type: 'varchar', size: 100, nullable: true, comment: 'Free text.' },
    };
    const mysql = new MigrationCompiler('mysql', encoder('mysql')).compile(addColumn);
    expect(mysql[0]).toContain("comment 'Free text.'");
    const postgres = new MigrationCompiler('postgres', encoder('postgres')).compile(addColumn);
    expect(postgres).toContain(`comment on column "cmt_part"."notes" is 'Free text.'`);
  });
});

describe(`round trip (${helper.DB_TYPE})`, () => {
  let db: Database;

  beforeAll(async () => {
    await helper.createDatabase(NAME, false);
    db = new Database(helper.createTestConnectionPool(NAME));
    const { migration } = makeMigration('0001_comments', { Supplier, Part });
    await new MigrationRunner(db).up([migration]);
    await db.buildSchema();
  });

  afterAll(async () => {
    if (db) await db.end();
    await helper.dropDatabase(NAME);
  });

  test('introspection reports what the migration stored', () => {
    // Reflected models are named from their tables.
    const part = db.schema.model('cmt_part')!;
    const priceComment = (part.field('price') as SimpleField).column.comment;
    const supplierComment = (part.field('supplier') as SimpleField).column.comment;

    if (helper.DB_TYPE === 'sqlite3') {
      // sqlite has no comment storage; the reflected schema simply has none.
      expect(part.table.comment).toBe(undefined);
      expect(priceComment).toBe(undefined);
    } else {
      expect(part.table.comment).toBe(
        "A physical part in the catalogue. Includes O'Brien's specials."
      );
      expect(priceComment).toBe('Unit price in AUD.');
      expect(supplierComment).toBe('Who we buy it from.');
      expect((part.field('code') as SimpleField).column.comment).toBe(undefined);
      expect(db.schema.model('cmt_supplier')!.table.comment).toBe(
        'A company we buy stock from.'
      );
    }
  });
});
