import { join } from 'node:path';
import type { Document, Filter } from 'sqlex';
import { ApiError, type ApiConfig } from 'sqlex/api';
import { Customer, Order, OrderItem, Product, Shop } from './models.mts';

export const connection = {
  dialect: 'sqlite3' as const,
  connection: { database: 'platform.db' },
};

/**
 * What authentication produces. Four personas:
 *  - super:    platform staff, unrestricted
 *  - owner:    runs one shop; may close it
 *  - admin:    works in one shop; manages its products and orders
 *  - customer: shops anywhere; sees and cancels their own orders
 */
export interface Context {
  role: 'super' | 'owner' | 'admin' | 'customer';
  shopId?: number;
  customerId?: number;
}

const staff = (role: Context['role']) => role === 'owner' || role === 'admin';

/** An empty filter: no restriction. Named so the policy reads as intended. */
const everything: Filter = {};
/** An empty list of alternatives: admits nothing. */
const nothing: Filter = [];

/** The whole authorisation model, in three primitives per resource. */
export const api: ApiConfig<Context> = {
  basePath: '/api',
  resources: {
    Shop: {
      operations: ['list', 'get', 'update'],
      // Everyone browses shops; staff are pinned to their own.
      scope: ({ role, shopId }) => (staff(role) ? { id: shopId ?? -1 } : everything),
      // Only the owner (or the platform) may close or reopen a shop.
      authorize: ({ role }, operation) =>
        operation === 'update' ? role === 'owner' || role === 'super' : true,
      write: { fields: ['status'] },
    },

    Product: {
      operations: ['list', 'get', 'create', 'update', 'delete'],
      // Customers browse every shop's catalogue; staff work within their own.
      scope: ({ role, shopId }) => (staff(role) ? { shop: shopId ?? -1 } : everything),
      // Only shop staff (or the platform) touch the catalogue.
      authorize: ({ role }, operation) =>
        operation === 'list' || operation === 'get'
          ? true
          : staff(role) || role === 'super',
      // The shop column is writable so the platform can name it; for staff the
      // stamp overrides whatever the body says, so they cannot reach outside
      // their own shop.
      assign: ({ role, shopId }): Document => (staff(role) ? { shop: shopId ?? null } : {}),
      filter: { fields: ['name', 'price', 'shop'] },
      sort: { fields: ['name', 'price'], default: ['name'] },
    },

    Order: {
      path: 'orders',
      operations: ['list', 'get', 'create', 'update', 'aggregate'],
      // The same table, three ways in: staff by shop, customers by
      // themselves, the platform without restriction.
      scope: ({ role, shopId, customerId }) =>
        role === 'super'
          ? everything
          : staff(role)
          ? { shop: shopId ?? -1 }
          : { customer: customerId ?? -1 },
      // Customers place and change orders; what they may change to is the
      // value rule below.
      authorize: ({ role }, operation) =>
        operation === 'create' ? role === 'customer' || role === 'super' : true,
      // The value rule: a customer may only cancel, and only an open order.
      beforeWrite: ({ role }, { operation, body, row }) => {
        if (operation === 'update' && role === 'customer') {
          // body is what the client asked for; assigned columns are not in it.
          if (Object.keys(body).some(name => name !== 'status') || body.status !== 'cancelled') {
            throw ApiError.unprocessable('a customer may only cancel an order');
          }
          if (row?.status !== 'open') {
            throw ApiError.unprocessable('only an open order can be cancelled');
          }
        }
      },
      // A customer names the shop in the body; who they are comes from
      // authentication, overriding the body. The platform names both.
      assign: ({ role, customerId }): Document =>
        role === 'customer' ? { customer: customerId ?? null } : {},
      write: { fields: ['shop', 'customer', 'code', 'placedAt', 'status'] },
      filter: { fields: ['status', 'placedAt', 'code'] },
      sort: { fields: ['placedAt'], default: ['-placedAt'] },
      include: { relations: ['items', 'customer'] },
      aggregate: { groupBy: ['status'] },
    },

    OrderItem: {
      path: 'order-items',
      operations: ['list', 'get', 'create', 'delete'],
      // No tenant column of its own: reached through the order, per role.
      scope: ({ role, shopId, customerId }): Filter =>
        role === 'super'
          ? everything
          : staff(role)
          ? { order: { shop: shopId ?? -1 } }
          : { order: { customer: customerId ?? -1 } },
      // Every role writes order items in some capacity — the scope already
      // confines whose orders they land on — so no gate is needed here.
      write: { fields: ['order', 'product', 'quantity'] },
      include: { relations: ['order', 'product'] },
    },

    Customer: {
      operations: ['list', 'get'],
      // One may only see oneself; the platform sees everyone; shop staff, no
      // list at all — an empty set of alternatives admits nothing.
      scope: ({ role, customerId }) =>
        role === 'super' ? everything : role === 'customer' ? { id: customerId ?? -1 } : nothing,
    },
  },
};

export default {
  connection,
  models: { Shop, Customer, Product, Order, OrderItem },
  migrationDirectory: join(import.meta.dirname, 'migrations'),
  api,
  openapi: {
    title: 'Platform',
    version: '1.0.0',
    securitySchemes: {
      apiKey: { type: 'apiKey' as const, in: 'header' as const, name: 'x-api-key' },
    },
  },
};
