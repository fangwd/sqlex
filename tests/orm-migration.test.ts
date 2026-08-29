import { inspect } from 'util';
import {
  Database,
  MigrationCompiler,
  MigrationRunner,
  Record,
  RecordSet,
  defineMigration,
  defineRecord,
  field,
  makeMigration,
  migrationChecksum,
  migrationSchemaFromRecords,
  schemaFromRecords,
  operation,
  sqlDefault,
} from '../src';
import { runtimeOf } from '../src/record';
import { SimpleField } from '../src/schema';
import * as helper from './helper';

const NAME = 'orm_migration';

class Task extends defineRecord({
  table: 'orm_task',
  fields: {
    id: field.integer({ primaryKey: true, generated: true }),
    title: field.string({ maxLength: 200, index: true }),
    done: field.boolean({ default: false }),
    createdAt: field.datetime({
      column: 'created_at',
      default: sqlDefault('CURRENT_TIMESTAMP'),
    }),
  },
}) {
  get label() {
    return `${this.id}:${this.title}`;
  }
}

class TaskV2 extends defineRecord({
  table: 'orm_task',
  fields: {
    id: field.integer({ primaryKey: true, generated: true }),
    title: field.string({ maxLength: 200, index: true }),
    done: field.boolean({ default: false }),
    createdAt: field.datetime({
      column: 'created_at',
      default: sqlDefault('CURRENT_TIMESTAMP'),
    }),
    note: field.text({ nullable: true }),
  },
}) {}

class Project extends defineRecord({
  table: 'orm_project',
  fields: {
    id: field.id(),
    name: field.string({ maxLength: 100, unique: true }),
  },
}) {
  declare issues: RecordSet<Issue>;
}

class Issue extends defineRecord({
  table: 'orm_issue',
  fields: {
    id: field.integer({ primaryKey: true, generated: true }),
    project: field.foreignKey(() => Project, {
      relatedName: 'issues',
      onDelete: 'cascade',
    }),
    title: field.string({ maxLength: 200 }),
  },
}) {}

class TypedOnly extends defineRecord({
  table: 'typed_only',
  fields: {
    id: field.integer({ primaryKey: true, generated: true }),
    priority: field.enum({
      values: ['low', 'high'],
      default: 'low',
    }),
  },
}) {}

class Category extends Record {
  static readonly definition = {
    table: 'typed_category',
    fields: {
      id: field.integer({ primaryKey: true, generated: true }),
      parent: field.foreignKey('self', { nullable: true }),
      name: field.string({ maxLength: 100 }),
    },
  } as const;

  declare id: number;
  declare parent: Category | null;
  declare name: string;
}

function assertModelTypes(record: InstanceType<typeof TypedOnly>) {
  const priority: 'low' | 'high' = record.priority;
  // @ts-expect-error enum fields retain their literal union
  const invalid: 'urgent' = record.priority;
  return { priority, invalid };
}
void assertModelTypes;

function assertFieldTypes() {
  field.enum({ values: ['low', 'high'], default: 'low' });
  // @ts-expect-error enum defaults must be one of the declared values
  field.enum({ values: ['low', 'high'], default: 'urgent' });
}
void assertFieldTypes;

function assertRecordApi(record: InstanceType<typeof Task>) {
  record.save();
  record.refresh();
  record.toJSON();
  // @ts-expect-error runtime state is intentionally absent from the model API
  void record.__state;
  // @ts-expect-error arbitrary undeclared fields are rejected
  void record.notAField;
}
void assertRecordApi;

beforeAll(() => helper.createDatabase(NAME, false));
afterAll(() => helper.dropDatabase(NAME));

