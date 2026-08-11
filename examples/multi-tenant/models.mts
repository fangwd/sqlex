import { defineRecord, field, type RecordSet } from 'sqlex';

export class Shop extends defineRecord({
  table: 'shop',
  comment: 'A tenant: one storefront on the platform.',
  fields: {
    id: field.id(),
    name: field.string({ maxLength: 60, unique: true }),
    status: field.enum({ values: ['open', 'closed'] as const, default: 'open' }),
  },
}) {
  declare products: RecordSet<Product>;
  declare orders: RecordSet<Order>;
}

export class Customer extends defineRecord({
  table: 'customer',
  comment: 'A shopper; places orders at any shop.',
  fields: {
    id: field.id(),
    name: field.string({ maxLength: 60, unique: true }),
  },
}) {}

export class Product extends defineRecord({
  table: 'product',
  comment: "A product in one shop's catalogue.",
  fields: {
    id: field.id(),
    shop: field.foreignKey(() => Shop, { relatedName: 'products' }),
    name: field.string({ maxLength: 120 }),
    price: field.decimal({ precision: 10, scale: 2, comment: 'Retail price.' }),
  },
  unique: [['shop', 'name']],
}) {}

export class Order extends defineRecord({
  table: 'shop_order',
  comment: 'An order a customer placed with one shop.',
  fields: {
    id: field.id(),
    shop: field.foreignKey(() => Shop, { relatedName: 'orders' }),
    customer: field.foreignKey(() => Customer),
    code: field.string({ maxLength: 30, unique: true }),
    placedAt: field.datetime({ column: 'placed_at' }),
    status: field.enum({ values: ['open', 'shipped', 'cancelled'] as const, default: 'open' }),
  },
}) {
  declare items: RecordSet<OrderItem>;
}

export class OrderItem extends defineRecord({
  table: 'shop_order_item',
  comment: "A line of an order; its tenant is the order's shop.",
  fields: {
    id: field.id(),
    order: field.foreignKey(() => Order, { relatedName: 'items', onDelete: 'cascade' }),
    product: field.foreignKey(() => Product),
    quantity: field.integer(),
  },
}) {}
