import helper = require('./helper');

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
    const outputDate = new Date(row.serviceTime as string);
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

});