test('generated migration and typed records work together', async () => {
  const db = helper.connectToDatabase(NAME) as Database;
  const initial = makeMigration('0001_tasks', { Task, Project, Issue });
  expect(initial.warnings).toEqual([]);

  const runner = new MigrationRunner(db);
  const dryRun = await runner.up([initial.migration], { dryRun: true });
  expect(dryRun.applied).toEqual([]);
  expect(dryRun.sql.join('\n')).toContain('create table');
  // nothing is applied yet, so there is nothing to revert
  expect((await runner.down([initial.migration], 1, { dryRun: true })).sql)
    .toEqual([]);

  const applied = await runner.up([initial.migration]);
  expect(applied.applied).toEqual(['0001_tasks']);
  expect((await runner.status([initial.migration]))[0].applied).toBe(true);

  // dry runs consult the ledger and unknown targets are rejected
  expect((await runner.up([initial.migration], { dryRun: true })).sql)
    .toEqual([]);
  await expect(runner.up([initial.migration], { target: 'nope' }))
    .rejects.toThrow('Unknown migration target');

  const models = db.bind({ Task, Project, Issue });
  const task = await models.Task.objects.create({ title: 'Ship ORM' });
  expect(task).toBeInstanceOf(Task);
  expect(task).toBeInstanceOf(Record);
  expect(task.id).toBeGreaterThan(0);
  expect(task.title).toBe('Ship ORM');
  expect(task.done).toBe(false);
  expect(task.label).toContain('Ship ORM');
  expect(Object.keys(task)).toEqual([]);
  expect(task.toJSON()).toEqual(expect.objectContaining({
    id: task.id,
    title: 'Ship ORM',
    done: false,
  }));
  expect(task.createdAt).toBeInstanceOf(Date);
  expect(JSON.parse(JSON.stringify(task))).toEqual(
    JSON.parse(JSON.stringify(task.toJSON()))
  );

  expect(inspect(task)).toContain('Ship ORM');

  // class-field initializers are not model data; reads reflect the runtime
  class InitialisedTask extends Task {
    title = 'shadowed';
  }
  const initialised = new InitialisedTask(db.table('orm_task'));
  initialised.title = 'assigned';
  expect(initialised.title).toBe('assigned');

  task.done = true;
  await task.save();

  // managers are flat; `.objects` remains as a Django-style alias
  const selected = await models.Task
    .filter({ done: true })
    .orderBy('title');
  expect(selected).toHaveLength(1);
  expect(selected[0]).toBeInstanceOf(Task);
  expect(selected[0].done).toBe(true);
  expect(models.Task.objects).toBe(models.Task);
  expect(models.Task.record).toBe(Task);

  expect(await models.Task.filter({ done: true }).exists()).toBe(true);
  expect(await models.Task.filter({ done: false }).exists()).toBe(false);

  const iterated: string[] = [];
  for await (const item of models.Task.query()) {
    iterated.push(item.title);
  }
  expect(iterated).toEqual(['Ship ORM']);

  const project = models.Project.objects.build({ name: 'sqlex' });
  const issue = await models.Issue.objects.create({
    project,
    title: 'Typed relations',
  });
  expect(issue.project.id).toBe(project.id);

  const loadedIssue = await models.Issue.objects
    .filter({ title: 'Typed relations' })
    .select({ project: '*' })
    .first();
  expect(loadedIssue?.project).toBeInstanceOf(Project);
  expect(loadedIssue?.project.name).toBe('sqlex');

  // reverse relations are typed through the declared RecordSet
  const related = await project.issues.all();
  expect(related).toHaveLength(1);
  expect(related[0]).toBeInstanceOf(Issue);
  expect(related[0].title).toBe('Typed relations');

  // foreign keys accept plain key values when writing
  const byId = await models.Issue.create({
    project: project.id,
    title: 'By id',
  });
  expect(byId.project.id).toBe(project.id);

  // persisted records may point a foreign key at a different parent
  const other = await models.Project.create({ name: 'other' });
  byId.project = other;
  await byId.save();
  const moved = await models.Issue
    .filter({ title: 'By id' })
    .select({ project: '*' })
    .first();
  expect(moved?.project.id).toBe(other.id);

  const [found, foundCreated] = await models.Project.getOrCreate({
    name: 'sqlex',
  });
  expect(foundCreated).toBe(false);
  expect(found.id).toBe(project.id);
  const [made, madeCreated] = await models.Project.getOrCreate({
    name: 'made-up',
  });
  expect(madeCreated).toBe(true);
  expect(made.id).toBeGreaterThan(0);

  // losing an insert race adopts the winning row instead of updating it
  const dupe = models.Project.build({ name: 'sqlex' });
  runtimeOf(dupe).insertOnly = true;
  await dupe.save();
  expect(runtimeOf(dupe).isInserted()).toBe(false);
  expect(dupe.id).toBe(project.id);

  const raced = await Promise.all([
    models.Project.getOrCreate({ name: 'raced' }),
    models.Project.getOrCreate({ name: 'raced' }),
  ]);
  expect(raced[0][0].id).toBe(raced[1][0].id);
  expect(raced.filter(([, created]) => created)).toHaveLength(1);

  // persistence setup failures reject instead of leaving save() pending
  const failingConnection = await db.pool.getConnection();
  const originalQuery = failingConnection._query.bind(failingConnection);
  jest.spyOn(failingConnection, '_query').mockImplementation((statement, pk) =>
    statement === 'SAVEPOINT sp'
      ? Promise.reject(new Error('savepoint failed'))
      : originalQuery(statement, pk)
  );
  const connectionSpy = jest.spyOn(db.pool, 'getConnection')
    .mockResolvedValueOnce(failingConnection);
  const failed = models.Project.build({ name: 'save-failure' });
  await expect(failed.save()).rejects.toThrow('savepoint failed');
  expect(runtimeOf(failed).isDirty()).toBe(true);
  connectionSpy.mockRestore();

  // unsaved records are write-once graph nodes
  const draftProject = models.Project.build({ name: 'draft1' });
  const draftIssue = models.Issue.build({
    project: draftProject,
    title: 'draft',
  });
  expect(() => {
    draftIssue.project = models.Project.build({ name: 'draft2' });
  }).toThrow('Reassigning');
  draftIssue.project = draftProject; // the same parent is fine

  // bulk statements reject sliced or ordered query sets
  expect(() => models.Task.filter({ done: true }).limit(1).delete())
    .toThrow('limit');
  expect(() => models.Task.query().orderBy('title').update({ done: false }))
    .toThrow('orderBy');

  await models.Task.filter({ done: true }).update({ done: false });
  expect(await models.Task.filter({ done: true }).exists()).toBe(false);
  await models.Issue.filter({ title: 'By id' }).delete();
  expect(await models.Issue.count()).toBe(1);

  expect(() => db.bind({ Task })).toThrow('already bound');

  const additive = makeMigration(
    '0002_task_note',
    { Task: TaskV2, Project, Issue },
    initial.migration
  );
  expect(additive.warnings).toEqual([]);
  expect(additive.migration.up).toEqual([
    expect.objectContaining({
      kind: 'addColumn',
      table: 'orm_task',
      column: expect.objectContaining({ name: 'note' }),
    }),
  ]);
  await runner.up([initial.migration, additive.migration]);

  const status = await runner.status([initial.migration, additive.migration]);
  expect(status.map(item => item.applied)).toEqual([true, true]);
  expect(
    (await runner.baseline([initial.migration, additive.migration])).applied
  ).toEqual([]);
  expect(migrationChecksum(initial.migration)).toHaveLength(64);
  const changedInitial = defineMigration({
    ...initial.migration,
    up: [...initial.migration.up, operation.sql('select 1')],
  });
  await expect(
    runner.up([changedInitial, additive.migration])
  ).rejects.toThrow('Applied migration changed');
  const changedRollback = defineMigration({
    ...additive.migration,
    down: [operation.sql('select 1')],
  });
  await expect(
    runner.down([initial.migration, changedRollback])
  ).rejects.toThrow('Applied migration changed');
  await expect(
    runner.down([initial.migration, changedRollback], 1, { dryRun: true })
  ).rejects.toThrow('Applied migration changed');

  await runner.down([initial.migration, additive.migration], 2);
  await db.end();
});

