import { Schema } from '../src/schema';
import { Database } from '../src/database';
import { Record, runtimeOf, type DynamicRecord } from '../src/record';
import { SELECT_BATCH_SIZE } from '../src/flush';

import * as helper from './helper';
import type { UserRow } from './schema-types';

const NAME = 'flush';

beforeAll(() => helper.createDatabase(NAME));
afterAll(() => helper.dropDatabase(NAME));

test('append', () => {
  const schema = new Schema(helper.getExampleData());
  const db = new Database(null as any, schema);
  const user = db.append('user', { email: 'user@example.com' });
  const user2 = db.append('user', { email: 'user@example.com' });
  expect(user).toBe(user2);
  expect(user instanceof Record).toBe(true);
  expect(db.table('user').recordList.length).toBe(1);
  user.status = 200;
  expect(user.status).toBe(200);
  expect(() => (user.whatever = 200)).toThrow();
  db.end();
});

test('append #2', () => {
  const schema = new Schema(helper.getExampleData());
  const db = new Database(null as any , schema);
  const user = db.getModels().User({ email: 'user@example.com' });
  expect(user instanceof Record).toBe(true);
  expect(user.email).toBe('user@example.com');
  expect(user.get('email')).toBe('user@example.com');
  expect(runtimeOf(user).table).toBe(db.table('user'));
  expect(db.table('user').recordList.length).toBe(0);
  db.end();
});

test('delete', async () => {
  const schema = new Schema(helper.getExampleData());
  const db = helper.connectToDatabase(NAME, schema);
  const table = db.table('user');
  const id = await table.insert({ email: 'deleted@example.com' });
  const row = await table.get({ id });
  expect(row.email).toBe('deleted@example.com');
  const record = db.getModels().User({ email: 'deleted@example.com' });
  await record.delete();
  expect(await table.get({ id })).toBe(undefined);
  await db.end();
});

test('update', async () => {
  const schema = new Schema(helper.getExampleData());
  const db = helper.connectToDatabase(NAME, schema);
  const table = db.table('user');
  const id = await table.insert({ email: 'updated@example.com', status: 100 });
  const row = await table.get({ id });
  expect(row.status).toBe(100);
  const user = db.getModels().User({ email: 'updated@example.com' });
  await user.update({ status: 200 });
  expect((await table.get({ id })).status).toBe(200);
  await db.end();
});

test('save #1', async() => {
  const schema = new Schema(helper.getExampleData());
  const db = helper.connectToDatabase(NAME, schema);
  const user = db.getModels().User({ email: 'saved01@example.com' });
  user.save().then(async (row: UserRow) => {
    expect(row.email).toBe('saved01@example.com');
    const user = await db.table('user').get({ email: 'saved01@example.com' });
    expect(user.id).toBe(row.id);
    await db.end();
  });
});

test('save #2', async() => {
  const schema = new Schema(helper.getExampleData());
  const db = helper.connectToDatabase(NAME, schema);
  const models = db.getModels();
  const user = models.User({ email: 'saved02@example.com' });
  const order = models.Order({ code: 'saved02' });
  order.user = user;
  const saved = await user.save();
  await order.save();
  const saved2 = await db.table('order').get({ code: 'saved02' });
  expect((saved2.user as any).id).toBe(saved.id);
  await db.end();
});

test('save #3', async() => {
  const schema = new Schema(helper.getExampleData());
  const db = helper.connectToDatabase(NAME, schema);
  const models = db.getModels();
  const user = models.User({ email: 'saved03@example.com' });
  const order_1 = models.Order({ code: 'saved03-1', user });
  const order_2 = models.Order({ code: 'saved03-2', user });
  await Promise.all([order_1.save(), order_2.save()]).then(async () => {
    const saved_0 = await db
      .table('user')
      .get({ email: 'saved03@example.com' });
    const saved_1 = await db.table('order').get({ code: 'saved03-1' });
    const saved_2 = await db.table('order').get({ code: 'saved03-1' });
    expect((saved_1.user as any).id).toBe(saved_0.id);
    expect((saved_2.user as any).id).toBe(saved_0.id);
  });
  await db.end();
});

test('save #4', async() => {
  const schema = new Schema(helper.getExampleData());
  const db = helper.connectToDatabase(NAME, schema);
  const models = db.getModels();
  const user = models.User({ email: 'saved04@example.com' });
  const order_1 = models.Order({ code: 'saved04-1', user });
  const order_2 = models.Order({ code: 'saved04-2', user });
  user.status = order_2;
  await order_1.save();
  await user.save();
  const saved_0 = await db.table('user').get({ email: 'saved04@example.com' });
  const saved_1 = await db.table('order').get({ code: 'saved04-1' });
  const saved_2 = await db.table('order').get({ code: 'saved04-2' });
  expect((saved_1.user as any).id).toBe(saved_0.id);
  expect((saved_2.user as any).id).toBe(saved_0.id);
  expect(saved_0.status).toBe(saved_2.id);
  await db.end();
});

test('save #5', async() => {
  const schema = new Schema(helper.getExampleData());
  const db = helper.connectToDatabase(NAME, schema);
  const User = db.getModels().User;
  const email = 'saved05@example.com';
  const promises = [];
  promises.push(User({ email }).save());
  promises.push(User({ email, status: 200 }).save());
  promises.push(User({ email }).save());
  await Promise.all(promises).then(async () => {
    const user = await db.table('user').get({ email });
    expect(user.email).toBe(email);
    expect(user.status).toBe(200);
  });
  await db.end();
});

