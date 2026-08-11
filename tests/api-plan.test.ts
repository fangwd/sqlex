import { getExampleData } from './common';
import { Database as SchemaInfo } from '../src/types';
import { Schema } from '../src/schema';
import { ApiConfigError, compilePlan } from '../src/api';
import { ApiConfig } from '../src/api/config';

let schemaInfo: SchemaInfo;

beforeAll(() => (schemaInfo = getExampleData()));

function compile(config: ApiConfig) {
  return compilePlan(new Schema(schemaInfo), config);
}

function issuesOf(config: ApiConfig): string[] {
  try {
    compile(config);
  } catch (error) {
    if (error instanceof ApiConfigError) return error.issues;
    throw error;
  }
  throw Error('expected the configuration to be rejected');
}

describe('resources', () => {
  test('only configured models are exposed', () => {
    const plan = compile({ resources: { Product: {} } });
    expect(plan.resources.map(resource => resource.name)).toEqual(['Product']);
    expect(plan.resource('User')).toBe(undefined);
    expect(plan.resource('Product')?.model.name).toBe('Product');
  });

  test('a model can be named by its table', () => {
    const plan = compile({ resources: { order_item: {} } });
    expect(plan.resource('OrderItem')?.path).toBe('order-items');
  });

  test('unknown names are rejected', () => {
    expect(issuesOf({ resources: { Prodcut: {} } })).toEqual(['Prodcut: unknown model or table']);
  });

  test('one model cannot be configured twice', () => {
    expect(issuesOf({ resources: { Product: {}, product: {} } })).toEqual([
      "product: model Product is already configured as 'Product'",
    ]);
  });

  test('paths are kebab-case plurals and must be unique', () => {
    const plan = compile({ resources: { OrderItem: {}, DeliveryAddress: {}, Category: {} } });
    expect(plan.resources.map(resource => resource.path)).toEqual([
      'order-items',
      'delivery-addresses',
      'categories',
    ]);
    expect(plan.resourceAt('order-items')?.name).toBe('OrderItem');

    expect(
      issuesOf({ resources: { Product: { path: 'things' }, Store: { path: 'things' } } })
    ).toEqual(["Store: path 'things' is already used by 'Product'"]);
    expect(issuesOf({ resources: { Product: { path: 'a/b' } } })).toEqual([
      "Product: path 'a/b' is not a valid single URL segment",
    ]);
  });

  test('basePath is normalised', () => {
    expect(compile({ resources: { Product: {} } }).basePath).toBe('/');
    expect(compile({ basePath: 'api/v1/', resources: { Product: {} } }).basePath).toBe('/api/v1');
  });

  test('an empty configuration is rejected', () => {
    expect(issuesOf({ resources: {} })).toEqual([
      'resources: at least one resource must be configured',
    ]);
  });
});

describe('operations', () => {
  test('reads are exposed by default', () => {
    const plan = compile({ resources: { Product: {} } });
    expect([...(plan.resource('Product')?.operations ?? [])].sort()).toEqual(['get', 'list']);
  });

  test('operations can be narrowed', () => {
    const plan = compile({ resources: { Product: { operations: ['list'] } } });
    expect([...(plan.resource('Product')?.operations ?? [])]).toEqual(['list']);
  });

  test('writes are opted into, not defaulted', () => {
    const plan = compile({ resources: { Product: {} } });
    const operations = plan.resource('Product')?.operations;
    expect(operations?.has('create')).toBe(false);
    expect(operations?.has('update')).toBe(false);
    expect(operations?.has('delete')).toBe(false);

    const writable = compile({
      resources: { Product: { operations: ['list', 'get', 'create', 'update', 'delete'] } },
    });
    expect([...(writable.resource('Product')?.operations ?? [])].sort()).toEqual([
      'create',
      'delete',
      'get',
      'list',
      'update',
    ]);
  });

  test('unknown and empty operations are rejected', () => {
    expect(
      issuesOf({
        resources: { Product: { operations: ['upsert' as unknown as 'list'] } },
      })
    ).toEqual(["Product: unknown operation 'upsert'"]);
    expect(issuesOf({ resources: { Product: { operations: [] } } })).toEqual([
      'Product: operations must not be empty',
    ]);
  });
});

