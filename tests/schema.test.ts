import { getExampleData } from './common';
import { Database, Table } from '../src/types';
import {
  Schema,
  Model,
  RelatedField,
  ForeignKeyField,
  UniqueKey,
  SimpleField,
  setModelName
} from '../src/schema';
import { Schema as SchemaConfig } from '../src/config'
import helper = require('./helper');

let schemaInfo: Database;

beforeAll(() => (schemaInfo = getExampleData()));

describe('Schema', () => {
  test('model()', () => {
    const schema = new Schema(schemaInfo);
    expect(schema.model('undefined')).toBe(undefined);
    const model: Model = schema.model('user_group') as Model;
    expect(model.name).toBe('UserGroup');
  });
});

describe('Models', () => {
  test('keyField()', () => {
    const schema = new Schema(schemaInfo);
    const model = schema.model('user_group') as Model;
    const field = model.keyField() as SimpleField;
    expect(field.name).toBe('id');
  });

  test('getForeignKeyCount()', () => {
    const schema = new Schema(schemaInfo);
    const model = schema.model('membership') as Model;
    const count = model.getForeignKeyCount(schema.model('user') as Model);
    expect(count).toBe(2);
  });
});

describe('Fields', () => {
  test('fullname', () => {
    const schema = new Schema(schemaInfo);
    const model = schema.model('user') as Model;
    const field = model.field('email') as SimpleField;
    expect(field.fullname).toBe('User::email');
  });
});

describe('Type names', () => {
  test('One to many #1', () => {
    const schema = new Schema(schemaInfo);
    const model: Model = schema.model('user') as Model;
    const field = model.field('orders') as RelatedField;
    expect(field.getTypeName()).toBe('UserOrder');
    expect(field.getTypeName(true)).toBe('UserOrders');
  });

  test('One to many #2', () => {
    const schema = new Schema(schemaInfo);
    const model: Model = schema.model('user') as Model;
    const field = model.field('inviterMemberships') as RelatedField;
    expect(field.getTypeName()).toBe('InviterMembership');
    expect(field.getTypeName(true)).toBe('InviterMemberships');
  });

  test('Many to many', () => {
    const schema = new Schema(schemaInfo);
    const model: Model = schema.model('product') as Model;
    const field = model.field('categories') as RelatedField;
    expect(field.getTypeName()).toBe('Category');
    expect(field.getTypeName(true)).toBe('Categories');
  });

  test('One to one', () => {
    const schema = new Schema(schemaInfo);
    const model: Model = schema.model('order') as Model;
    const field = model.field('orderShipping') as RelatedField;
    expect(field.getTypeName()).toBe('OrderOrderShipping');
    expect(() => field.getTypeName(true)).toThrow();
  });
});

describe('Related field names', () => {
  test('With through field', () => {
    const schema = new Schema(schemaInfo, {
      models: [
        {
          table: 'category_tree',
          fields: [
            {
              column: 'ancestor_id',
              throughField: 'descendant_id'
            },
            {
              column: 'descendant_id',
              throughField: '',
              relatedName: 'ancestorSet'
            }
          ]
        }
      ]
    });

    const model: Model = schema.model('category') as Model;

    {
      const field = model.field('descendantCategories') as RelatedField;
      expect(field.referencingField.name).toBe('ancestor');
      expect(field.referencingField.referencedField.model === model).toBe(true);
      const throughField = field.throughField as ForeignKeyField;
      expect(throughField.name).toBe('descendant');
    }

    {
      const field = model.field('ancestorSet') as RelatedField;
      expect(field.referencingField.name).toBe('descendant');
      expect(field.referencingField.model.name).toBe('CategoryTree');
    }
  });

  test('Without through field', () => {
    const schema = new Schema(schemaInfo);
    const model: Model = schema.model('category') as Model;

    // When a foreign key is the only one in its model referencing to another
    // model, the name of the related field will be taken as plural form of the
    // foreign key's model (the default name).
    {
      const field = model.field('categories') as RelatedField;
      expect(field.referencingField.model).toBe(model);
      expect(field.referencingField.name).toBe('parent');
    }

    // Otherwise, the field name will be affixed to the default name.
    {
      const field = model.field('ancestorCategoryTrees') as RelatedField;
      expect(field.referencingField.name).toBe('ancestor');
    }

    // When a foreign key field is unque in its model, the camel case of its
    // model name will be used.
    {
      const model = schema.model('order') as Model;
      const field = model.field('orderShipping') as RelatedField;
      expect(field.referencingField.name).toBe('order');
      const key = field.referencingField.uniqueKey as UniqueKey;
      expect(key.fields.length).toBe(1);
    }
  });
});

describe('Other', () => {
  test('UniqueKey', () => {
    const schema = new Schema(schemaInfo);
    const model: Model = schema.model('product_category') as Model;
    const uniqueKey = model.uniqueKeys.find(key => !key.primary) as UniqueKey;
    expect(uniqueKey.name()).toBe('product-category');
    expect(uniqueKey.autoIncrement()).toBe(false);
    const primaryKey = model.uniqueKeys.find(key => key.primary) as UniqueKey;
    expect(primaryKey.autoIncrement()).toBe(true);
  });

  test('Bad throughField', () => {
    const config = {
      models: [
        {
          table: 'category_tree',
          fields: [
            {
              column: 'ancestor_id',
              throughField: 'distance'
            }
          ]
        }
      ]
    };
    expect(() => new Schema(schemaInfo, config)).toThrow();
  });

  // When a table contains 2 foreign key fields which form a unique constraint
  // of that table, and the only other (if any) field left is the primary key
  // of that table, these 2 fields will be through fields of each other.
  test('Auto-detect throughField #1', () => {
    const schema = new Schema(schemaInfo);
    const model: Model = schema.model('product_category') as Model;
    const product = model.field('product') as ForeignKeyField;
    const category = model.field('category') as ForeignKeyField;
    expect((product.relatedField as RelatedField).throughField).toBe(category);
    expect((category.relatedField as RelatedField).throughField).toBe(product);
  });

  test('Auto-detect throughField #2', () => {
    const t1 = schemaInfo.tables.find(
      table => table.name === 'product_category'
    ) as Table;

    const t2: Table = {
      name: 't2',
      columns: t1.columns,
      constraints: t1.constraints.map(constraint => {
        if (constraint.primaryKey || !constraint.unique) {
          return constraint;
        }
        return { ...constraint, columns: ['product_id', 'id'] };
      })
    };

    const schema = new Schema({
      ...schemaInfo,
      tables: [...schemaInfo.tables, t2]
    });

    const model: Model = schema.model('t2') as Model;
    const product = model.field('product') as ForeignKeyField;
    expect((product.relatedField as RelatedField).throughField).toBeUndefined();
  });
});


test('setModelName', () => {
  const schema = new Schema(helper.getExampleData());
  const model = schema.model('post');
  const config: SchemaConfig = { models: [{ table: 'post', name: 'Post' }] };
  setModelName(config, model, 'WebPost');
  {
    const model = config.models.find(entry => entry.table === 'post');
    expect(model.name).toBe('WebPost');
  }
  {
    const model = config.models.find(entry => entry.table === 'user');
    const field = model.fields.find(entry => entry.column === 'first_post_id');
    expect(field.name).toBe('firstWebPost');
  }
  {
    const model = config.models.find(entry => entry.table === 'comment');
    const field = model.fields.find(entry => entry.column === 'post_id');
    expect(field.name).toBe('webPost');
  }
});
