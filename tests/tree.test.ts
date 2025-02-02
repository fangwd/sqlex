import * as helper from './helper';
import { Schema } from '../src/schema';

const NAME = 'tree';

beforeAll(() => helper.createDatabase(NAME, false));
afterAll(() => helper.dropDatabase(NAME));

test('create', async() => {
  const table = getDatabase().table('category');

  const root = await table.create({
    name: 'All',
    parent: null
  }) as any;

  const fruit = await table.create({
    name: 'Fruit',
    parent: { connect: { id: root.id } }
  });

  const apple = await table.create({
    name: 'Apple',
    parent: { connect: { id: fruit.id } }
  }) as any;

  const fuji = await table.create({
    name: 'Fuji',
    parent: { connect: { id: apple.id } }
  });

  const gala = await table.create({
    name: 'Gala',
    parent: { connect: { id: apple.id } }
  });

  let rows;

  rows = await table.getDescendants(root.id);
  expect(rows.length).toBe(5);

  rows = await table.getAncestors(apple.id);
  expect(rows.length).toBe(3);

  rows = await table.getDescendants(apple.id);
  expect(rows.length).toBe(3);

  await table.db.end();
});

test('update', async() => {
  const table = getDatabase().table('category');

  const data = [
    '1',
    ['1.1', '1.1.1', ['1.1.2', '1.1.2.1', '1.1.2.2']],
    ['1.2', '1.2.1', '1.2.2']
  ];

  await createTree(table, data, null);

  let node, parent, rows;

  node = (await table.select('*', { where: { name: '1.1.2' } }))[0];
  parent = (await table.select('*', { where: { name: '1.2.1' } }))[0];

  await table.modify({ description: 'description 1.1.2' }, node);

  rows = await table.getDescendants(parent.id);
  expect(rows.length).toBe(1);

  node = (await table.select('*', { where: { name: '1.1.2' } }))[0];
  await table.modify({ description: '', parent: { connect: parent } }, node);

  rows = await table.getDescendants(parent.id);
  expect(rows.length).toBe(4);

  const node1_1 = (await table.select('*', { where: { name: '1.1' } }))[0];

  rows = await table.getDescendants(node1_1);
  expect(rows.length).toBe(2);

  await table.db.end();
});

test('delete', async() => {
  const table = getDatabase().table('category');

  const data = [
    'd1',
    ['d1.1', 'd1.1.1', ['d1.1.2', 'd1.1.2.1', 'd1.1.2.2']],
    ['d1.2', 'd1.2.1', 'd1.2.2']
  ];

  await createTree(table, data, null);

  const root:any = (await table.select('*', { where: { name: 'd1.1' } }))[0];
  const node = (await table.select('*', { where: { name: 'd1.1.2' } }))[0];

  let rows;

  rows = await table.getDescendants(root.id);
  expect(rows.length).toBe(5);

  await table.delete(node);

  rows = await table.getDescendants(root.id);
  expect(rows.length).toBe(2);

  await table.db.end();
});

function getDatabase() {
  const config = {
    models: [
      {
        table: 'category',
        closureTable: {
          name: 'category_tree'
        }
      }
    ]
  };
  const schema = new Schema(helper.getExampleData(), config);
  return helper.connectToDatabase(NAME, schema);
}

async function createTree(table, data, parent) {
  const first = await table.create({
    parent: parent ? { connect: parent } : parent,
    name: data[0]
  });
  for (let i = 1; i < data.length; i++) {
    if (Array.isArray(data[i])) {
      await createTree(table, data[i], first);
    } else {
      await table.create({
        parent: { connect: first },
        name: data[i]
      });
    }
  }
}