describe('identity', () => {
  test('a single-column primary key yields item routes', () => {
    const identity = compile({ resources: { Product: {} } }).resource('Product')?.identity;
    expect(identity?.composite).toBe(false);
    expect(identity?.fields.map(field => field.name)).toEqual(['id']);
  });

  test('a foreign key can be the primary key', () => {
    const identity = compile({ resources: { OrderShipping: {} } }).resource(
      'OrderShipping'
    )?.identity;
    expect(identity?.fields.map(field => field.name)).toEqual(['order']);
  });

  test('a composite primary key is reported in declaration order', () => {
    const plan = compilePlan(new Schema(compositeKeySchema()), { resources: { Enrolment: {} } });
    const identity = plan.resource('Enrolment')?.identity;
    expect(identity?.composite).toBe(true);
    // Foreign-key fields drop the `_id` suffix, so these are the route params.
    expect(identity?.fields.map(field => field.name)).toEqual(['student', 'course']);
    expect(identity?.fields.map(field => field.column.name)).toEqual(['student_id', 'course_id']);
  });

  test('a model without a primary key is collection-only', () => {
    const plan = compilePlan(new Schema(noKeySchema()), { resources: { AuditEntry: {} } });
    const resource = plan.resource('AuditEntry');
    expect(resource?.identity).toBe(null);
    expect([...(resource?.operations ?? [])]).toEqual(['list']);
    expect(plan.warnings).toEqual([
      'AuditEntry: no primary key on audit_entry; serving the collection only',
    ]);
  });

  test("an explicit 'get' on a keyless model is rejected", () => {
    let issues: string[] = [];
    try {
      compilePlan(new Schema(noKeySchema()), {
        resources: { AuditEntry: { operations: ['get'] } },
      });
    } catch (error) {
      if (!(error instanceof ApiConfigError)) throw error;
      issues = error.issues;
    }
    expect(issues).toEqual(["AuditEntry: operation 'get' needs a primary key on audit_entry"]);
  });
});

describe('read fields', () => {
  test("'*' exposes every column but no relation", () => {
    const fields = compile({ resources: { User: {} } }).resource('User')?.readFields;
    expect(fields?.map(field => field.name)).toEqual([
      'id',
      'email',
      'password',
      'firstName',
      'lastName',
      'status',
      'firstPost',
    ]);
  });

  test('exclude hides a column', () => {
    const fields = compile({
      resources: { User: { read: { exclude: ['password'] } } },
    }).resource('User')?.readFields;
    expect(fields?.map(field => field.name)).not.toContain('password');
  });

  test('an explicit list keeps schema order and accepts column names', () => {
    const fields = compile({
      resources: { User: { read: { fields: ['email', 'first_name', 'id'] } } },
    }).resource('User')?.readFields;
    expect(fields?.map(field => field.name)).toEqual(['id', 'email', 'firstName']);
  });

  test('unknown, relational and empty selections are rejected', () => {
    expect(issuesOf({ resources: { User: { read: { fields: ['emial'] } } } })).toEqual([
      "User: read 'emial' is not a column of User",
    ]);
    expect(issuesOf({ resources: { User: { read: { fields: ['orders'] } } } })).toEqual([
      "User: read 'orders' is not a column of User",
    ]);
    expect(issuesOf({ resources: { User: { read: { fields: ['user.email'] } } } })).toEqual([
      "User: read 'user.email' must be a field of User",
    ]);
    expect(issuesOf({ resources: { User: { read: { exclude: ['pasword'] } } } })).toEqual([
      "User: read.exclude 'pasword' is not a column of User",
    ]);
    expect(
      issuesOf({ resources: { Group: { read: { fields: ['id'], exclude: ['id'] } } } })
    ).toEqual(['Group: read leaves no fields exposed']);
  });
});

