import { defineRecord, field, type RecordSet } from 'sqlex';

export class Category extends defineRecord({
  table: 'category',
  comment: 'A leaf of the catalogue tree.',
  fields: {
    id: field.id(),
    name: field.string({ maxLength: 60, unique: true, comment: 'Shown in navigation.' }),
  },
}) {
  declare products: RecordSet<Product>;
}

export class Product extends defineRecord({
  table: 'product',
  comment: 'A sellable product.',
  fields: {
    id: field.id(),
    category: field.foreignKey(() => Category, { relatedName: 'products' }),
    sku: field.string({ maxLength: 20, unique: true, comment: 'Stock keeping unit.' }),
    name: field.string({ maxLength: 120 }),
    price: field.decimal({ precision: 10, scale: 2, comment: 'Retail price in AUD.' }),
    // Exposed nowhere: the API policy excludes it from both reads and writes,
    // so it has to be a column a create can leave out.
    costPrice: field.decimal({
      column: 'cost_price',
      precision: 10,
      scale: 2,
      nullable: true,
    }),
  },
}) {}