test('flush #1', async() => {
  const schema = new Schema(helper.getExampleData());
  const db = helper.connectToDatabase(NAME, schema);
  const table = db.table('category');
  let parent = table.append({ id: 1 });

  await table.insert({ name: 'Child 0', parent: 1 });
  for (let i = 0; i < 5; i++) {
    table.append({
      name: `Child ${i % 3}`,
      parent
    });
  }

  expect(table.recordList.length).toBe(4);

  table.clear();

  parent = table.append({ id: 1 });

  for (let i = 0; i < 5; i++) {
    const rec = table.append();
    rec.name = `Child ${i % 3}`;
    rec.parent = parent;
  }

  expect(table.recordList.length).toBe(6);
  expect(runtimeOf(table.recordList[1]).isDirty()).toBe(true);

  await db.flush();
  const rows = table.recordList;
  expect(runtimeOf(rows[3]).state.merged).toBe(null);
  expect(runtimeOf(rows[4]).state.merged).toBe(rows[1]);
  expect(runtimeOf(rows[5]).state.merged).toBe(rows[2]);
  let rec = await table.get({ id: rows[2].id });
  expect(rec.name).toBe('Child 1');
  await db.end();
});

test('flush #2', async() => {
  const schema = new Schema(helper.getExampleData());
  const db = helper.connectToDatabase(NAME, schema);
  let user = db.table('user').append();
  user.email = 'random';
  let order = db.table('order').append({ code: 'random' });
  order.user = user;
  user.status = order;

  await db.flush();

  user = await db.table('user').get({ email: 'random' });
  order = await db.table('order').get({ code: 'random' });
  expect(user.status).toBe(order.id);

  await db.end();
});

test('flush #3', async() => {
  const schema = new Schema(helper.getExampleData());
  const db = helper.connectToDatabase(NAME, schema);
  const email = helper.getId();
  const user = db.table('user').append({ email });

  const user2 = db.table('user').append();
  user2.email = email;

  const email2 = helper.getId();
  const user3 = db.table('user').append({ email: email2 });

  const code = helper.getId();

  const order = db.table('order').append({ code });
  order.user = user2;
  user2.status = order;

  const code2 = helper.getId();

  const order2 = db.table('order').append({ code: code2 });
  order2.user = user2;
  user3.status = order2;

  const { connection } = await db.flush();

  expect(connection.queryCounter.total).toBeLessThanOrEqual(10);

  {
    const user = await db.table('user').get({ email });
    const order = await db.table('order').get({ code });
    expect((order.user as any).id).toBe(user.id);
    expect(user.status).toBe(order.id);
    const user3 = await db.table('user').get({ email: email2 });
    const order2 = await db.table('order').get({ code: code2 });
    expect(user3.status).toBe(order2.id);
    expect((order2.user as any).id).toBe(user.id);
  }

  await db.end();
});

test('flush #4', async() => {
  if (process.env.DB_TYPE === 'sqlite3') {
    return;
  }

  const schema = new Schema(helper.getExampleData());

  // 3 connections
  const dbs = [...Array(3).keys()].map(x =>
    helper.connectToDatabase(NAME, schema)
  );

  // 5 users
  const emails = [...Array(5).keys()].map(x => helper.getId());

  // 10 orders
  const codes = [...Array(10).keys()].map(x => helper.getId());

  // Each user has a number of orders
  const map: { [key: string]: string[] } = {};
  emails.forEach((email, i) => {
    map[email] = [codes[2 * i], codes[2 * i + 1]];
  });

  dbs.forEach((db, index) => {
    for (let i = 0; i < 3; i++) {
      for (const email of emails) {
        const user = db.table('user').append({ email });
        let order;
        for (const code of map[email]) {
          order = db.table('order').append({
            code,
            user
          });
        }
        user.status = order;
      }
    }
  });

  const userCount = (await dbs[0].table('user').select('*')).length;
  const orderCount = (await dbs[0].table('order').select('*')).length;

  const promises = dbs.map(db => db.flush());

  await Promise.all(promises).then(async () => {
    const db = helper.connectToDatabase(NAME, schema);
    const users = await db.table('user').select('*');
    const orders = await db.table('order').select('*');
    expect(users.length).toBe(userCount + 5);
    expect(orders.length).toBe(orderCount + 10);
    let ok = true;
    for (const email in map) {
      const user = users.find(x => x.email === email);
      let order;
      for (const code of map[email]) {
        order = orders.find(x => x.code === code);
        ok = ok && order!.user!.id === user!.id;
      }
      ok = ok && user!.status === order!.id;
    }
    expect(ok).toBe(true);
    await db.end();
    for (const db of dbs) {
      await db.end();
    }
  });
});

test('flush #5', async() => {
  const schema = new Schema(helper.getExampleData());
  const db = helper.connectToDatabase(NAME, schema);
  const order = db.table('order').append({ code: helper.getId() });

  try {
    order.dateCreated = '23-06-2017';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect(/Invalid time value/.test(message)).toBe(true);
    await db.flush();
  }
  await db.end();
});

test('flush #6', async() => {
  const schema = new Schema(helper.getExampleData());
  const db = helper.connectToDatabase(NAME, schema);

  const email = helper.getId();
  db.table('user').append({ email, firstName: 'name' });
  await db.flush();
  db.clear();

  db.table('user').append({ email, firstName: 'name-1' });

  const email2 = helper.getId();
  db.table('user').append({ email: email2, firstName: 'name-2' });

  const email3 = helper.getId();
  db.table('user').append({ email: email3, lastName: 'name-3' });

  const email4 = helper.getId();
  db.table('user').append({ email: email4, lastName: 'name-4' });

  await db.flush();

  let user;

  user = await db.table('user').get({ email });
  expect(user.firstName).toBe('name-1');

  user = await db.table('user').get({ email: email2 });
  expect(user.firstName).toBe('name-2');

  user = await db.table('user').get({ email: email3 });
  expect(user.lastName).toBe('name-3');

  user = await db.table('user').get({ email: email4 });
  expect(user.lastName).toBe('name-4');

  await db.end();
});

test('afterBegin', async() => {
  const db = helper.connectToDatabase(NAME);

  const title = 'Example Post';
  const content = 'Example Comment';

  const post = db.table('post').append({ title });

  const comment = db
    .table('comment')
    .append({ post, content: content + '1', parent: null }) as any;

  const deleted = db
    .table('comment')
    .append({ post, content: content + '2', parent: null }) as any;

  await db.flush();

  db.clear();

  db.table('comment').append({
    id: comment.id,
    content: content + '3',
    parent: null
  });

  db.table('comment').append({ post, content: content + '4', parent: null });

  await db.flush({
    afterBegin: conn =>
      db.table('comment')._delete(conn, { post: (post as any).id })
  });

  const comments = await db
    .table('comment')
    .select('*', { where: { content_like: content + '%' } });

  expect(comments.length).toBe(2);
  expect(!!comments.find(c => c.id === comment.id)).toBe(true);
  if (!helper.isSqlite3()) {
    expect(!!comments.find(c => c.id === deleted.id)).toBe(false);
  }

  await db.end();
});