describe('write fields', () => {
  test('nothing is writable without a write operation', () => {
    expect(compile({ resources: { Product: {} } }).resource('Product')?.writeFields).toEqual([]);
  });

  test('every settable column is writable by default', () => {
    const fields = compile({
      resources: { Product: { operations: ['create', 'update'] } },
    }).resource('Product')?.writeFields;
    // id is generated, so a client cannot set it.
    expect(fields?.map(field => field.name)).toEqual([
      'sku',
      'name',
      'price',
      'stockQuantity',
      'status',
      'config',
    ]);
  });

  test('a write policy narrows what a client may set', () => {
    const listed = compile({
      resources: { Product: { operations: ['update'], write: { fields: ['name', 'price'] } } },
    }).resource('Product')?.writeFields;
    expect(listed?.map(field => field.name)).toEqual(['name', 'price']);

    const excluded = compile({
      resources: { Product: { operations: ['update'], write: { exclude: ['config'] } } },
    }).resource('Product')?.writeFields;
    expect(excluded?.map(field => field.name)).not.toContain('config');
  });

  test('read and write are independent', () => {
    const resource = compile({
      resources: {
        User: {
          operations: ['list', 'update'],
          read: { exclude: ['password'] },
          write: { fields: ['password'] },
        },
      },
    }).resource('User');
    expect(resource?.readFields.map(field => field.name)).not.toContain('password');
    expect(resource?.writeFields.map(field => field.name)).toEqual(['password']);
  });

  test('a generated column cannot be written', () => {
    expect(
      issuesOf({ resources: { Product: { operations: ['create'], write: { fields: ['id'] } } } })
    ).toEqual(["Product: write 'id' is not a column a client can set"]);
  });

  test('a create that cannot supply a required column is rejected', () => {
    expect(
      issuesOf({
        resources: {
          DeliveryAddress: { operations: ['create'], write: { fields: ['city'] } },
        },
      })
    ).toEqual([
      "DeliveryAddress: create needs 'streetAddress', 'state', 'country', 'postalCode', " +
        'which the write policy does not allow',
    ]);
  });

  test('a write policy with no write operation is rejected', () => {
    expect(
      issuesOf({ resources: { Product: { operations: ['list'], write: { fields: ['name'] } } } })
    ).toEqual(['Product: write is configured but no write operation is exposed']);
  });

  test('an empty write selection is rejected', () => {
    expect(
      issuesOf({ resources: { Product: { operations: ['update'], write: { fields: [] } } } })
    ).toEqual(['Product: write leaves no fields a client can set']);
  });
});

describe('filters', () => {
  test('nothing is filterable unless listed', () => {
    expect(compile({ resources: { Product: {} } }).resource('Product')?.filters).toEqual([]);
  });

  test('operators are the applicable ones minus like/ilike by default', () => {
    const filters = compile({
      resources: { Product: { filter: { fields: ['name', 'price', 'status'] } } },
    }).resource('Product')?.filters;

    expect(filters?.map(filter => filter.path)).toEqual(['name', 'price', 'status']);
    expect(filters?.[0].kind).toBe('string');
    expect(filters?.[0].operators).toEqual(['eq', 'ne', 'in', 'notIn', 'null']);
    expect(filters?.[1].kind).toBe('number');
    expect(filters?.[1].operators).toEqual(['eq', 'ne', 'lt', 'le', 'ge', 'gt', 'in', 'notIn', 'null']);
  });

  test('like is available when asked for', () => {
    const filters = compile({
      resources: { Product: { filter: { fields: ['name'], operators: ['eq', 'like'] } } },
    }).resource('Product')?.filters;
    expect(filters?.[0].operators).toEqual(['eq', 'like']);
  });

  test('operators can be defaulted for every resource', () => {
    const plan = compile({
      defaults: { operators: ['eq'] },
      resources: { Product: { filter: { fields: ['name'] } } },
    });
    expect(plan.resource('Product')?.filters[0].operators).toEqual(['eq']);
  });

  test('null is dropped for a non-nullable column', () => {
    const filters = compile({
      resources: { DeliveryAddress: { filter: { fields: ['city', 'id'] } } },
    }).resource('DeliveryAddress')?.filters;
    expect(filters?.[0].operators).not.toContain('null');
    expect(filters?.[1].operators).not.toContain('null');
  });

  test('a foreign-key path is canonicalised', () => {
    const filters = compile({
      resources: { OrderItem: { filter: { fields: ['order.user.email', 'order_id'] } } },
    }).resource('OrderItem')?.filters;
    expect(filters?.map(filter => filter.path)).toEqual(['order.user.email', 'order']);
  });

  test('unfilterable columns and bad paths are rejected', () => {
    // json needs a document-path syntax the request layer doesn't parse yet.
    expect(issuesOf({ resources: { Product: { filter: { fields: ['config'] } } } })).toEqual([
      "Product: filter 'config' (json) has no usable operator",
    ]);
    expect(
      issuesOf({ resources: { OrderItem: { filter: { fields: ['quantity.name'] } } } })
    ).toEqual(["OrderItem: filter 'quantity.name': 'quantity' is not a foreign key of OrderItem"]);
    expect(issuesOf({ resources: { Order: { filter: { fields: ['orderItems'] } } } })).toEqual([
      "Order: filter 'orderItems': 'orderItems' is not a column of Order",
    ]);
    expect(
      issuesOf({
        resources: { Product: { filter: { fields: ['name'], operators: ['gte' as 'ge'] } } },
      })
    ).toEqual(["Product: unknown filter operator 'gte'"]);
  });
});

