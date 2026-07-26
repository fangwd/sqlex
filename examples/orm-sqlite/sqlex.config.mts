import { join } from 'node:path';
import { Post, User } from './models.mts';

export const connection = {
  dialect: 'sqlite3' as const,
  connection: { database: 'app.db' },
};

export default {
  connection,
  models: { User, Post },
  migrationDirectory: join(import.meta.dirname, 'migrations'),
};