test('destructive schema differences require an explicit migration', () => {
  const initial = makeMigration('0001_tasks', { Task }).migration;
  const stripped = makeMigration(
    '0002_remove_fields',
    {
      Task: class extends defineRecord({
        table: 'orm_task',
        fields: {
          id: field.integer({ primaryKey: true, generated: true }),
        },
      }) {},
    },
    initial
  );
  expect(stripped.migration.up).toEqual([]);
  expect(stripped.warnings).toEqual(
    expect.arrayContaining([
      expect.stringContaining('destructive changes are not generated'),
    ])
  );
});

test('required column additions require an explicit backfill migration', () => {
  const initial = makeMigration('0001_tasks', { Task }).migration;
  const required = makeMigration(
    '0002_required_note',
    {
      Task: class extends defineRecord({
        table: 'orm_task',
        fields: {
          id: field.integer({ primaryKey: true, generated: true }),
          title: field.string({ maxLength: 200, index: true }),
          done: field.boolean({ default: false }),
          createdAt: field.datetime({
            column: 'created_at',
            default: sqlDefault('CURRENT_TIMESTAMP'),
          }),
          note: field.string({ index: true, unique: true }),
        },
      }) {},
    },
    initial
  );
  expect(required.migration.up).toEqual([]);
  expect(required.warnings).toEqual([
    expect.stringContaining('explicit backfill migration'),
  ]);

  const nullDefault = makeMigration(
    '0002_null_note',
    {
      Task: class extends defineRecord({
        table: 'orm_task',
        fields: {
          id: field.integer({ primaryKey: true, generated: true }),
          title: field.string({ maxLength: 200, index: true }),
          done: field.boolean({ default: false }),
          createdAt: field.datetime({
            column: 'created_at',
            default: sqlDefault('CURRENT_TIMESTAMP'),
          }),
          note: field.text({ default: null }),
        },
      }) {},
    },
    initial
  );
  expect(nullDefault.migration.up).toEqual([]);
  expect(nullDefault.warnings[0]).toContain('explicit backfill migration');
});