describe('duplicates', () => {
  test('a field listed twice yields one filter, sort and include', () => {
    const plan = compile({
      resources: {
        Order: {
          // 'code' and 'id' repeated by name and by column name.
          filter: { fields: ['code', 'code', 'user_id', 'user'] },
          sort: { fields: ['date_created', 'dateCreated'] },
          include: { relations: ['user', 'user'] },
        },
        User: {},
      },
    });
    const resource = plan.resource('Order');
    expect(resource?.filters.map(filter => filter.path)).toEqual(['code', 'user']);
    expect(resource?.sorts.map(sort => sort.path)).toEqual(['dateCreated']);
    expect(resource?.includes.map(include => include.name)).toEqual(['user']);
  });
});

describe('column kinds', () => {
  test('a mysql-style enum column is a filterable string', () => {
    const plan = compilePlan(new Schema(enumSchema()), {
      resources: { Ticket: { filter: { fields: ['priority'] }, sort: { fields: ['priority'] } } },
    });
    const filter = plan.resource('Ticket')?.filters[0];
    expect(filter?.kind).toBe('enum');
    expect(filter?.operators).toEqual(['eq', 'ne', 'in', 'notIn', 'null']);
    expect(plan.resource('Ticket')?.sorts.map(sort => sort.path)).toEqual(['priority']);
  });

  test('a postgres enum column is recognised through its user-defined type', () => {
    const plan = compilePlan(new Schema(enumSchema()), {
      resources: { Ticket: { filter: { fields: ['state'] } } },
    });
    expect(plan.resource('Ticket')?.filters[0].kind).toBe('enum');
  });
});