test('beforeCommit', async() => {
  const db = helper.connectToDatabase(NAME);

  const title = 'Example Post';
  const content = 'Example Comment';

  const post = db.table('post').append({ title });

  const comment = db
    .table('comment')
    .append({ post, content: content + '1', parent: null }) as any;

  const deleted = db
    .table('comment')
    .append({ post, content: content + '2', parent: null }) as any;

  await db.flush();

  db.clear();

  db.table('comment').append({
    id: comment.id,
    content: content + '3',
    parent: null
  });

  db.table('comment').append({ post, content: content + '4', parent: null });

  await db.flush({
    beforeCommit: conn => {
      const ids = db.table('comment').recordList.map(r => (r as any).id);
      return db.table('comment')._delete(conn, { not: { id: ids } });
    }
  });

  const comments = await db
    .table('comment')
    .select('*', { where: { content_like: content + '%' } });

  expect(comments.length).toBe(2);
  expect(!!comments.find(c => c.id === comment.id)).toBe(true);
  expect(!!comments.find(c => c.id === deleted.id)).toBe(false);
  await db.end();
});

test('replaceRecordsIn (1)', async() => {
  const db = helper.connectToDatabase(NAME);

  const alice = db.append('user', { email: 'alice' });
  const bob = db.append('user', { email: 'bob' });

  const createOrders = (user: DynamicRecord) => {
    for (let i = 1; i <= 3; i++) {
      const order = db
        .table('order')
        .append({ code: `${user.email}-a${i}`, user });
      for (let j = 1; j <= 3; j++) {
        db.table('order_item').append({ order, product: j, quantity: j });
      }
    }
  };

  createOrders(alice);
  createOrders(bob);

  await db.flush();

  db.clear();

  const order = db.table('order').append({ code: `alice-a1`, user: alice });

  for (let j = 2; j <= 4; j++) {
    db.table('order_item').append({ order, product: j, quantity: j + 1 });
  }

  db.table('order').append({ code: `bob-a1`, user: bob });

  await db.flush({ replaceRecordsIn: ['order'] });

  const aliceItems = await db
    .table('order_item')
    .select('*', { where: { order: { code: 'alice-a1' } } });

  expect(aliceItems.length).toBe(4);

  expect(aliceItems.find(item => (item.product as any).id === 3)!.quantity).toBe(
    4
  );

  const bobItems = await db
    .table('order_item')
    .select('*', { where: { order: { code: 'bob-a1' } } });

  expect(bobItems.length).toBe(3);

  await db.end();
});

test('replaceRecordsIn with replaceRoots', async() => {
  const db = helper.connectToDatabase(NAME);

  const user = db.append('user', { email: 'carol' });

  for (const code of ['carol-c1', 'carol-c2']) {
    const order = db.table('order').append({ code, user });
    for (let j = 1; j <= 3; j++) {
      db.table('order_item').append({ order, product: j, quantity: j });
    }
  }

  await db.flush();

  db.clear();

  const order = db.table('order').append({ code: 'carol-c1', user });
  db.table('order_item').append({ order, product: 1, quantity: 9 });
  db.table('order').append({ code: 'carol-c2', user });

  await db.flush({
    replaceRecordsIn: ['order', 'order_item'],
    replaceRoots: [order],
  });

  const count = async (code: string) =>
    (await db.table('order_item').select('*', { where: { order: { code } } }))
      .length;

  expect(await count('carol-c1')).toBe(1);
  expect(await count('carol-c2')).toBe(3);

  await db.end();
});

test('replaceRecordsIn (2)', async() => {
  const db = helper.connectToDatabase(NAME);

  let alice = db.append('user', { email: 'alice' });
  let bob = db.append('user', { email: 'bob' });

  const createOrders = (user: DynamicRecord) => {
    for (let i = 1; i <= 3; i++) {
      const order = db
        .table('order')
        .append({ code: `${user.email}-b${i}`, user });
      for (let j = 1; j <= 3; j++) {
        db.table('order_item').append({ order, product: j, quantity: j });
      }
    }
  };

  createOrders(alice);
  createOrders(bob);

  await db.flush();

  db.clear();

  alice = db.append('user', { email: 'alice' });
  bob = db.append('user', { email: 'bob' });

  const order = db.table('order').append({ code: `alice-b1`, user: alice });
  for (let j = 2; j <= 4; j++) {
    db.table('order_item').append({ order, product: j, quantity: j + 1 });
  }

  db.table('order').append({ code: `bob-b1`, user: bob });
  db.table('order').append({ code: `bob-b2`, user: bob });

  await db.flush({ replaceRecordsIn: ['user', 'order', 'order_item'] });

  const aliceOrders = await db
    .table('order')
    .select('*', { where: { user: alice } });

  expect(aliceOrders.length).toBe(1);

  const aliceItems = await db
    .table('order_item')
    .select('*', { where: { order: { code: 'alice-b1' } } });

  expect(aliceItems.length).toBe(3);

  expect(aliceItems.find(item => (item.product as any).id === 3)!.quantity).toBe(
    4
  );

  const bobOrders = await db
    .table('order')
    .select('*', { where: { user: bob } });

  expect(bobOrders.length).toBe(2);

  const bobItems = await db
    .table('order_item')
    .select('*', { where: { order: { code_like: 'bob-b%' } } });

  expect(bobItems.length).toBe(0);
  await db.end();
});

