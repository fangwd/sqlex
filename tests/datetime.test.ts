import { runtimeOf } from '../src/record';
import { Schema } from '../src/schema';
import * as helper from './helper';

const NAME = 'datetime';

beforeAll(() => helper.createDatabase(NAME));
afterAll(() => helper.dropDatabase(NAME));

describe('datetime', () => {
  test('read/write', async () => {
    const db = helper.connectToDatabase(NAME);
    const table = db.table('service_log');
    const inputDate = new Date();
    await table.mock({ id: 100, serviceTime: inputDate });
    const row = (await table.select('*', { where: { id: 100 } }))[0];
    const outputDate = new Date(row.serviceTime as unknown as string);
    // MySQL seems to be rounding the fractional part of a datetime when selected
    expect(Math.round(inputDate.getTime() / 1000)).toBe(Math.round(outputDate.getTime() / 1000));
    await db.cleanup();
    db.end();
  });
  test('read/write (null)', async () => {
    const db = helper.connectToDatabase(NAME);
    const table = db.table('service_log');
    await table.mock({ id: 100, serviceTime: null});
    const row = (await table.select('*', { where: { id: 100 } }))[0];
    expect(row.serviceTime).toBe(null);
    await db.cleanup();
    db.end();
  });

  test('unique keys distinguish datetimes within the same second', async () => {
    const schema = new Schema({
      name: NAME,
      tables: [{
        name: 'reading',
        columns: [
          { name: 'id', type: 'integer', autoIncrement: true, nullable: false },
          { name: 'taken_at', type: 'datetime', nullable: false },
        ],
        constraints: [
          { primaryKey: true, columns: ['id'] },
          { unique: true, columns: ['taken_at'] },
        ],
      }],
    });
    const db = helper.connectToDatabase(NAME, schema);
    const table = db.table('reading');
    const early = table.append({ takenAt: new Date('2024-01-02T03:04:05.100Z') });
    const late = table.append({ takenAt: new Date('2024-01-02T03:04:05.900Z') });

    expect(late).not.toBe(early);

    const key = table.model.uniqueKeys.find(uniqueKey => !uniqueKey.primary)!;
    expect(runtimeOf(early).uniqueValue(key)).toBe('["2024-01-02t03:04:05.100z"]');
    expect(runtimeOf(late).uniqueValue(key)).toBe('["2024-01-02t03:04:05.900z"]');

    await db.end();
  });
});