describe('aggregates', () => {
  test('the aggregate plan grants what the config names', () => {
    const plan = compile({
      resources: {
        Product: {
          operations: ['aggregate'],
          aggregate: { groupBy: ['status', 'status'], fields: ['price', 'sku'] },
        },
      },
    });
    const aggregate = plan.resource('Product')?.aggregate;
    expect(aggregate?.groupBy.map(entry => entry.path)).toEqual(['status']);
    expect(aggregate?.summable.map(field => field.name)).toEqual(['price']);
    expect(aggregate?.comparable.map(field => field.name)).toEqual(['price', 'sku']);
  });

  test('exposing the operation alone grants counting only', () => {
    const plan = compile({ resources: { Product: { operations: ['aggregate'] } } });
    expect(plan.resource('Product')?.aggregate).toEqual({
      groupBy: [],
      summable: [],
      comparable: [],
    });
    expect(compile({ resources: { Product: {} } }).resource('Product')?.aggregate).toBe(undefined);
  });

  test('incoherent aggregate configurations are rejected', () => {
    expect(
      issuesOf({ resources: { Product: { aggregate: { groupBy: ['status'] } } } })
    ).toEqual(['Product: aggregate is configured but the aggregate operation is not exposed']);
    expect(
      issuesOf({
        resources: { Product: { operations: ['aggregate'], aggregate: { groupBy: ['nope'] } } },
      })
    ).toEqual(["Product: aggregate.groupBy 'nope' is not a column of Product"]);
    expect(
      issuesOf({
        resources: { Product: { operations: ['aggregate'], aggregate: { fields: ['config'] } } },
      })
    ).toEqual([
      "Product: aggregate.fields 'config' is a json column, which no function applies to",
    ]);
    expect(
      issuesOf({
        resources: { OrderItem: { operations: ['aggregate'], aggregate: { fields: ['order'] } } },
      })
    ).toEqual([
      "OrderItem: aggregate.fields 'order' is a foreign key, which no function applies to",
    ]);
  });

  test('a string key warns that the aggregate route shadows one value', () => {
    const plan = compilePlan(new Schema(stringKeySchema()), {
      resources: { Tag: { operations: ['list', 'get', 'aggregate'] } },
    });
    expect(plan.warnings).toEqual([
      "Tag: the aggregate route shadows the Tag whose key is the string 'aggregate'",
    ]);
  });

  test('a filter colliding with an aggregate parameter is rejected only there', () => {
    const schema = new Schema(reservedNameSchema());
    // 'count' is fine as a filter on a resource without aggregates...
    const plan = compilePlan(schema, {
      resources: { Invoice: { filter: { fields: ['count'] } } },
    });
    expect(plan.resource('Invoice')?.filters.map(filter => filter.path)).toEqual(['count']);

    // ...but shadowed once the aggregate route reads it.
    let issues: string[] = [];
    try {
      compilePlan(schema, {
        resources: { Invoice: { operations: ['list', 'aggregate'], filter: { fields: ['count'] } } },
      });
    } catch (error) {
      if (!(error instanceof ApiConfigError)) throw error;
      issues = error.issues;
    }
    expect(issues).toEqual([
      "Invoice: filter 'count' collides with the reserved parameter of that name",
    ]);
  });
});

describe('schema names', () => {
  test('a model whose name the document reserves is rejected', () => {
    const schema: SchemaInfo = {
      name: 'test',
      tables: [
        {
          name: 'problem',
          columns: [{ name: 'id', type: 'integer', nullable: false }],
          constraints: [{ primaryKey: true, columns: ['id'] }],
        },
      ],
    };
    let issues: string[] = [];
    try {
      compilePlan(new Schema(schema), { resources: { Problem: {} } });
    } catch (error) {
      if (!(error instanceof ApiConfigError)) throw error;
      issues = error.issues;
    }
    expect(issues).toEqual([
      "Problem: the row schema would be named 'Problem', which the document reserves; " +
        'rename the model',
    ]);
  });

  test('a model colliding with a generated body schema is rejected', () => {
    const schema: SchemaInfo = {
      name: 'test',
      tables: [
        {
          name: 'user',
          columns: [
            { name: 'id', type: 'integer', nullable: false },
            { name: 'email', type: 'varchar', size: 100 },
          ],
          constraints: [{ primaryKey: true, columns: ['id'] }],
        },
        {
          name: 'user_create',
          columns: [{ name: 'id', type: 'integer', nullable: false }],
          constraints: [{ primaryKey: true, columns: ['id'] }],
        },
      ],
    };
    let issues: string[] = [];
    try {
      compilePlan(new Schema(schema), {
        resources: { User: { operations: ['list', 'create'] }, UserCreate: {} },
      });
    } catch (error) {
      if (!(error instanceof ApiConfigError)) throw error;
      issues = error.issues;
    }
    expect(issues).toEqual([
      "User: the create body schema would be named 'UserCreate', which collides with " +
        "UserCreate's row schema; rename the model",
    ]);
  });
});

