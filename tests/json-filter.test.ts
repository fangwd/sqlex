import { Schema, Model } from '../src/schema';
import { Database as Db } from '../src/database';
import { QueryBuilder, JsonFilterOptions, encodeFilter } from '../src/filter';
import { DialectEncoder } from '../src/engine';
import { Database } from '../src/types';
import type { Filter } from '../src';

import * as helper from './helper';

const NAME = 'json_filter';

// product.config is a json column populated with hierarchical objects and
// arrays in tests/data/data.sql. JSON path filtering is only supported on
// engines with JSON functions.
const jsonCapable = ['mysql', 'postgres', 'sqlite3'].includes(helper.DB_TYPE);
const describeDb = jsonCapable ? describe : describe.skip;

describeDb('json filtering against a real engine', () => {
  let db: ReturnType<typeof helper.connectToDatabase>;

  beforeAll(async () => {
    await helper.createDatabase(NAME);
    db = helper.connectToDatabase(NAME);
  });

  afterAll(async () => {
    await db.end();
    await helper.dropDatabase(NAME);
  });

  async function ids(where: any): Promise<number[]> {
    const rows = await db.table('product').select('id', { where });
    return rows.map((row) => row.id as number).sort((a, b) => a - b);
  }

  test('string equality on a top-level key', async () => {
    expect(await ids({ config: { sub_title: 'Fresh' } })).toEqual([1]);
  });

  test('boolean equality', async () => {
    expect(await ids({ config: { featured: true } })).toEqual([1, 3]);
    expect(await ids({ config: { featured: false } })).toEqual([2, 5]);
  });

  test('numeric comparison', async () => {
    expect(await ids({ config: { rank_gt: 2 } })).toEqual([3, 5]);
    expect(await ids({ config: { rank_ge: 2 } })).toEqual([2, 3, 5]);
  });

  test('nested object descent and dotted shorthand are equivalent', async () => {
    expect(await ids({ config: { origin: { country: 'AU' } } })).toEqual([1, 2, 5]);
    expect(await ids({ config: { 'origin.country': 'AU' } })).toEqual([1, 2, 5]);
    expect(await ids({ config: { 'origin.region': 'Tasmania' } })).toEqual([1]);
  });

  test('like on a nested path', async () => {
    expect(await ids({ config: { 'origin.country_like': 'A%' } })).toEqual([1, 2, 5]);
  });

  test('string in list', async () => {
    expect(await ids({ config: { 'origin.country_in': ['US'] } })).toEqual([3]);
  });

  test('numeric in list (typed extraction)', async () => {
    expect(await ids({ config: { rank_in: [1, 5] } })).toEqual([1, 5]);
  });

  test('contains on a json array', async () => {
    expect(await ids({ config: { tags_contains: 'sale' } })).toEqual([1, 5]);
    expect(await ids({ config: { tags_contains: 'fruit' } })).toEqual([1, 2, 3]);
  });

  test('null means json null or absent', async () => {
    // discount: 0.1 on product 1, json null on product 3, absent elsewhere
    expect(await ids({ config: { discount_null: false } })).toEqual([1]);
    expect(await ids({ config: { discount_null: true } })).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  test('multiple keys combine with and', async () => {
    expect(await ids({ config: { featured: true, rank_lt: 2 } })).toEqual([1]);
  });

  test('explicit operator object reaches a collision key', async () => {
    // opt_in would suffix-split to path `opt` + `in`; the explicit form keeps it literal.
    expect(await ids({ config: { opt_in: { $eq: 'yes' } } })).toEqual([1]);
  });

  test('explicit multi-operator object is a range', async () => {
    expect(await ids({ config: { rank: { $gt: 1, $lt: 5 } } })).toEqual([2, 3]);
  });

  test('boolean in list', async () => {
    expect(await ids({ config: { featured_in: [true] } })).toEqual([1, 3]);
    expect(await ids({ config: { featured_in: [false] } })).toEqual([2, 5]);
  });

  test('jsonFilterOptions propagate to the count/_where path', async () => {
    // With the default '_' delimiter, 'rank__gt' would mean the literal key
    // 'rank_' and match nothing; the option must reach count() via _where.
    const custom = new Db(
      helper.createTestConnectionPool(NAME),
      new Schema(helper.getExampleData()),
      undefined,
      { operatorDelimiter: '__' }
    );
    try {
      expect(await custom.table('product').count({ config: { rank__gt: 2 } } as any)).toBe(2);
    } finally {
      await custom.end();
    }
  });
});

// The remaining suites verify SQL generation and parsing without a connection,
// covering per-dialect SQL shape that a single engine run cannot.
function jsonModel(): Model {
  const database: Database = {
    name: 'test',
    tables: [
      {
        name: 'user',
        columns: [
          { name: 'id', type: 'int', autoIncrement: true },
          { name: 'meta', type: 'json', nullable: true },
        ],
        constraints: [{ columns: ['id'], primaryKey: true }],
      },
    ],
  };
  return new Schema(database).model('User') as Model;
}

const postgres: DialectEncoder = {
  dialect: 'postgres',
  escapeId: (s) => `"${s}"`,
  escape: (s) => `'${(s + '').replace(/'/g, "''")}'`,
  escapeDate: (d) => `'${d.toISOString()}'`,
};

const mysql: DialectEncoder = {
  dialect: 'mysql',
  escapeId: (s) => '`' + s + '`',
  escape: (s) => `'${(s + '').replace(/'/g, "\\'")}'`,
  escapeDate: (d) => `'${d.toISOString()}'`,
};

const sqlite3: DialectEncoder = {
  dialect: 'sqlite3',
  escapeId: (s) => `"${s}"`,
  escape: (s) => `'${(s + '').replace(/'/g, "''")}'`,
  escapeDate: (d) => `'${d.toISOString()}'`,
};

function where(encoder: DialectEncoder, args: Filter, options?: JsonFilterOptions): string {
  return new QueryBuilder(jsonModel(), encoder, undefined, options).where(args);
}

describe('json path extraction (sql shape)', () => {
  test('string equality', () => {
    expect(where(postgres, { meta: { name: 'Joe' } })).toBe(
      `"user"."meta" #>> array['name'] = 'Joe'`
    );
    expect(where(mysql, { meta: { name: 'Joe' } })).toBe(
      "json_unquote(json_extract(`user`.`meta`, '$.name')) = 'Joe'"
    );
    expect(where(sqlite3, { meta: { name: 'Joe' } })).toBe(
      `json_extract("user"."meta", '$.name') = 'Joe'`
    );
  });

  test('numeric comparison casts on postgres only', () => {
    expect(where(postgres, { meta: { age_gt: 18 } })).toBe(
      `("user"."meta" #>> array['age'])::numeric > 18`
    );
    expect(where(mysql, { meta: { age_gt: 18 } })).toBe(
      "json_extract(`user`.`meta`, '$.age') > 18"
    );
    expect(where(sqlite3, { meta: { age_gt: 18 } })).toBe(
      `json_extract("user"."meta", '$.age') > 18`
    );
  });

  test('boolean comparison', () => {
    expect(where(postgres, { meta: { active: true } })).toBe(
      `("user"."meta" #>> array['active'])::boolean = true`
    );
    expect(where(mysql, { meta: { active: false } })).toBe(
      "json_unquote(json_extract(`user`.`meta`, '$.active')) = 'false'"
    );
    expect(where(sqlite3, { meta: { active: true } })).toBe(
      `json_extract("user"."meta", '$.active') = 1`
    );
  });

  test('dotted shorthand and nested-object descent are equivalent', () => {
    expect(where(postgres, { meta: { 'address.city': 'NYC' } })).toBe(
      `"user"."meta" #>> array['address','city'] = 'NYC'`
    );
    expect(where(postgres, { meta: { address: { city: 'NYC' } } })).toBe(
      `"user"."meta" #>> array['address','city'] = 'NYC'`
    );
    expect(where(mysql, { meta: { address: { zip_like: '100%' } } })).toBe(
      "json_unquote(json_extract(`user`.`meta`, '$.address.zip')) like '100%'"
    );
  });

  test('array index segments', () => {
    expect(where(sqlite3, { meta: { 'items.0.name': 'x' } })).toBe(
      `json_extract("user"."meta", '$.items[0].name') = 'x'`
    );
    expect(where(postgres, { meta: { 'items.0.name': 'x' } })).toBe(
      `"user"."meta" #>> array['items','0','name'] = 'x'`
    );
  });

  test('string in / notIn use text extraction', () => {
    expect(where(sqlite3, { meta: { role_in: ['admin', 'editor'] } })).toBe(
      `json_extract("user"."meta", '$.role') in ('admin', 'editor')`
    );
    expect(where(sqlite3, { meta: { role_notIn: ['admin'] } })).toBe(
      `json_extract("user"."meta", '$.role') not in ('admin')`
    );
  });

  test('numeric in uses typed extraction', () => {
    expect(where(postgres, { meta: { rank_in: [1, 5] } })).toBe(
      `("user"."meta" #>> array['rank'])::numeric in (1, 5)`
    );
    expect(where(mysql, { meta: { rank_in: [1, 5] } })).toBe(
      "json_extract(`user`.`meta`, '$.rank') in (1, 5)"
    );
    expect(where(sqlite3, { meta: { rank_in: [1, 5] } })).toBe(
      `json_extract("user"."meta", '$.rank') in (1, 5)`
    );
  });

  test('boolean in uses typed extraction', () => {
    expect(where(postgres, { meta: { active_in: [true] } })).toBe(
      `("user"."meta" #>> array['active'])::boolean in (true)`
    );
    expect(where(sqlite3, { meta: { active_in: [true, false] } })).toBe(
      `json_extract("user"."meta", '$.active') in (1, 0)`
    );
    expect(where(mysql, { meta: { active_in: [true] } })).toBe(
      "json_unquote(json_extract(`user`.`meta`, '$.active')) in ('true')"
    );
  });

  test('plain array without operator behaves as in', () => {
    expect(where(sqlite3, { meta: { role: ['a', 'b'] } })).toBe(
      `json_extract("user"."meta", '$.role') in ('a', 'b')`
    );
  });

  test('in containing null keeps null handling', () => {
    expect(where(sqlite3, { meta: { role_in: ['admin', null] } })).toBe(
      `(json_extract("user"."meta", '$.role') is null or json_extract("user"."meta", '$.role') in ('admin'))`
    );
  });

  test('ilike maps to like off postgres', () => {
    expect(where(postgres, { meta: { name_ilike: 'jo%' } })).toBe(
      `"user"."meta" #>> array['name'] ilike 'jo%'`
    );
    expect(where(mysql, { meta: { name_ilike: 'jo%' } })).toBe(
      "json_unquote(json_extract(`user`.`meta`, '$.name')) like 'jo%'"
    );
  });

  test('null operator and null value', () => {
    expect(where(postgres, { meta: { nickname_null: true } })).toBe(
      `"user"."meta" #>> array['nickname'] is null`
    );
    expect(where(postgres, { meta: { nickname_null: false } })).toBe(
      `"user"."meta" #>> array['nickname'] is not null`
    );
    expect(where(mysql, { meta: { nickname_null: true } })).toBe(
      "(json_extract(`user`.`meta`, '$.nickname') is null or json_type(json_extract(`user`.`meta`, '$.nickname')) = 'NULL')"
    );
    expect(where(sqlite3, { meta: { nickname: null } })).toBe(
      `json_extract("user"."meta", '$.nickname') is null`
    );
  });

  test('contains', () => {
    expect(where(postgres, { meta: { tags_contains: 'vip' } })).toBe(
      `("user"."meta" #> array['tags'])::jsonb @> '"vip"'::jsonb`
    );
    expect(where(mysql, { meta: { tags_contains: 'vip' } })).toBe(
      "json_contains(`user`.`meta`, '\"vip\"', '$.tags')"
    );
    expect(where(sqlite3, { meta: { tags_contains: 'vip' } })).toBe(
      `exists (select 1 from json_each("user"."meta", '$.tags') where value = 'vip')`
    );
    expect(where(sqlite3, { meta: { tags_contains: 7 } })).toBe(
      `exists (select 1 from json_each("user"."meta", '$.tags') where value = 7)`
    );
    expect(where(sqlite3, { meta: { tags_contains: null } })).toBe(
      `exists (select 1 from json_each("user"."meta", '$.tags') where value is null)`
    );
  });

  test('multiple leaves joined with and', () => {
    expect(where(sqlite3, { meta: { name: 'Joe', age_gt: 18 } })).toBe(
      `(json_extract("user"."meta", '$.name') = 'Joe') and (json_extract("user"."meta", '$.age') > 18)`
    );
  });
});

describe('operator syntax modes', () => {
  test('snake_case keys stay literal in default both/_', () => {
    expect(where(sqlite3, { meta: { first_name: 'Joe' } })).toBe(
      `json_extract("user"."meta", '$.first_name') = 'Joe'`
    );
  });

  test('collision key opt_in parses as in operator by default', () => {
    expect(where(sqlite3, { meta: { opt_in: ['a', 'b'] } })).toBe(
      `json_extract("user"."meta", '$.opt') in ('a', 'b')`
    );
  });

  test('explicit $ operators reach a literal collision key', () => {
    expect(where(sqlite3, { meta: { opt_in: { $eq: 'x' } } })).toBe(
      `json_extract("user"."meta", '$.opt_in') = 'x'`
    );
  });

  test('explicit multi-operator object is a range', () => {
    expect(where(sqlite3, { meta: { age: { $gt: 18, $lt: 65 } } })).toBe(
      `(json_extract("user"."meta", '$.age') > 18) and (json_extract("user"."meta", '$.age') < 65)`
    );
  });

  test('explicit and suffix forms produce identical SQL', () => {
    expect(where(sqlite3, { meta: { age: { $gt: 18 } } })).toBe(where(sqlite3, { meta: { age_gt: 18 } }));
  });

  test('suffix mode rejects explicit operator objects', () => {
    expect(() => where(sqlite3, { meta: { age: { $gt: 18 } } }, { operatorSyntax: 'suffix' })).toThrow();
  });

  test('explicit mode never splits suffixes', () => {
    expect(where(sqlite3, { meta: { age_gt: 5 } }, { operatorSyntax: 'explicit' })).toBe(
      `json_extract("user"."meta", '$.age_gt') = 5`
    );
  });

  test('__ delimiter avoids single-underscore collisions', () => {
    expect(where(sqlite3, { meta: { opt_in: 'x', age__gt: 5 } }, { operatorDelimiter: '__' })).toBe(
      `(json_extract("user"."meta", '$.opt_in') = 'x') and (json_extract("user"."meta", '$.age') > 5)`
    );
  });

  test('encodeFilter honors passed jsonFilterOptions', () => {
    expect(
      encodeFilter({ meta: { rank__gt: 2 } }, jsonModel(), sqlite3, undefined, {
        operatorDelimiter: '__',
      })
    ).toBe(`json_extract("user"."meta", '$.rank') > 2`);
  });
});

describe('json filter errors', () => {
  test('mixed operator and field object is rejected', () => {
    expect(() => where(sqlite3, { meta: { x: { $gt: 1, city: 'NYC' } } })).toThrow(/mixed/i);
  });

  test('reserved $-prefixed literal key is rejected', () => {
    expect(() => where(sqlite3, { meta: { $ref: 'x' } })).toThrow(/reserved/i);
  });

  test('unknown explicit operator is rejected', () => {
    expect(() => where(sqlite3, { meta: { age: { $foo: 18 } } })).toThrow(/unknown json operator/i);
  });

  test('top-level operator on a json object is rejected', () => {
    expect(() => where(sqlite3, { meta_ne: { a: 1 } })).toThrow(/cannot take an object value/i);
  });

  test('invalid path segment is rejected', () => {
    expect(() => where(sqlite3, { meta: { 'a b': 'x' } })).toThrow(/bad json path segment/i);
  });

  test('unsupported dialect is rejected', () => {
    const generic: DialectEncoder = { ...sqlite3, dialect: 'generic' };
    expect(() => where(generic, { meta: { name: 'x' } })).toThrow(/not supported/i);
  });

  test('empty json object is skipped', () => {
    expect(where(sqlite3, { meta: {} })).toBe('');
  });

  test('top-level dotted json path is not handled here', () => {
    // 'meta.address' is not a foreign key, so model field resolution rejects it.
    expect(() => where(sqlite3, { 'meta.address.city': 'NYC' })).toThrow();
  });
});

describe('whole-column behavior is unchanged', () => {
  test('null comparison stays on the normal expr path', () => {
    expect(where(sqlite3, { meta: null })).toBe(`"user"."meta" is null`);
  });

  test('not-null comparison stays on the normal expr path', () => {
    expect(where(sqlite3, { meta_ne: null })).toBe(`"user"."meta" is not null`);
  });
});