function createTestPosts(db: Database, user: Record) {
  const allPosts: Record[] = [];
  const allComments: any[] = [];

  for (let i = 0; i < 4; i++) {
    const post = db.table('post').append({ title: '', user });
    const comments: Record[] = [];
    comments.push(
      db.table('comment').append({ post, parent: null, content: '' })
    );
    comments.push(
      db.table('comment').append({ post, parent: null, content: '' })
    );
    for (let j = 0; j < 2; j++) {
      const comment = db
        .table('comment')
        .append({ post, parent: comments[0], content: '' });
      comments.push(comment);
      for (let k = 0; k < 2; k++) {
        comments.push(
          db.table('comment').append({ post, parent: comment, content: '' })
        );
      }
    }
    allPosts.push(post);
    allComments.push(comments);
  }

  return [allPosts, allComments];
}

test('replaceRecordsIn (3)', async() => {
  const db = helper.connectToDatabase(NAME);

  let user = db.append('user', { email: 'alice' });

  const [allPosts, allComments] = createTestPosts(db, user);

  await db.flush();

  db.clear();

  user = db.append('user', { email: 'alice' });
  // post with title '0', no comments
  db.table('post').append({ id: allPosts[0].id, title: '0', user });

  /*
                                               +-------+
                                               |   P   |
                                               ++---+--+
                                                ^   ^
                                                |   |
                                                |   |
                             +---------+        |   |          +---------+
                             | [0] 0   +--------+   +----------+ [1] 1   |
                             +-+-----+-+                       +---------+
                               ^     ^
                               |     |
           +---------+         |     |      +---------+
           | [2] 0.0 +---------+     +------+ [5] 0.1 |
           ++-----+--+                      ++------+-+
            ^     ^                          ^      ^
            |     |                          |      |
            |     |                          |      |
+-----------++   ++-----------+   +----------+-+   ++-----------+
| [3] 0.0.0  |   | [4] 0.0.1  |   | [6] 0.1.0  |   | [7] 0.1.1  |
+------------+   +------------+   +------------+   +------------+
*/

  {
    // post with title '1', just comment 0, comment 0.0, comment 0.0.1 and 1
    let post = db
      .table('post')
      .append({ id: allPosts[1].id, title: '1', user });

    const comments = allComments[1];

    const c0 = db.table('comment').append({
      id: comments[0].id,
      post,
      parent: null,
      content: '0'
    });

    const c1 = db.table('comment').append({
      id: comments[2].id,
      post,
      parent: c0,
      content: '0.0'
    });

    db.table('comment').append({
      id: comments[4].id,
      post,
      parent: c1,
      content: '0.0.1'
    });

    db.table('comment').append({
      id: comments[1],
      post,
      parent: null,
      content: '1'
    });
  }
  {
    // post with title '2', just comment 0, comment 0.1, comment 0.1.0
    let post = db
      .table('post')
      .append({ id: allPosts[2].id, title: '2', user });

    const comments = allComments[2];

    const c0 = db.table('comment').append({
      id: comments[0].id,
      post,
      parent: null,
      content: '0'
    });

    const c1 = db.table('comment').append({
      id: comments[5].id,
      post,
      parent: c0,
      content: '0.1'
    });

    const c2 = db.table('comment').append({
      id: comments[6].id,
      post,
      parent: c1,
      content: '0.1.0'
    });

    db.table('comment').append({
      post,
      parent: c2,
      content: '0.1.1'
    });
  }

  await db.flush({ replaceRecordsIn: ['user', 'post', 'comment'] });

  const posts = await db
    .table('post')
    .select('*', { where: { user }, orderBy: 'title' });

  expect(posts.length).toBe(3);
  expect(posts[0].title).toBe('0');
  expect(posts[1].title).toBe('1');
  expect(posts[2].title).toBe('2');

  {
    const comments = await db
      .table('comment')
      .select('*', { where: { post: posts[0].id }, orderBy: 'content' });
    expect(comments.length).toBe(0);
  }

  {
    const comments = await db
      .table('comment')
      .select('*', { where: { post: posts[1].id }, orderBy: 'content' });
    expect((comments[1].parent as any).id).toBe(comments[0].id);
    expect((comments[2].parent as any).id).toBe(comments[1].id);
    expect(comments.length).toBe(4);
  }

  {
    const comments = await db
      .table('comment')
      .select('*', { where: { post: posts[2].id }, orderBy: 'content' });
    expect(comments.length).toBe(4);
    expect((comments[3].parent as any).id).toBe(comments[2].id);
  }
  await db.end();
});

test('replaceRecordsIn (4)', async() => {
  const db = helper.connectToDatabase(NAME);

  let user = db.append('user', { email: 'alice2' });

  const [allPosts, allComments] = createTestPosts(db, user);

  await db.flush();

  db.clear();

  const bob2 = db.append('user', { email: 'bob2' });

  db.table('post').append({ id: allPosts[0].id, title: '0', user: bob2 });
  db.table('post').append({ id: allPosts[1].id, title: '1', user: bob2 });

  await db.flush({ replaceRecordsIn: ['user', 'post'] });

  const posts = await db
    .table('post')
    .select('*', { where: { user: bob2.id }, orderBy: 'title' });

  expect(posts.length).toBe(2);

  const comments = await db
    .table('comment')
    .select('*', { where: { post: posts[1].id } });

  expect(comments.length).toBe(8);
  await db.end();
});

test('foreign key merge and write-once guard', () => {
  const schema = new Schema(helper.getExampleData());
  const db = new Database(null as any, schema);
  const table = db.table('order');

  // re-expressed parents merge last-wins via append
  const first = table.append({
    code: 'fk-merge',
    user: { email: 'merge@example.com' },
  });
  const second = table.append({ code: 'fk-merge', user: 1 });
  expect(second).toBe(first);
  expect(runtimeOf(first).value('user')).toBe(1);

  // a null placeholder can be filled in later (loader pattern)
  const placeholder = table.append({ code: 'fk-null', user: null });
  placeholder.user = db.table('user').append({ email: 'filled@example.com' });
  expect(placeholder.user.email).toBe('filled@example.com');

  // distinct unsaved parent records are a conflict
  const once = table.append({
    code: 'fk-once',
    user: { email: 'a@example.com' },
  });
  expect(() => {
    once.user = db.table('user').append({ email: 'b@example.com' });
  }).toThrow('Reassigning');
  db.end();
});