describe('reserved names', () => {
  test('a filter colliding with a pagination parameter is rejected', () => {
    // `total` would be read as the pagination flag, never as a filter.
    const plan = compilePlan(new Schema(reservedNameSchema()), {
      resources: { Invoice: { sort: { fields: ['total'] } } },
    });
    expect(plan.resource('Invoice')?.sorts.map(sort => sort.path)).toEqual(['total']);

    let issues: string[] = [];
    try {
      compilePlan(new Schema(reservedNameSchema()), {
        resources: { Invoice: { filter: { fields: ['total'] } } },
      });
    } catch (error) {
      if (!(error instanceof ApiConfigError)) throw error;
      issues = error.issues;
    }
    expect(issues).toEqual([
      "Invoice: filter 'total' collides with the reserved parameter of that name",
    ]);
  });
});

describe('sorting', () => {
  test('nothing is sortable unless listed', () => {
    expect(compile({ resources: { Product: {} } }).resource('Product')?.sorts).toEqual([]);
  });

  test('sortable paths and defaults are canonicalised', () => {
    const resource = compile({
      resources: {
        Order: {
          sort: { fields: ['date_created', 'user.email'], default: ['-date_created'] },
        },
      },
    }).resource('Order');
    expect(resource?.sorts.map(sort => sort.path)).toEqual(['dateCreated', 'user.email']);
    expect(resource?.defaultSort).toEqual(['-dateCreated']);
  });

  test('json columns and unlisted defaults are rejected', () => {
    expect(issuesOf({ resources: { Product: { sort: { fields: ['config'] } } } })).toEqual([
      "Product: sort 'config' is a json column and cannot be ordered",
    ]);
    expect(
      issuesOf({ resources: { Product: { sort: { fields: ['name'], default: ['price'] } } } })
    ).toEqual(["Product: sort.default 'price' is not one of the sortable fields"]);
  });
});

describe('includes', () => {
  test('relation kinds and targets are resolved', () => {
    const plan = compile({
      resources: {
        Order: { include: { relations: ['user', 'orderItems', 'orderShipping'] } },
        User: {},
        OrderItem: {},
        OrderShipping: {},
      },
    });
    const includes = plan.resource('Order')?.includes ?? [];
    expect(includes.map(include => [include.name, include.kind, include.target.name])).toEqual([
      ['user', 'one', 'User'],
      ['orderItems', 'many', 'OrderItem'],
      ['orderShipping', 'one', 'OrderShipping'],
    ]);
  });

  test('a many-to-many relation resolves through its join table', () => {
    const plan = compile({
      resources: { Product: { include: { relations: ['categories'] } }, Category: {} },
    });
    const include = plan.resource('Product')?.includes[0];
    expect(include?.kind).toBe('many');
    expect(include?.target.name).toBe('Category');
  });

  test('an embedded collection is capped, a single row is not', () => {
    const plan = compile({
      resources: {
        Order: { include: { relations: ['user', 'orderItems'] }, page: { defaultLimit: 25 } },
        User: {},
        OrderItem: {},
      },
    });
    const includes = plan.resource('Order')?.includes ?? [];
    expect(includes[0].limit).toBe(undefined);
    expect(includes[1].limit).toBe(25);

    const capped = compile({
      defaults: { includeLimit: 5 },
      resources: { Order: { include: { relations: ['orderItems'] } }, OrderItem: {} },
    });
    expect(capped.resource('Order')?.includes[0].limit).toBe(5);
  });

  test('a relation to an unexposed model is rejected', () => {
    expect(issuesOf({ resources: { Order: { include: { relations: ['user'] } } } })).toEqual([
      "Order: include 'user' targets User, which is not an exposed resource",
    ]);
  });

  test('expanding a foreign key hidden from reads is rejected', () => {
    expect(
      issuesOf({
        resources: {
          Order: { read: { exclude: ['user'] }, include: { relations: ['user'] } },
          User: {},
        },
      })
    ).toEqual(["Order: include 'user' is not readable, so it cannot be expanded"]);
  });

  test('a collection include needs a single-column key to group by', () => {
    // sqlex resolves a reverse relation by grouping rows under the parent's own
    // key, which a table without a single-column primary key cannot provide.
    let issues: string[] = [];
    try {
      compilePlan(new Schema(keylessParentSchema()), {
        resources: { Log: { include: { relations: ['logLines'] } }, LogLine: {} },
      });
    } catch (error) {
      if (!(error instanceof ApiConfigError)) throw error;
      issues = error.issues;
    }
    expect(issues).toEqual([
      "Log: include 'logLines' is a collection, which needs a single-column primary key on log",
    ]);

    // A to-one include on the same model is fine: no grouping is involved.
    const plan = compilePlan(new Schema(keylessParentSchema()), {
      resources: { Log: {}, LogLine: { include: { relations: ['log'] } } },
    });
    expect(plan.resource('LogLine')?.includes.map(include => include.name)).toEqual(['log']);
  });

  test('non-relations, nested paths and bad depth are rejected', () => {
    expect(issuesOf({ resources: { Order: { include: { relations: ['code'] } } } })).toEqual([
      "Order: include 'code' is not a relation",
    ]);
    expect(issuesOf({ resources: { Order: { include: { relations: ['orders'] } } } })).toEqual([
      "Order: include 'orders' is not a field of Order",
    ]);
    expect(
      issuesOf({ resources: { Order: { include: { relations: ['user.email'] } } } })
    ).toEqual([
      "Order: include 'user.email' must be a single relation; nesting comes from the request",
    ]);
    expect(issuesOf({ resources: { Order: { include: { maxDepth: 0 } } } })).toEqual([
      'Order: include.maxDepth must be a positive integer, got 0',
    ]);
  });

  test('maxDepth defaults to 2 and can be defaulted globally', () => {
    expect(compile({ resources: { Order: {} } }).resource('Order')?.includeMaxDepth).toBe(2);
    expect(
      compile({ defaults: { includeMaxDepth: 4 }, resources: { Order: {} } }).resource('Order')
        ?.includeMaxDepth
    ).toBe(4);
  });
});

