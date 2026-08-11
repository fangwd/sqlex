import { join } from 'node:path';
import type { ApiConfig } from 'sqlex/api';
import { Category, Product } from './models.mts';

export const connection = {
  dialect: 'sqlite3' as const,
  connection: { database: 'shop.db' },
};

// The policy: nothing is exposed that is not named here.
export const api: ApiConfig = {
  basePath: '/api',
  resources: {
    Product: {
      operations: ['list', 'get', 'create', 'update', 'delete', 'aggregate'],
      aggregate: { groupBy: ['category'], fields: ['price'] },
      read: { exclude: ['costPrice'] },
      // Readable or not, cost price is not something a client may set.
      write: { exclude: ['costPrice'] },
      filter: {
        fields: ['name', 'price', 'sku', 'category.name'],
        operators: ['eq', 'ne', 'ge', 'le', 'in', 'like'],
      },
      sort: { fields: ['name', 'price'], default: ['name'] },
      include: { relations: ['category'] },
      page: { defaultLimit: 10, maxLimit: 50 },
    },
    Category: {
      sort: { fields: ['name'], default: ['name'] },
      include: { relations: ['products'] },
    },
  },
};

export default {
  connection,
  models: { Category, Product },
  migrationDirectory: join(import.meta.dirname, 'migrations'),
  api,
  openapi: { title: 'Shop', version: '1.0.0' },
};
