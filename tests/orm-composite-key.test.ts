import {
  Database,
  MigrationRunner,
  RecordSet,
  defineRecord,
  field,
  makeMigration,
} from '../src';
import * as helper from './helper';

const NAME = 'orm_composite_key';

class Team extends defineRecord({
  table: 'ock_team',
  fields: {
    id: field.id(),
    name: field.string({ maxLength: 60, unique: true }),
  },
}) {
  declare memberships: RecordSet<Membership>;
}

class Person extends defineRecord({
  table: 'ock_person',
  fields: {
    id: field.id(),
    email: field.string({ maxLength: 120, unique: true }),
  },
}) {
  declare memberships: RecordSet<Membership>;
}

/** The shape this is all for: a link table keyed by both of its foreign keys. */
class Membership extends defineRecord({
  table: 'ock_membership',
  fields: {
    team: field.foreignKey(() => Team, {
      primaryKey: true,
      relatedName: 'memberships',
      onDelete: 'cascade',
    }),
    person: field.foreignKey(() => Person, {
      primaryKey: true,
      relatedName: 'memberships',
      onDelete: 'cascade',
    }),
    role: field.string({ maxLength: 20, default: 'member' }),
  },
}) {}

/** A composite key over plain scalars, with a third column outside the key. */
class Reading extends defineRecord({
  table: 'ock_reading',
  fields: {
    sensor: field.string({ maxLength: 40, primaryKey: true }),
    slot: field.integer({ primaryKey: true }),
    value: field.float(),
  },
}) {}

beforeAll(() => helper.createDatabase(NAME, false));
afterAll(() => helper.dropDatabase(NAME));

test('a composite primary key becomes one constraint, not several', () => {
  const { migration, warnings } = makeMigration('0001_composite', {
    Team,
    Person,
    Membership,
    Reading,
  });
  expect(warnings).toEqual([]);

  const create = migration.up.find(
    op => op.kind === 'createTable' && op.table.name === 'ock_membership'
  );
  const primaries = (create as { table: { constraints: Array<{
    primaryKey?: boolean;
    columns: string[];
  }> } }).table.constraints.filter(constraint => constraint.primaryKey);

  expect(primaries).toHaveLength(1);
  expect(primaries[0].columns).toEqual(['team_id', 'person_id']);
});

test('composite keys round-trip through create, get, update and delete', async () => {
  const db = helper.connectToDatabase(NAME) as Database;
  const { migration } = makeMigration('0001_composite', {
    Team,
    Person,
    Membership,
    Reading,
  });
  await new MigrationRunner(db).up([migration]);

  const models = db.bind({ Team, Person, Membership, Reading });

  const team = await models.Team.create({ name: 'Platform' });
  const other = await models.Team.create({ name: 'Design' });
  const person = await models.Person.create({ email: 'alice@example.com' });

  // Foreign keys that are also key columns accept a record or a raw key.
  const membership = await models.Membership.create({
    team,
    person: person.id,
    role: 'owner',
  });
  expect(membership.role).toBe('owner');

  await models.Membership.create({ team: other, person: person.id });

  // The same person in two teams: only the pair is unique, not either half.
  expect(await models.Membership.filter({ person: person.id }).count()).toBe(2);

  const found = await models.Membership.get({ team: team.id, person: person.id });
  expect(found?.role).toBe('owner');

  await models.Membership
    .filter({ team: team.id, person: person.id })
    .update({ role: 'admin' });
  expect((await models.Membership.get({ team: team.id, person: person.id }))?.role)
    .toBe('admin');

  await models.Membership.filter({ team: other.id, person: person.id }).delete();
  expect(await models.Membership.filter({ person: person.id }).count()).toBe(1);

  // Reverse relations still resolve from either side of the key.
  expect((await team.memberships.all()).length).toBe(1);

  // A scalar composite key behaves the same way.
  await models.Reading.create({ sensor: 'north', slot: 1, value: 1.5 });
  await models.Reading.create({ sensor: 'north', slot: 2, value: 2.5 });
  await models.Reading.create({ sensor: 'south', slot: 1, value: 3.5 });
  expect(await models.Reading.filter({ sensor: 'north' }).count()).toBe(2);
  expect((await models.Reading.get({ sensor: 'south', slot: 1 }))?.value).toBe(3.5);

  await db.end();
});

test('a composite key cannot be generated or referenced by a foreign key', () => {
  expect(() =>
    makeMigration('0001_bad_generated', {
      Bad: class Bad extends defineRecord({
        table: 'ock_bad',
        fields: {
          id: field.integer({ primaryKey: true, generated: true }),
          part: field.string({ maxLength: 10, primaryKey: true }),
        },
      }) {},
    })
  ).toThrow('composite primary key');

  class Pair extends defineRecord({
    table: 'ock_pair',
    fields: {
      left: field.integer({ primaryKey: true }),
      right: field.integer({ primaryKey: true }),
    },
  }) {}

  class PointsAtPair extends defineRecord({
    table: 'ock_points_at_pair',
    fields: {
      id: field.id(),
      pair: field.foreignKey(() => Pair),
    },
  }) {}

  expect(() => makeMigration('0001_bad_fk', { Pair, PointsAtPair }))
    .toThrow('primary key is composite');
});