describe('pagination', () => {
  test('limits default and can be overridden per resource', () => {
    expect(compile({ resources: { Product: {} } }).resource('Product')?.page).toEqual({
      defaultLimit: 50,
      maxLimit: 200,
    });
    const plan = compile({
      defaults: { page: { defaultLimit: 10, maxLimit: 20 } },
      resources: { Product: {}, Store: { page: { maxLimit: 1000 } } },
    });
    expect(plan.resource('Product')?.page).toEqual({ defaultLimit: 10, maxLimit: 20 });
    expect(plan.resource('Store')?.page).toEqual({ defaultLimit: 10, maxLimit: 1000 });
  });

  test('inconsistent limits are rejected', () => {
    expect(
      issuesOf({ resources: { Product: { page: { defaultLimit: 500, maxLimit: 100 } } } })
    ).toEqual(['Product: page.defaultLimit (500) exceeds page.maxLimit (100)']);
    expect(issuesOf({ resources: { Product: { page: { maxLimit: 0 } } } })).toEqual([
      'Product: page.maxLimit must be a positive integer, got 0',
      'Product: page.defaultLimit (50) exceeds page.maxLimit (0)',
    ]);
  });
});

describe('scope', () => {
  test('a scope function is carried into the plan', () => {
    const scope = () => ({ status: 1 });
    const plan = compilePlan<{ tenant: number }>(new Schema(schemaInfo), {
      resources: { Product: { scope } },
    });
    expect(plan.resource('Product')?.scope).toBe(scope);
  });
});

describe('reporting', () => {
  test('every issue is reported at once', () => {
    const issues = issuesOf({
      resources: {
        Prodcut: {},
        User: { read: { fields: ['emial'] }, sort: { fields: ['config'] } },
      },
    });
    expect(issues).toEqual([
      'Prodcut: unknown model or table',
      "User: read 'emial' is not a column of User",
      "User: sort 'config': 'config' is not a column of User",
    ]);
  });

  test('hiding the primary key from reads is reported as a warning', () => {
    const plan = compile({ resources: { Product: { read: { exclude: ['id'] } } } });
    expect(plan.warnings).toEqual([
      "Product: primary key 'id' is hidden from reads, so a client cannot build an item URL" +
        ' from a list entry',
    ]);
    // Collection-only resources have no item URL to build, so no warning.
    expect(
      compile({
        resources: { Product: { operations: ['list'], read: { exclude: ['id'] } } },
      }).warnings
    ).toEqual([]);
  });

  test('exposing a vector column is reported as a warning', () => {
    const plan = compilePlan(new Schema(vectorSchema()), { resources: { Passage: {} } });
    expect(plan.warnings).toEqual(["Passage: read includes the vector column 'embedding'"]);
    expect(plan.resource('Passage')?.readFields.map(field => field.name)).toEqual([
      'id',
      'body',
      'embedding',
    ]);
  });
});