test('generated migrations reject mutually cyclic new tables', () => {
  class CycleA extends defineRecord({
    table: 'cycle_a',
    fields: {
      id: field.id(),
      b: field.foreignKey('cycle_b'),
    },
  }) {}
  class CycleB extends defineRecord({
    table: 'cycle_b',
    fields: {
      id: field.id(),
      a: field.foreignKey('cycle_a'),
    },
  }) {}

  expect(() => makeMigration('0001_cycle', { CycleA, CycleB }))
    .toThrow('cyclic foreign keys');
});

test('migration checksums cover rollback operations and schema snapshots', () => {
  const migration = defineMigration({
    id: '0001_checksum',
    up: [operation.sql('select 1')],
    down: [operation.sql('select 2')],
    schema: { name: '', tables: [] },
  });
  const changedDown = defineMigration({
    ...migration,
    down: [operation.sql('select 3')],
  });
  const changedSchema = defineMigration({
    ...migration,
    schema: {
      name: '',
      tables: [{
        name: 'added',
        columns: [],
        constraints: [],
        indexes: [],
      }],
    },
  });

  expect(migrationChecksum(changedDown)).not.toBe(migrationChecksum(migration));
  expect(migrationChecksum(changedSchema)).not.toBe(migrationChecksum(migration));
});

test('dry runs propagate ledger errors other than a missing table', async () => {
  const failure = Object.assign(new Error('permission denied'), {
    code: 'SQLITE_ERROR',
  });
  const connection = {
    dialect: 'sqlite3' as const,
    _query: jest.fn().mockRejectedValue(failure),
    release: jest.fn(),
  };
  const pool = {
    dialect: 'sqlite3' as const,
    escape: (value: string) => `'${value}'`,
    escapeId: (value: string) => `"${value}"`,
    escapeDate: (value: Date) => `'${value.toISOString()}'`,
    getConnection: jest.fn().mockResolvedValue(connection),
  };
  const runner = new MigrationRunner({
    pool,
  } as unknown as Database);
  const migration = defineMigration({
    id: '0001_permissions',
    up: [operation.sql('select 1')],
    down: [operation.sql('select 1')],
  });

  await expect(runner.up([migration], { dryRun: true }))
    .rejects.toThrow('permission denied');
  expect(connection.release).toHaveBeenCalled();
  expect(() => runner.plan([migration, migration]))
    .toThrow('Duplicate migration id');
  await expect(runner.down([migration], 0))
    .rejects.toThrow('Invalid migration count');
});

test('explicit record classes support self references', () => {
  const migration = makeMigration('0001_category', { Category }).migration;
  const table = migration.schema?.tables[0];
  expect(table?.constraints).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        references: expect.objectContaining({ table: 'typed_category' }),
      }),
    ])
  );
});

test('a failed migration rolls back and is not recorded', async () => {
  const db = helper.connectToDatabase(NAME) as Database;
  const runner = new MigrationRunner(db);
  await db.query('create table rollback_check (id integer primary key)');
  const bad = defineMigration({
    id: '0099_bad_migration',
    up: [
      operation.sql([
        'insert into rollback_check values (1)',
        'insert into missing_table values (1)',
      ]),
    ],
    down: [operation.sql('delete from rollback_check')],
  });

  await expect(runner.up([bad])).rejects.toThrow();
  const rows = await db.query<Array<{ count: number | string }>>(
    'select count(*) as count from rollback_check'
  );
  expect(Number(rows[0].count)).toBe(0);
  expect((await runner.status([bad]))[0].applied).toBe(false);
  await db.query('drop table rollback_check');
  await db.end();
});

test('baseline rejects incompatible column behavior', async () => {
  class BaselineRecord extends defineRecord({
    table: 'baseline_bad_column',
    fields: {
      id: field.id(),
      name: field.string({ maxLength: 100 }),
    },
  }) {}
  const db = helper.connectToDatabase(NAME) as Database;
  const runner = new MigrationRunner(db);
  const migration = makeMigration('0100_baseline_column', {
    BaselineRecord,
  }).migration;
  await db.query(
    'create table baseline_bad_column ' +
    '(id integer primary key, name varchar(50))'
  );

  try {
    await expect(runner.baseline([migration]))
      .rejects.toThrow('Database does not match');
  } finally {
    await db.query('drop table baseline_bad_column');
    await db.end();
  }
});