test('record sets require unique fields', async () => {
  const db = helper.connectToDatabase(NAME);
  const rec = db.table('order').append();
  await expect(rec.orderItems.all()).rejects.toThrow('unique fields');
  await db.end();
});

test('flush resolves existing rows across lookup batches', async () => {
  const schema = new Schema(helper.getExampleData());
  const db = helper.connectToDatabase(NAME, schema);
  const table = db.table('user');
  const count = SELECT_BATCH_SIZE * 2 + 10;
  const email = (i: number) => `batch-${i}@example.com`;
  // rows that already exist, one in each lookup batch
  const existing = [0, SELECT_BATCH_SIZE, SELECT_BATCH_SIZE * 2 + 5];
  const ids = new Map<number, unknown>();
  for (const i of existing) ids.set(i, await table.insert({ email: email(i), status: 1 }));

  for (let i = 0; i < count; i++) table.append({ email: email(i), status: 7 });
  await db.flush();

  const rows = await table.select('*', { where: { email_like: 'batch-%' } });
  expect(rows.length).toBe(count);
  expect(rows.every((row: any) => row.status === 7)).toBe(true);
  for (const i of existing) {
    expect((await table.get({ email: email(i) })).id).toBe(ids.get(i));
  }
  await db.end();
});

test('a flush retried after a conflict writes again what the rolled-back attempt had written', async () => {
  const schema = new Schema(helper.getExampleData());
  const db = helper.connectToDatabase(NAME, schema);
  const user = db.table('user').append({ email: 'retried@example.com' });
  db.table('order').append({ code: 'retried-order', user });
  // the first order insert meets a row a concurrent flush committed meanwhile:
  // the transaction rolls back after the user row was inserted
  let conflicts = 0;
  const getConnection = db.pool.getConnection.bind(db.pool);
  jest.spyOn(db.pool, 'getConnection').mockImplementation(async () => {
    const connection = await getConnection();
    // SQLite reuses this connection when the transaction is retried. Bind the
    // real method, not a spy installed by the previous attempt.
    const query = Object.getPrototypeOf(connection)._query.bind(connection);
    jest.spyOn(connection, '_query').mockImplementation((sql: string, ...rest: any[]) => {
      if (conflicts === 0 && /^insert into [`"]order[`"]/.test(sql)) {
        conflicts++;
        return Promise.reject(new Error("Duplicate entry 'retried-order' for key 'code'"));
      }
      return (query as any)(sql, ...rest);
    });
    return connection;
  });

  await db.flush();

  expect(conflicts).toBe(1);
  const saved = await db.table('user').get({ email: 'retried@example.com' });
  const order = await db.table('order').get({ code: 'retried-order' });
  expect(order.user!.id).toBe(saved.id);
  expect(user.id).toBe(saved.id);
  jest.restoreAllMocks();
  await db.end();
});

test('PostgreSQL bulk flush maps returned IDs by key, independent of row order', async () => {
  if (helper.DB_TYPE !== 'postgres') return;
  const db = helper.connectToDatabase(NAME, new Schema(helper.getExampleData()));
  const first = db.table('user').append({ email: 'returned-first@example.com' });
  const second = db.table('user').append({ email: 'returned-second@example.com' });
  const getConnection = db.pool.getConnection.bind(db.pool);
  jest.spyOn(db.pool, 'getConnection').mockImplementation(async () => {
    const connection = await getConnection();
    const query = connection._query.bind(connection);
    jest.spyOn(connection, '_query').mockImplementation(async (sql: string, ...rest: any[]) => {
      const result = await (query as any)(sql, ...rest);
      return /^insert into "user"/.test(sql) && /on conflict/.test(sql) && Array.isArray(result)
        ? [...result].reverse()
        : result;
    });
    return connection;
  });

  await db.flush();
  expect(first.id).toBe((await db.table('user').get({ email: first.email })).id);
  expect(second.id).toBe((await db.table('user').get({ email: second.email })).id);
  jest.restoreAllMocks();
  await db.end();
});

test('PostgreSQL overlapping bulk flushes resolve unique keys without transaction retries', async () => {
  if (helper.DB_TYPE !== 'postgres') return;
  const schema = new Schema(helper.getExampleData());
  const dbs = [helper.connectToDatabase(NAME, schema), helper.connectToDatabase(NAME, schema)];
  const prefix = helper.getId();
  const records = dbs.map((db, index) => Array.from({ length: 180 }, (_, i) =>
    db.table('user').append({ email: `${prefix}-${i}@example.com`, firstName: `writer-${index}` })
  ));
  let waiting = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let rollbacks = 0;
  for (const db of dbs) {
    const getConnection = db.pool.getConnection.bind(db.pool);
    jest.spyOn(db.pool, 'getConnection').mockImplementation(async () => {
      const connection = await getConnection();
      const query = connection._query.bind(connection);
      jest.spyOn(connection, '_query').mockImplementation(async (sql: string, ...rest: any[]) => {
        if (/^rollback$/i.test(sql)) rollbacks++;
        if (/^insert into "user"/.test(sql) && /on conflict/.test(sql) && ++waiting <= 2) {
          if (waiting === 2) release();
          await gate;
        }
        return (query as any)(sql, ...rest);
      });
      return connection;
    });
  }

  const results = await Promise.all(dbs.map(db => db.flush()));
  expect(rollbacks).toBe(0);
  for (const { connection } of results) {
    expect(connection.queryCounter.total).toBeLessThan(20);
  }
  for (let i = 0; i < 180; i++) {
    expect(records[0][i].id).toBe(records[1][i].id);
  }
  const saved = await dbs[0].table('user').select('*', { where: { email_like: `${prefix}-%` } });
  expect(saved.length).toBe(180);
  jest.restoreAllMocks();
  await Promise.all(dbs.map(db => db.end()));
});

test('PostgreSQL bulk flush resolves composite foreign-key keys', async () => {
  if (helper.DB_TYPE !== 'postgres') return;
  const db = helper.connectToDatabase(NAME, new Schema(helper.getExampleData()));
  const user = await db.table('user').insert({ email: `${helper.getId()}@example.com` });
  const group = await db.table('group').insert({ name: helper.getId() });
  const table = db.table('user_group');
  const first = table.append({ user, group });
  await db.flush();
  const id = first.id;
  db.clear();
  const second = table.append({ user, group });
  await db.flush();
  expect(second.id).toBe(id);
  expect((await table.select('*', { where: { id } })).length).toBe(1);
  await db.end();
});

test('bulk flush updates the natural key of a record with a supplied primary key', async () => {
  const db = helper.connectToDatabase(NAME, new Schema(helper.getExampleData()));
  const id = await db.table('user').insert({ email: `${helper.getId()}@example.com` });
  const email = `${helper.getId()}-renamed@example.com`;
  db.table('user').append({ id, email });
  await db.flush();
  expect((await db.table('user').get({ id })).email).toBe(email);
  await db.end();
});

test('PostgreSQL bulk flush skips the update when conflicting values are unchanged', async () => {
  if (helper.DB_TYPE !== 'postgres') return;
  const db = helper.connectToDatabase(NAME, new Schema(helper.getExampleData()));
  const code = helper.getId();
  const dateCreated = new Date('2026-01-02T03:04:05.000Z');
  await db.table('order').insert({ code, dateCreated });
  const sku = helper.getId();
  const config = { a: 1, b: [1, 2] };
  await db.table('product').insert({ sku, config });
  db.table('order').append({ code, dateCreated });
  db.table('product').append({ sku, config });
  const updates: string[] = [];
  const getConnection = db.pool.getConnection.bind(db.pool);
  jest.spyOn(db.pool, 'getConnection').mockImplementation(async () => {
    const connection = await getConnection();
    const query = connection._query.bind(connection);
    jest.spyOn(connection, '_query').mockImplementation((sql: string, ...rest: any[]) => {
      if (/^update /.test(sql)) updates.push(sql);
      return (query as any)(sql, ...rest);
    });
    return connection;
  });

  await db.flush();
  expect(updates).toEqual([]);
  jest.restoreAllMocks();
  await db.end();
});

test('PostgreSQL bulk flush updates array columns after a key conflict', async () => {
  if (helper.DB_TYPE !== 'postgres') return;
  const db = helper.connectToDatabase(NAME, new Schema({ name: '', tables: [{
    name: 'flush_tagged',
    columns: [
      { name: 'id', type: 'integer', nullable: false, autoIncrement: true },
      { name: 'name', type: 'varchar', size: 60, nullable: false },
      { name: 'tags', type: 'text[]', nullable: true },
    ],
    constraints: [{ primaryKey: true, columns: ['id'] }, { unique: true, columns: ['name'] }],
  }] }));
  await db.query('create table flush_tagged (id serial primary key, name varchar(60) not null unique, tags text[])');
  await db.query(`insert into flush_tagged (name, tags) values ('first', '{a}')`);
  db.table('flush_tagged').append({ name: 'first', tags: '{a,b}' });
  await db.flush();
  expect((await db.table('flush_tagged').get({ name: 'first' })).tags).toEqual(['a', 'b']);
  await db.end();
});

test('PostgreSQL bulk flush retries when a conflicting row is deleted mid-attempt', async () => {
  if (helper.DB_TYPE !== 'postgres') return;
  const db = helper.connectToDatabase(NAME, new Schema(helper.getExampleData()));
  const email = `${helper.getId()}@example.com`;
  await db.table('user').insert({ email });
  const user = db.table('user').append({ email, firstName: 'retried' });
  let deleted = false;
  let rollbacks = 0;
  const getConnection = db.pool.getConnection.bind(db.pool);
  jest.spyOn(db.pool, 'getConnection').mockImplementation(async () => {
    const connection = await getConnection();
    const query = connection._query.bind(connection);
    jest.spyOn(connection, '_query').mockImplementation(async (sql: string, ...rest: any[]) => {
      if (/^rollback$/i.test(sql)) rollbacks++;
      const result = await (query as any)(sql, ...rest);
      if (!deleted && /^insert into "user"/.test(sql) && /on conflict/.test(sql)) {
        deleted = true;
        await db.table('user').delete({ email });
      }
      return result;
    });
    return connection;
  });

  await db.flush();
  jest.restoreAllMocks();
  expect(rollbacks).toBe(1);
  const saved = await db.table('user').get({ email });
  expect(saved.firstName).toBe('retried');
  expect(user.id).toBe(saved.id);
  await db.end();
});

test('PostgreSQL bulk flush honors insertOnly on a key conflict', async () => {
  if (helper.DB_TYPE !== 'postgres') return;
  const db = helper.connectToDatabase(NAME, new Schema(helper.getExampleData()));
  const email = `${helper.getId()}@example.com`;
  const id = await db.table('user').insert({ email, firstName: 'original' });
  const record = db.table('user').append({ email, firstName: 'replacement' });
  runtimeOf(record).insertOnly = true;
  await db.flush();
  expect(record.id).toBe(id);
  expect(runtimeOf(record).isInserted()).toBe(false);
  expect((await db.table('user').get({ id })).firstName).toBe('original');
  await db.end();
});

test('bulk flush keeps generated IDs private until commit', async () => {
  const db = helper.connectToDatabase(NAME, new Schema(helper.getExampleData()));
  const user = db.table('user').append({ email: `${helper.getId()}@example.com` });
  let entered!: () => void;
  const inHook = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const flush = db.flush({ beforeCommit: async () => {
    expect(user.id).toBeDefined();
    entered();
    await gate;
  } });
  await inHook;
  expect(user.id).toBeUndefined();
  release();
  await flush;
  expect(user.id).toBeDefined();
  await db.end();
});

/** Starts a flush and resolves once it is paused in its beforeCommit hook. */
async function pauseFlush(db: Database) {
  let entered!: () => void;
  const inHook = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const flush = db.flush({ beforeCommit: async () => {
    entered();
    await gate;
  } });
  await inHook;
  return { flush, release };
}

test('a flush hook cannot save a record the flush owns', async () => {
  const db = helper.connectToDatabase(NAME, new Schema(helper.getExampleData()));
  const email = `${helper.getId()}@example.com`;
  const user = db.table('user').append({ email });
  await expect(db.flush({ beforeCommit: async () => {
    user.firstName = 'hook';
    await user.save();
  } })).rejects.toThrow(/is being flushed/);
  expect(user.id).toBeUndefined();
  expect(await db.table('user').get({ email })).toBeFalsy();
  // The failed flush released the record.
  user.firstName = 'after';
  await db.flush();
  expect((await db.table('user').get({ email })).firstName).toBe('after');
  await db.end();
});

test('saving or deleting a record rejects while its flush is in flight', async () => {
  const db = helper.connectToDatabase(NAME, new Schema(helper.getExampleData()));
  const user = db.table('user').append({ email: `${helper.getId()}@example.com` });
  const { flush, release } = await pauseFlush(db);
  await expect(user.save()).rejects.toThrow(/is being flushed/);
  await expect(user.delete()).rejects.toThrow(/is being flushed/);
  release();
  await flush;
  expect(user.id).toBe((await db.table('user').get({ email: user.email })).id);
  await db.end();
});

test('changing a record while its flush is in flight throws until the flush commits', async () => {
  const db = helper.connectToDatabase(NAME, new Schema(helper.getExampleData()));
  const email = `${helper.getId()}@example.com`;
  const user = db.table('user').append({ email, firstName: 'before' });
  const { flush, release } = await pauseFlush(db);
  expect(() => { user.firstName = 'during'; }).toThrow(/is being flushed/);
  expect(user.firstName).toBe('before');
  release();
  await flush;
  user.firstName = 'after';
  await db.flush();
  expect((await db.table('user').get({ email })).firstName).toBe('after');
  await db.end();
});

test('a second flush rejects records owned by a flush in flight', async () => {
  // Two connections, so the second flush is not queued behind the first.
  const db = helper.connectToDatabase(NAME, new Schema(helper.getExampleData()), 2);
  const user = db.table('user').append({ email: `${helper.getId()}@example.com` });
  const { flush, release } = await pauseFlush(db);
  await expect(db.flush()).rejects.toThrow(/is being flushed/);
  release();
  await flush;
  expect(user.id).toBe((await db.table('user').get({ email: user.email })).id);
  await db.end();
});

test('callbacks scheduled by a flush hook see committed state after the flush', async () => {
  const schema = new Schema(helper.getExampleData());
  const db = helper.connectToDatabase(NAME, schema);
  const other = helper.connectToDatabase(NAME, schema);
  const bystander = other.table('user').append({ email: `${helper.getId()}@example.com` });
  const user = db.table('user').append({ email: `${helper.getId()}@example.com`, firstName: 'flushed' });
  let late!: Promise<unknown>;
  await db.flush({ beforeCommit: async () => {
    late = new Promise(resolve => setTimeout(() => {
      void bystander.email;
      resolve(user.firstName);
    }, 50));
  } });
  user.firstName = 'after';
  expect(await late).toBe('after');
  // The finished flush did not claim the record the callback read.
  bystander.firstName = 'changed';
  await db.end();
  await other.end();
});

test('bulk flush leaves records unchanged when a transaction fails', async () => {
  const db = helper.connectToDatabase(NAME, new Schema(helper.getExampleData()));
  const user = db.table('user').append({ email: `${helper.getId()}@example.com` });
  db.table('order').append({ code: helper.getId(), user });
  const getConnection = db.pool.getConnection.bind(db.pool);
  jest.spyOn(db.pool, 'getConnection').mockImplementation(async () => {
    const connection = await getConnection();
    const query = Object.getPrototypeOf(connection)._query.bind(connection);
    jest.spyOn(connection, '_query').mockImplementation((sql: string, ...rest: any[]) =>
      /^insert into [`"]order[`"]/.test(sql)
        ? Promise.reject(new Error('synthetic write failure'))
        : (query as any)(sql, ...rest)
    );
    return connection;
  });
  await expect(db.flush()).rejects.toThrow('synthetic write failure');
  expect(user.id).toBeUndefined();
  expect(runtimeOf(user).isDirty()).toBe(true);
  jest.restoreAllMocks();
  await db.flush();
  expect(user.id).toBeDefined();
  await db.end();
});

test('bulk flush reports an unresolved record cycle immediately', async () => {
  const db = helper.connectToDatabase(NAME, new Schema(helper.getExampleData()));
  const first = db.table('category').append({ name: helper.getId() });
  const second = db.table('category').append({ name: helper.getId() });
  first.parent = second;
  second.parent = first;
  await expect(db.flush()).rejects.toThrow(/Circular references: category\.parent/);
  expect(first.id).toBeUndefined();
  expect(second.id).toBeUndefined();
  await db.end();
});

test('PostgreSQL retries a serialization failure with fresh record state', async () => {
  if (helper.DB_TYPE !== 'postgres') return;
  const db = helper.connectToDatabase(NAME, new Schema(helper.getExampleData()));
  const user = db.table('user').append({ email: `${helper.getId()}@example.com` });
  const order = db.table('order').append({ code: helper.getId(), user });
  let failures = 0;
  const getConnection = db.pool.getConnection.bind(db.pool);
  jest.spyOn(db.pool, 'getConnection').mockImplementation(async () => {
    const connection = await getConnection();
    const query = Object.getPrototypeOf(connection)._query.bind(connection);
    jest.spyOn(connection, '_query').mockImplementation((sql: string, ...rest: any[]) => {
      if (failures === 0 && /^insert into "order"/.test(sql)) {
        failures++;
        return Promise.reject(Object.assign(new Error('serialization failure'), { code: '40001' }));
      }
      return (query as any)(sql, ...rest);
    });
    return connection;
  });
  await db.flush();
  expect(failures).toBe(1);
  expect(user.id).toBeDefined();
  expect((await db.table('order').get({ id: order.id })).user!.id).toBe(user.id);
  jest.restoreAllMocks();
  await db.end();
});

test('PostgreSQL does not retry an unrelated unique violation from the conflict writer', async () => {
  if (helper.DB_TYPE !== 'postgres') return;
  const db = helper.connectToDatabase(NAME, new Schema(helper.getExampleData()));
  const user = db.table('user').append({ email: `${helper.getId()}@example.com` });
  let writes = 0;
  const getConnection = db.pool.getConnection.bind(db.pool);
  jest.spyOn(db.pool, 'getConnection').mockImplementation(async () => {
    const connection = await getConnection();
    const query = Object.getPrototypeOf(connection)._query.bind(connection);
    jest.spyOn(connection, '_query').mockImplementation((sql: string, ...rest: any[]) => {
      if (/^insert into "user"/.test(sql) && /on conflict/.test(sql)) {
        writes++;
        return Promise.reject(Object.assign(new Error('other unique index'), { code: '23505' }));
      }
      return (query as any)(sql, ...rest);
    });
    return connection;
  });
  await expect(db.flush()).rejects.toThrow('other unique index');
  expect(writes).toBe(1);
  expect(user.id).toBeUndefined();
  jest.restoreAllMocks();
  await db.end();
});

test('PostgreSQL bounds serialization retries and retains the original error', async () => {
  if (helper.DB_TYPE !== 'postgres') return;
  const db = helper.connectToDatabase(NAME, new Schema(helper.getExampleData()));
  const user = db.table('user').append({ email: `${helper.getId()}@example.com` });
  const failure = Object.assign(new Error('always serialize'), { code: '40001' });
  let writes = 0;
  const getConnection = db.pool.getConnection.bind(db.pool);
  jest.spyOn(db.pool, 'getConnection').mockImplementation(async () => {
    const connection = await getConnection();
    const query = Object.getPrototypeOf(connection)._query.bind(connection);
    jest.spyOn(connection, '_query').mockImplementation((sql: string, ...rest: any[]) => {
      if (/^insert into "user"/.test(sql)) {
        writes++;
        return Promise.reject(failure);
      }
      return (query as any)(sql, ...rest);
    });
    return connection;
  });
  await expect(db.flush()).rejects.toBe(failure);
  expect(writes).toBe(8);
  expect(user.id).toBeUndefined();
  jest.restoreAllMocks();
  await db.end();
});

test('PostgreSQL leaves ambiguous unique-key tables on the legacy writer', async () => {
  if (helper.DB_TYPE !== 'postgres') return;
  const db = helper.connectToDatabase(NAME, new Schema(helper.getExampleData()));
  const code = helper.getId();
  const ecode = helper.getId();
  const record = db.table('employee').append({ code, ecode, name: 'one' });
  const queries: string[] = [];
  const getConnection = db.pool.getConnection.bind(db.pool);
  jest.spyOn(db.pool, 'getConnection').mockImplementation(async () => {
    const connection = await getConnection();
    const query = Object.getPrototypeOf(connection)._query.bind(connection);
    jest.spyOn(connection, '_query').mockImplementation((sql: string, ...rest: any[]) => {
      queries.push(sql);
      return (query as any)(sql, ...rest);
    });
    return connection;
  });
  await db.flush();
  expect(record.id).toBeDefined();
  expect(queries.some(sql => /^insert into "employee"/.test(sql) && /on conflict/.test(sql))).toBe(false);
  jest.restoreAllMocks();
  await db.end();
});

test('PostgreSQL leaves rows without a non-null natural key on the legacy writer', async () => {
  if (helper.DB_TYPE !== 'postgres') return;
  const db = helper.connectToDatabase(NAME, new Schema(helper.getExampleData()));
  const record = db.table('user').append({ email: null, firstName: helper.getId() });
  const queries: string[] = [];
  const getConnection = db.pool.getConnection.bind(db.pool);
  jest.spyOn(db.pool, 'getConnection').mockImplementation(async () => {
    const connection = await getConnection();
    const query = Object.getPrototypeOf(connection)._query.bind(connection);
    jest.spyOn(connection, '_query').mockImplementation((sql: string, ...rest: any[]) => {
      queries.push(sql);
      return (query as any)(sql, ...rest);
    });
    return connection;
  });
  await db.flush();
  expect(record.id).toBeDefined();
  expect(queries.some(sql => /^insert into "user"/.test(sql) && /on conflict/.test(sql))).toBe(false);
  jest.restoreAllMocks();
  await db.end();
});

test('PostgreSQL reports a clash on another unique key without adopting the wrong row', async () => {
  if (helper.DB_TYPE !== 'postgres') return;
  const db = helper.connectToDatabase(NAME, new Schema(helper.getExampleData()));
  const ecode = helper.getId();
  await db.table('employee').insert({ code: helper.getId(), ecode });
  const record = db.table('employee').append({ code: helper.getId(), ecode });
  await expect(db.flush()).rejects.toMatchObject({ code: '23505' });
  expect(record.id).toBeUndefined();
  expect(runtimeOf(record).isDirty()).toBe(true);
  await db.end();
});

test('SQLite constraint codes retain the one-time bulk fallback', async () => {
  if (helper.DB_TYPE !== 'sqlite3') return;
  const db = helper.connectToDatabase(NAME, new Schema(helper.getExampleData()));
  const user = db.table('user').append({ email: `${helper.getId()}@example.com` });
  const order = db.table('order').append({ code: helper.getId(), user });
  let failures = 0;
  const getConnection = db.pool.getConnection.bind(db.pool);
  jest.spyOn(db.pool, 'getConnection').mockImplementation(async () => {
    const connection = await getConnection();
    const query = Object.getPrototypeOf(connection)._query.bind(connection);
    jest.spyOn(connection, '_query').mockImplementation((sql: string, ...rest: any[]) => {
      if (failures === 0 && /^insert into "order"/.test(sql)) {
        failures++;
        return Promise.reject(Object.assign(
          new Error('UNIQUE constraint failed: order.code'), { code: 'SQLITE_CONSTRAINT' }
        ));
      }
      return (query as any)(sql, ...rest);
    });
    return connection;
  });
  await db.flush();
  expect(failures).toBe(1);
  expect((await db.table('order').get({ id: order.id })).user!.id).toBe(user.id);
  jest.restoreAllMocks();
  await db.end();
});