function compositeKeySchema(): SchemaInfo {
  return {
    name: 'test',
    tables: [
      {
        name: 'student',
        columns: [{ name: 'id', type: 'integer', nullable: false }],
        constraints: [{ primaryKey: true, columns: ['id'] }],
      },
      {
        name: 'course',
        columns: [{ name: 'id', type: 'integer', nullable: false }],
        constraints: [{ primaryKey: true, columns: ['id'] }],
      },
      {
        name: 'enrolment',
        columns: [
          { name: 'student_id', type: 'integer', nullable: false },
          { name: 'course_id', type: 'integer', nullable: false },
          { name: 'grade', type: 'int' },
        ],
        constraints: [
          { primaryKey: true, columns: ['student_id', 'course_id'] },
          { columns: ['student_id'], references: { table: 'student', columns: ['id'] } },
          { columns: ['course_id'], references: { table: 'course', columns: ['id'] } },
        ],
      },
    ],
  };
}

function reservedNameSchema(): SchemaInfo {
  return {
    name: 'test',
    tables: [
      {
        name: 'invoice',
        columns: [
          { name: 'id', type: 'integer', nullable: false },
          { name: 'total', type: 'decimal', precision: 10, scale: 2 },
          { name: 'count', type: 'int' },
        ],
        constraints: [{ primaryKey: true, columns: ['id'] }],
      },
    ],
  };
}

function stringKeySchema(): SchemaInfo {
  return {
    name: 'test',
    tables: [
      {
        name: 'tag',
        columns: [
          { name: 'name', type: 'varchar', size: 40, nullable: false },
          { name: 'uses', type: 'int' },
        ],
        constraints: [{ primaryKey: true, columns: ['name'] }],
      },
    ],
  };
}

/** A parent with a unique column but no primary key, so it has no row key. */
function keylessParentSchema(): SchemaInfo {
  return {
    name: 'test',
    tables: [
      {
        name: 'log',
        columns: [
          { name: 'id', type: 'integer', nullable: false },
          { name: 'message', type: 'varchar' },
        ],
        constraints: [{ unique: true, columns: ['id'] }],
      },
      {
        name: 'log_line',
        columns: [
          { name: 'id', type: 'integer', nullable: false },
          { name: 'log_id', type: 'integer' },
          { name: 'text', type: 'varchar' },
        ],
        constraints: [
          { primaryKey: true, columns: ['id'] },
          { columns: ['log_id'], references: { table: 'log', columns: ['id'] } },
        ],
      },
    ],
  };
}

function noKeySchema(): SchemaInfo {
  return {
    name: 'test',
    tables: [
      {
        name: 'audit_entry',
        columns: [
          { name: 'event', type: 'varchar' },
          { name: 'at', type: 'datetime' },
        ],
        constraints: [],
      },
    ],
  };
}

function enumSchema(): SchemaInfo {
  return {
    name: 'test',
    tables: [
      {
        name: 'ticket',
        columns: [
          { name: 'id', type: 'integer', nullable: false },
          { name: 'priority', type: 'enum' },
          {
            name: 'state',
            type: 'varchar',
            userDefinedType: { type: 'enum', name: 'ticket_state', values: ['open', 'closed'] },
          },
        ],
        constraints: [{ primaryKey: true, columns: ['id'] }],
      },
    ],
  };
}

function vectorSchema(): SchemaInfo {
  return {
    name: 'test',
    tables: [
      {
        name: 'passage',
        columns: [
          { name: 'id', type: 'integer', nullable: false },
          { name: 'body', type: 'text' },
          { name: 'embedding', type: 'vector', dimensions: 3 },
        ],
        constraints: [{ primaryKey: true, columns: ['id'] }],
      },
    ],
  };
}