test('baseline rejects changed defaults and referential actions', async () => {
  class BaselineParent extends defineRecord({
    table: 'baseline_parent',
    fields: {
      id: field.string({ maxLength: 20, primaryKey: true }),
    },
  }) {}
  class BaselineChild extends defineRecord({
    table: 'baseline_child',
    fields: {
      id: field.string({ maxLength: 20, primaryKey: true }),
      parent: field.foreignKey(() => BaselineParent, {
        onDelete: 'cascade',
      }),
      enabled: field.boolean({ default: false }),
    },
  }) {}
  const db = helper.connectToDatabase(NAME) as Database;
  const runner = new MigrationRunner(db);
  const migration = makeMigration('0101_baseline_semantics', {
    BaselineParent,
    BaselineChild,
  }).migration;
  for (const statement of runner.plan([migration])) {
    await db.query(
      statement
        .replace(/default false/i, 'default true')
        .replace(/ on delete cascade/i, '')
    );
  }

  try {
    let message = '';
    try {
      await runner.baseline([migration]);
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain('has default');
    expect(message).toContain('missing constraint');
  } finally {
    await db.query('drop table baseline_child');
    await db.query('drop table baseline_parent');
    await db.end();
  }
});

test('reconcile applies additive changes and reports the rest', async () => {
  class Author extends defineRecord({
    table: 'reconcile_author',
    fields: {
      id: field.id(),
      name: field.string({ maxLength: 100 }),
    },
  }) {}
  class AuthorV2 extends defineRecord({
    table: 'reconcile_author',
    fields: {
      id: field.id(),
      name: field.string({ maxLength: 100, index: true }),
      bio: field.text({ nullable: true }),
      active: field.boolean({ default: true }),
    },
  }) {}
  class Book extends defineRecord({
    table: 'reconcile_book',
    fields: {
      id: field.id(),
      author: field.foreignKey(() => AuthorV2),
      title: field.string({ maxLength: 200 }),
    },
  }) {}
  class AuthorV3 extends defineRecord({
    table: 'reconcile_author',
    fields: {
      id: field.id(),
      name: field.string({ maxLength: 50, index: true }),
      active: field.boolean({ default: true }),
      rating: field.integer(),
    },
  }) {}
  class AuthorV4 extends defineRecord({
    table: 'reconcile_author',
    fields: {
      id: field.id(),
      name: field.string({ maxLength: 50, index: true, nullable: true }),
      active: field.boolean({ default: false }),
    },
  }) {}
  const db = helper.connectToDatabase(NAME) as Database;
  const runner = new MigrationRunner(db);

  try {
    const created = await runner.reconcile({ Author });
    expect(created.join('\n')).toContain('create table');
    expect(await runner.reconcile({ Author })).toEqual([]);

    const planned = await runner.reconcile(
      { Author: AuthorV2, Book },
      { dryRun: true }
    );
    expect(planned.join('\n')).toContain('add column');
    expect(planned.join('\n')).toContain('create index');
    expect(planned.join('\n')).toContain('create table');
    expect(await runner.reconcile({ Author })).toEqual([]);

    expect(await runner.reconcile({ Author: AuthorV2, Book })).toEqual(planned);
    expect(await runner.reconcile({ Author: AuthorV2, Book })).toEqual([]);

    const models = db.bind({ Author: AuthorV2, Book });
    const author = await models.Author.objects.create({ name: 'Ann' });
    expect(author.active).toBe(true);
    expect(author.bio).toBeNull();
    const book = await models.Book.objects.create({ author, title: 'Ants' });
    expect(book.id).toBeGreaterThan(0);

    let message = '';
    try {
      await runner.reconcile({ Author: AuthorV3, Book });
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain('cannot be reconciled automatically');
    expect(message).toContain(
      'missing column reconcile_author.rating is required and has no default'
    );
    expect(message).toContain('column reconcile_author.name has dimensions');
    expect(message).toContain('column reconcile_author.bio is not declared');
    expect(await runner.reconcile({ Author: AuthorV2, Book })).toEqual([]);

    // destructive: alter changed columns and drop undeclared ones
    const destructive = { destructive: true };
    if (helper.isSqlite3(db.pool.dialect)) {
      await expect(runner.reconcile({ Author: AuthorV4, Book }, destructive))
        .rejects.toThrow('SQLite cannot alter columns');
      return;
    }
    const altered = await runner.reconcile({ Author: AuthorV4, Book }, destructive);
    expect(altered.join('\n')).toMatch(/alter column|modify column/);
    expect(altered.join('\n')).toContain('drop column');
    expect(await runner.reconcile({ Author: AuthorV4, Book })).toEqual([]);
    const rows = await db.query('select * from reconcile_author');
    expect(rows[0]).not.toHaveProperty('bio');
    expect(rows[0].name).toBe('Ann');
  } finally {
    await db.query('drop table if exists reconcile_book');
    await db.query('drop table if exists reconcile_author');
    await db.end();
  }
});

test('a decimal keeps its precision and scale in the derived schema', () => {
  class Invoice extends defineRecord({
    table: 'orm_invoice',
    fields: {
      id: field.id(),
      total: field.decimal({ precision: 12, scale: 2 }),
      rate: field.decimal({ precision: 5 }),
      plain: field.decimal(),
      count: field.integer(),
    },
  }) {}

  // The runtime schema carries them, so anything reading a column back knows
  // the declared scale, not just the migration that created it.
  const schema = schemaFromRecords({ Invoice });
  const columnOf = (name: string) =>
    (schema.model('Invoice')?.field(name) as SimpleField).column;

  expect(columnOf('total')).toEqual(
    expect.objectContaining({ type: 'decimal', precision: 12, scale: 2 })
  );
  expect(columnOf('rate')).toEqual(
    expect.objectContaining({ precision: 5, scale: undefined })
  );
  expect(columnOf('plain').precision).toBe(undefined);
  expect(columnOf('count').precision).toBe(undefined);

  // And the DDL is unchanged by where those values now come from.
  const encoder = {
    dialect: 'postgres' as const,
    escape: (value: string) => `'${value}'`,
    escapeId: (value: string) => `"${value}"`,
    escapeDate: (value: Date) => `'${value.toISOString()}'`,
  };
  const { migration } = makeMigration('0001_invoices', { Invoice });
  const create = migration.up.find(item => item.kind === 'createTable')!;
  const sql = new MigrationCompiler('postgres', encoder).compile(create)[0];
  expect(sql).toContain('"total" decimal(12,2)');
  expect(sql).toContain('"rate" decimal(5,0)');
  expect(sql).toContain('"plain" decimal');

  // The snapshot the checksum covers is the same either way.
  const snapshot = migrationSchemaFromRecords({ Invoice });
  expect(snapshot.tables[0].columns.find(column => column.name === 'total')).toEqual(
    expect.objectContaining({ precision: 12, scale: 2 })
  );
});

test('reconcile reports undeclared constraints and drops them destructively', async () => {
  class Tag extends defineRecord({
    table: 'reconcile_tag',
    fields: {
      id: field.id(),
      code: field.string({ maxLength: 20, unique: true }),
    },
  }) {}
  class TagV2 extends defineRecord({
    table: 'reconcile_tag',
    fields: {
      id: field.id(),
      code: field.string({ maxLength: 20 }),
    },
  }) {}
  class TagV3 extends defineRecord({
    table: 'reconcile_tag',
    fields: {
      id: field.id(),
      code: field.string({ maxLength: 20 }),
    },
    indexes: [{ fields: ['code'], unique: true }],
  }) {}
  const db = helper.connectToDatabase(NAME) as Database;
  const runner = new MigrationRunner(db);
  const destructive = { destructive: true };

  try {
    await runner.reconcile({ Tag });
    await expect(runner.reconcile({ Tag: TagV2 }))
      .rejects.toThrow(/constraint reconcile_tag\..* is not declared/);
    if (helper.isSqlite3(db.pool.dialect)) {
      await expect(runner.reconcile({ Tag: TagV2 }, destructive))
        .rejects.toThrow('is not declared');
      return;
    }
    const sql = await runner.reconcile({ Tag: TagV2 }, destructive);
    expect(sql.join('\n')).toMatch(/drop (constraint|index)/);
    expect(await runner.reconcile({ Tag: TagV2 })).toEqual([]);

    // a declared unique index is not mistaken for an undeclared constraint
    expect((await runner.reconcile({ Tag: TagV3 })).join('\n'))
      .toContain('create unique index');
    expect(await runner.reconcile({ Tag: TagV3 })).toEqual([]);
  } finally {
    await db.query('drop table if exists reconcile_tag');
    await db.end();
  }
});

test('destructive reconcile converges or reports, never loops', async () => {
  class Plain extends defineRecord({
    table: 'reconcile_plain',
    fields: {
      id: field.id(),
      name: field.string({ maxLength: 100 }),
    },
  }) {}
  const db = helper.connectToDatabase(NAME) as Database;
  const runner = new MigrationRunner(db);
  await db.query(
    'create table reconcile_plain ' +
    '(id integer not null primary key, name varchar(100) not null)'
  );
  try {
    if (db.pool.dialect === 'postgres') {
      await expect(runner.reconcile({ Plain }, { destructive: true }))
        .rejects.toThrow('is not auto-incrementing');
      return;
    }
    await runner.reconcile({ Plain }, { destructive: true });
    expect(await runner.reconcile({ Plain })).toEqual([]);
  } finally {
    await db.query('drop table reconcile_plain');
    await db.end();
  }
});

test('reconcile accepts a native PostgreSQL enum and compares its values', async () => {
  const db = helper.connectToDatabase(NAME) as Database;
  if (db.pool.dialect !== 'postgres') {
    await db.end();
    return;
  }
  class Native extends defineRecord({
    table: 'reconcile_native',
    fields: {
      id: field.id(),
      level: field.enum({ values: ['low', 'high'], default: 'low' }),
    },
  }) {}
  class NativeV2 extends defineRecord({
    table: 'reconcile_native',
    fields: {
      id: field.id(),
      level: field.enum({ values: ['low', 'high', 'urgent'], default: 'low' }),
    },
  }) {}
  const runner = new MigrationRunner(db);
  await db.query("create type reconcile_level as enum ('low', 'high')");
  await db.query(
    'create table reconcile_native (id serial primary key, ' +
    "level reconcile_level not null default 'low')"
  );
  try {
    expect(await runner.reconcile({ Native })).toEqual([]);
    await expect(runner.reconcile({ Native: NativeV2 }))
      .rejects.toThrow('column reconcile_native.level has values');
    await runner.reconcile({ Native: NativeV2 }, { destructive: true });
    expect(await runner.reconcile({ Native: NativeV2 })).toEqual([]);
  } finally {
    await db.query('drop table reconcile_native');
    await db.query('drop type reconcile_level');
    await db.end();
  }
});

test('reconcile reads a MySQL schema that has check constraints', async () => {
  class Scored extends defineRecord({
    table: 'reconcile_scored',
    fields: {
      id: field.id(),
      score: field.integer(),
    },
    checks: [
      { name: 'reconcile_scored_range', expression: 'score >= 0 and score <= 10' },
    ],
  }) {}
  const db = helper.connectToDatabase(NAME) as Database;
  const runner = new MigrationRunner(db);
  try {
    expect((await runner.reconcile({ Scored })).join('\n'))
      .toContain('check (score >= 0 and score <= 10)');
    expect(await runner.reconcile({ Scored })).toEqual([]);
    expect(await runner.reconcile({ Scored }, { destructive: true }))
      .toEqual([]);
  } finally {
    await db.query('drop table reconcile_scored');
    await db.end();
  }
});

test('destructive reconcile drops a stale foreign key before its unique key', async () => {
  class Publisher extends defineRecord({
    table: 'reconcile_publisher',
    fields: {
      id: field.id(),
      code: field.string({ maxLength: 10 }),
    },
  }) {}
  class Edition extends defineRecord({
    table: 'reconcile_edition',
    fields: {
      id: field.id(),
      publisherCode: field.string({ maxLength: 10, column: 'publisher_code' }),
    },
  }) {}
  const db = helper.connectToDatabase(NAME) as Database;
  const runner = new MigrationRunner(db);
  const keyColumn = db.pool.dialect === 'postgres'
    ? 'id serial primary key'
    : db.pool.dialect === 'mysql'
      ? 'id integer not null auto_increment primary key'
      : 'id integer primary key';
  try {
    await db.query(
      'create table reconcile_publisher (' + keyColumn + ', ' +
      'code varchar(10) not null, ' +
      'constraint reconcile_publisher_code_key unique (code))'
    );
    await db.query(
      'create table reconcile_edition (' + keyColumn + ', ' +
      'publisher_code varchar(10) not null, ' +
      'constraint reconcile_edition_publisher_fkey ' +
      'foreign key (publisher_code) references reconcile_publisher (code))'
    );
    const destructive = { destructive: true };
    if (helper.isSqlite3(db.pool.dialect)) {
      await expect(
        runner.reconcile({ Publisher, Edition }, destructive)
      ).rejects.toThrow('is not declared');
      return;
    }
    const sql = await runner.reconcile({ Publisher, Edition }, destructive);
    const statements = sql.join('\n');
    expect(statements).toMatch(/drop (constraint|index|foreign key)/);
    expect(statements.indexOf('reconcile_edition_publisher_fkey'))
      .toBeLessThan(statements.indexOf('reconcile_publisher_code_key'));
    expect(await runner.reconcile({ Publisher, Edition })).toEqual([]);
  } finally {
    await db.query('drop table if exists reconcile_edition');
    await db.query('drop table if exists reconcile_publisher');
    await db.end();
  }
});

test('make generates alterColumn for changed columns', () => {
  const encoder = (dialect: 'postgres' | 'mysql' | 'sqlite3') => ({
    dialect,
    escape: (value: string) => `'${value.replace(/'/g, "''")}'`,
    escapeId: (value: string) =>
      dialect === 'mysql' ? `\`${value}\`` : `"${value}"`,
    escapeDate: (value: Date) => `'${value.toISOString()}'`,
  });
  class Widget extends defineRecord({
    table: 'orm_widget',
    fields: {
      id: field.id(),
      label: field.string({ maxLength: 50 }),
    },
  }) {}
  class WidgetV2 extends defineRecord({
    table: 'orm_widget',
    fields: {
      id: field.id(),
      label: field.text({ nullable: true, default: 'none' }),
    },
  }) {}
  const initial = makeMigration('0001_widget', { Widget }).migration;
  const changed = makeMigration('0002_widget', { Widget: WidgetV2 }, initial);
  expect(changed.warnings).toEqual([]);
  const [alter] = changed.migration.up;
  expect(alter).toEqual(expect.objectContaining({
    kind: 'alterColumn',
    table: 'orm_widget',
    column: expect.objectContaining({ name: 'label', type: 'text' }),
    from: expect.objectContaining({ name: 'label', type: 'varchar' }),
  }));
  expect(changed.migration.down[0]).toEqual(expect.objectContaining({
    kind: 'alterColumn',
    column: expect.objectContaining({ type: 'varchar', size: 50 }),
  }));

  expect(new MigrationCompiler('postgres', encoder('postgres')).compile(alter))
    .toEqual([
      'alter table "orm_widget" ' +
      'alter column "label" type text using "label"::text, ' +
      'alter column "label" drop not null, ' +
      "alter column \"label\" set default 'none'",
    ]);
  expect(new MigrationCompiler('mysql', encoder('mysql')).compile(alter))
    .toEqual(["alter table `orm_widget` modify column `label` text default 'none'"]);
  expect(() => new MigrationCompiler('sqlite3', encoder('sqlite3')).compile(alter))
    .toThrow('SQLite cannot alter columns');

  // Postgres stores an enum as text plus a check; widening it rewrites the check
  const enumAlter = operation.alterColumn('orm_widget', {
    name: 'level',
    type: 'enum',
    userDefinedType: { type: 'enum', name: 'level', values: ['low', 'high'] },
  });
  expect(new MigrationCompiler('postgres', encoder('postgres')).compile(enumAlter)[0])
    .toContain(
      'drop constraint if exists "orm_widget_level_check", ' +
      'add constraint "orm_widget_level_check" ' +
      'check ("level" in (\'low\', \'high\'))'
    );
  expect(new MigrationCompiler('mysql', encoder('mysql')).compile(enumAlter))
    .toEqual(["alter table `orm_widget` modify column `level` enum('low','high') not null"]);
});

test('dialect compilers emit engine-specific DDL', () => {
  const encoder = (dialect: 'postgres' | 'mysql' | 'sqlite3') => ({
    dialect,
    escape: (value: string) => `'${value.replace(/'/g, "''")}'`,
    escapeId: (value: string) =>
      dialect === 'mysql' ? `\`${value}\`` : `"${value}"`,
    escapeDate: (value: Date) => `'${value.toISOString()}'`,
  });
  const migration = makeMigration('0001_relations', { Project, Issue }).migration;
  const createProject = migration.up.find(
    item => item.kind === 'createTable' && item.table.name === 'orm_project'
  )!;
  const createIssue = migration.up.find(
    item => item.kind === 'createTable' && item.table.name === 'orm_issue'
  )!;

  const postgres = new MigrationCompiler('postgres', encoder('postgres'));
  expect(postgres.compile(createProject)[0]).toContain('"id" serial');
  expect(postgres.compile(createIssue)[0]).toContain('on delete cascade');

  const mysql = new MigrationCompiler('mysql', encoder('mysql'));
  expect(mysql.compile(createProject)[0]).toContain('auto_increment');
  expect(mysql.compile(createIssue)[0]).toContain('foreign key');

  const sqlite = new MigrationCompiler('sqlite3', encoder('sqlite3'));
  expect(sqlite.compile(createProject)[0]).toContain(
    '"id" integer primary key autoincrement'
  );

  const withFloat = makeMigration('0001_metrics', {
    Metric: class extends defineRecord({
      table: 'orm_metric',
      fields: {
        id: field.id(),
        score: field.float(),
      },
    }) {},
  }).migration;
  const createMetric = withFloat.up.find(item => item.kind === 'createTable')!;
  expect(postgres.compile(createMetric)[0]).toContain('"score" double precision');
  expect(mysql.compile(createMetric)[0]).toContain('`score` double');

  expect(() =>
    sqlite.compile({
      kind: 'addColumn',
      table: 'orm_task',
      column: {
        name: 'created_at',
        type: 'datetime',
        defaultSql: 'CURRENT_TIMESTAMP',
      },
    })
  ).toThrow('non-constant default');
});
