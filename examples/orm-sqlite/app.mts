import { Database } from 'sqlex';
import config, { connection } from './sqlex.config.mts';

const db = new Database(connection);
const models = db.bind(config.models);

const [user, created] = await models.User.getOrCreate({
  email: 'alice@example.com',
});

if (created) {
  await models.Post.create({
    author: user,
    title: 'Hello from sqlex',
  });
}

const posts = await user.posts.all();
const drafts = await models.Post
  .filter({ published: false })
  .orderBy('title');

console.log({ user, posts, drafts });
await db.end();
