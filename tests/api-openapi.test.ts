import { getExampleData } from './common';
import { Database as SchemaInfo } from '../src/types';
import { Schema } from '../src/schema';
import { compilePlan, generateOpenApi } from '../src/api';
import { ApiConfig } from '../src/api/config';
import { OpenApiDocument, OpenApiOptions, ParameterObject } from '../src/api/openapi';

let schemaInfo: SchemaInfo;

beforeAll(() => (schemaInfo = getExampleData()));

function document(config: ApiConfig, options?: OpenApiOptions): OpenApiDocument {
  return generateOpenApi(compilePlan(new Schema(schemaInfo), config), options);
}

function parameters(doc: OpenApiDocument, path: string): ParameterObject[] {
  const operation = doc.paths[path]?.get;
  if (!operation) throw Error(`no GET ${path} in the document`);
  return operation.parameters;
}

function parameter(doc: OpenApiDocument, path: string, name: string): ParameterObject {
  const found = parameters(doc, path).find(entry => entry.name === name);
  if (!found) throw Error(`no '${name}' parameter on GET ${path}`);
  return found;
}

/** Every $ref in the document, so dangling references can be caught. */
function refs(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) refs(entry, found);
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (key === '$ref' && typeof entry === 'string') found.push(entry);
      else refs(entry, found);
    }
  }
  return found;
}

describe('document', () => {
  test('is OpenAPI 3.1 with defaulted info', () => {
    const doc = document({ resources: { Product: {} } });
    expect(doc.openapi).toBe('3.1.1');
    expect(doc.info).toEqual({ title: 'sqlex API', version: '1.0.0' });
    expect(doc.servers).toBe(undefined);
    expect(doc.tags).toEqual([{ name: 'Product' }]);
  });

  test('carries the caller-supplied info and servers', () => {
    const doc = document(
      { resources: { Product: {} } },
      { title: 'Catalogue', version: '2.1.0', description: 'Products', servers: [{ url: 'https://api.example.com' }] }
    );
    expect(doc.info).toEqual({ title: 'Catalogue', version: '2.1.0', description: 'Products' });
    expect(doc.servers).toEqual([{ url: 'https://api.example.com' }]);
  });

  test('turns a basePath into a server entry, keeping paths relative', () => {
    const doc = document({ basePath: '/api/v1', resources: { Product: {} } });
    expect(doc.servers).toEqual([{ url: '/api/v1' }]);
    expect(Object.keys(doc.paths)).toEqual(['/products', '/products/{id}']);
  });

  test('every $ref resolves', () => {
    const doc = document({
      resources: {
        Order: { include: { relations: ['user', 'orderItems'] }, filter: { fields: ['code'] } },
        User: {},
        OrderItem: {},
      },
    });
    const defined = new Set([
      ...Object.keys(doc.components.schemas).map(name => `#/components/schemas/${name}`),
      ...Object.keys(doc.components.responses).map(name => `#/components/responses/${name}`),
    ]);
    for (const ref of refs(doc)) expect(defined).toContain(ref);
  });
});

describe('paths', () => {
  test('a resource gets a collection and an item route', () => {
    const doc = document({ resources: { OrderItem: {} } });
    expect(Object.keys(doc.paths)).toEqual(['/order-items', '/order-items/{id}']);
    expect(doc.paths['/order-items'].get?.operationId).toBe('listOrderItems');
    expect(doc.paths['/order-items'].get?.summary).toBe('List orderItems');
    expect(doc.paths['/order-items/{id}'].get?.operationId).toBe('getOrderItem');
    expect(doc.paths['/order-items/{id}'].get?.tags).toEqual(['OrderItem']);
  });

  test('a list-only resource has no item route', () => {
    const doc = document({ resources: { Product: { operations: ['list'] } } });
    expect(Object.keys(doc.paths)).toEqual(['/products']);
  });

  test('an item-only resource has no collection route', () => {
    const doc = document({ resources: { Product: { operations: ['get'] } } });
    expect(Object.keys(doc.paths)).toEqual(['/products/{id}']);
  });

  test('a composite key becomes one segment of comma-separated params', () => {
    const plan = compilePlan(new Schema(compositeKeySchema()), {
      resources: { Enrolment: {}, Student: {}, Course: {} },
    });
    const doc = generateOpenApi(plan);
    expect(doc.paths['/enrolments/{student},{course}']).toBeDefined();
    const params = doc.paths['/enrolments/{student},{course}'].get?.parameters ?? [];
    expect(params.filter(entry => entry.in === 'path')).toEqual([
      { name: 'student', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'course', in: 'path', required: true, schema: { type: 'integer' } },
    ]);
  });

  test('responses are the documented envelopes', () => {
    const doc = document({ resources: { Product: {} } });
    expect(doc.paths['/products'].get?.responses['200']).toEqual({
      description: 'A page of products.',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              data: { type: 'array', items: { $ref: '#/components/schemas/Product' } },
              meta: { $ref: '#/components/schemas/PageMeta' },
            },
            required: ['data', 'meta'],
          },
        },
      },
    });
    expect(doc.paths['/products'].get?.responses['400']).toEqual({
      $ref: '#/components/responses/BadRequest',
    });
    // The item route validates include/fields too, so it can also answer 400.
    expect(Object.keys(doc.paths['/products/{id}'].get?.responses ?? {})).toEqual([
      '200',
      '400',
      '404',
    ]);
    expect(doc.paths['/products/{id}'].get?.responses['404']).toEqual({
      $ref: '#/components/responses/NotFound',
    });
    expect(doc.components.responses.NotFound.content?.['application/problem+json'].schema).toEqual({
      $ref: '#/components/schemas/Problem',
    });
  });
});

describe('filter parameters', () => {
  test('one parameter per field and operator, with eq unsuffixed', () => {
    const doc = document({
      resources: { Product: { operations: ['list'], filter: { fields: ['name', 'price'] } } },
    });
    expect(parameters(doc, '/products').map(entry => entry.name)).toEqual([
      'name',
      'name_ne',
      'name_in',
      'name_notIn',
      'name_null',
      'price',
      'price_ne',
      'price_lt',
      'price_le',
      'price_ge',
      'price_gt',
      'price_in',
      'price_notIn',
      'price_null',
      'fields',
      'limit',
      'offset',
      'cursor',
      'total',
    ]);
  });

  test('list, null and pattern operators take their own value types', () => {
    const doc = document({
      resources: {
        Product: {
          operations: ['list'],
          filter: { fields: ['name', 'price'], operators: ['eq', 'in', 'null', 'like'] },
        },
      },
    });
    expect(parameter(doc, '/products', 'price_in')).toEqual({
      name: 'price_in',
      in: 'query',
      description: 'price is any of (comma separated)',
      style: 'form',
      explode: false,
      schema: { type: 'array', items: { type: 'number' } },
    });
    expect(parameter(doc, '/products', 'name_null').schema).toEqual({ type: 'boolean' });
    expect(parameter(doc, '/products', 'name_like').schema).toEqual({ type: 'string' });
    expect(parameter(doc, '/products', 'price').schema).toEqual({ type: 'number' });
  });

  test('a foreign key is filtered by its key value', () => {
    const doc = document({
      resources: { Order: { operations: ['list'], filter: { fields: ['user'] } }, User: {} },
    });
    expect(parameter(doc, '/orders', 'user').schema).toEqual({ type: 'integer' });
  });

  test('a filter across a relation keeps its dotted name', () => {
    const doc = document({
      resources: {
        OrderItem: { operations: ['list'], filter: { fields: ['order.user.email'] } },
      },
    });
    expect(parameter(doc, '/order-items', 'order.user.email').schema).toEqual({
      type: 'string',
      maxLength: 200,
    });
  });
});

describe('query parameters', () => {
  test('sort enumerates both directions and mentions the default', () => {
    const doc = document({
      resources: {
        Order: {
          operations: ['list'],
          sort: { fields: ['code', 'dateCreated'], default: ['-dateCreated'] },
        },
      },
    });
    expect(parameter(doc, '/orders', 'sort')).toEqual({
      name: 'sort',
      in: 'query',
      description: "Sort order; defaults to -dateCreated. Prefix with '-' for descending.",
      style: 'form',
      explode: false,
      schema: {
        type: 'array',
        items: { type: 'string', enum: ['code', '-code', 'dateCreated', '-dateCreated'] },
      },
    });
  });

  test('sort is absent when nothing is sortable', () => {
    const doc = document({ resources: { Product: { operations: ['list'] } } });
    expect(parameters(doc, '/products').map(entry => entry.name)).not.toContain('sort');
  });

  test('include lists the available relations and the depth limit', () => {
    const doc = document({
      resources: {
        Order: { include: { relations: ['user', 'orderItems'], maxDepth: 3 } },
        User: {},
        OrderItem: {},
      },
    });
    expect(parameter(doc, '/orders', 'include').description).toBe(
      'Relations to embed (comma separated), up to 3 levels deep. ' +
        'Directly available here: user, orderItems.'
    );
    // The item route accepts include and fields too.
    expect(parameters(doc, '/orders/{id}').map(entry => entry.name)).toEqual([
      'id',
      'include',
      'fields',
    ]);
  });

  test('fields enumerates only the readable columns', () => {
    const doc = document({
      resources: { User: { operations: ['list'], read: { exclude: ['password'] } } },
    });
    expect(parameter(doc, '/users', 'fields').schema.items?.enum).toEqual([
      'id',
      'email',
      'firstName',
      'lastName',
      'status',
      'firstPost',
    ]);
  });

  test('pagination parameters carry the resource limits', () => {
    const doc = document({
      resources: { Product: { operations: ['list'], page: { defaultLimit: 25, maxLimit: 75 } } },
    });
    expect(parameter(doc, '/products', 'limit').schema).toEqual({
      type: 'integer',
      minimum: 1,
      maximum: 75,
      default: 25,
    });
    expect(parameter(doc, '/products', 'offset').schema).toEqual({
      type: 'integer',
      minimum: 0,
      default: 0,
    });
    expect(parameter(doc, '/products', 'total').schema).toEqual({
      type: 'boolean',
      default: false,
    });
  });
});

describe('write operations', () => {
  const writable: ApiConfig = {
    resources: {
      Product: {
        operations: ['list', 'get', 'create', 'update', 'delete'],
        write: { exclude: ['config'] },
      },
    },
  };

  test('methods appear on the routes that serve them', () => {
    const doc = document(writable);
    expect(Object.keys(doc.paths['/products'])).toEqual(['get', 'post']);
    expect(Object.keys(doc.paths['/products/{id}'])).toEqual(['get', 'patch', 'delete']);
    expect(doc.paths['/products'].post?.operationId).toBe('createProduct');
    expect(doc.paths['/products/{id}'].patch?.operationId).toBe('updateProduct');
    expect(doc.paths['/products/{id}'].delete?.operationId).toBe('deleteProduct');
  });

  test('a read-only resource has no write methods', () => {
    const doc = document({ resources: { Product: {} } });
    expect(Object.keys(doc.paths['/products'])).toEqual(['get']);
    expect(Object.keys(doc.paths['/products/{id}'])).toEqual(['get']);
    expect(doc.components.schemas.ProductCreate).toBe(undefined);
    expect(doc.components.schemas.ProductUpdate).toBe(undefined);
  });

  test('a create body requires what the column cannot default', () => {
    const doc = document(writable);
    const create = doc.components.schemas.ProductCreate;
    // id is generated, config is excluded from writes.
    expect(Object.keys(create.properties ?? {})).toEqual([
      'sku',
      'name',
      'price',
      'stockQuantity',
      'status',
    ]);
    expect(create.additionalProperties).toBe(false);
    expect(create.required).toBe(undefined);
    expect(doc.paths['/products'].post?.requestBody).toEqual({
      required: true,
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/ProductCreate' } },
      },
    });
  });

  test('an update body requires nothing', () => {
    const doc = document(writable);
    const update = doc.components.schemas.ProductUpdate;
    expect(update.required).toBe(undefined);
    expect(Object.keys(update.properties ?? {})).toEqual(
      Object.keys(doc.components.schemas.ProductCreate.properties ?? {})
    );
  });

  test('a required column is listed as required', () => {
    const doc = document({
      resources: { DeliveryAddress: { operations: ['create'] } },
    });
    expect(doc.components.schemas.DeliveryAddressCreate.required).toEqual([
      'streetAddress',
      'city',
      'state',
      'country',
      'postalCode',
    ]);
  });

  test('a column with a SQL default is optional on create', () => {
    const info = structuredClone(schemaInfo);
    const table = info.tables.find(entry => entry.name === 'delivery_address')!;
    table.columns.find(column => column.name === 'postal_code')!.defaultSql = "'00000'";
    const doc = generateOpenApi(
      compilePlan(new Schema(info), {
        resources: { DeliveryAddress: { operations: ['create'] } },
      })
    );
    expect(doc.components.schemas.DeliveryAddressCreate.required).toEqual([
      'streetAddress',
      'city',
      'state',
      'country',
    ]);
  });

  test('a relation is written as a key value, never an object', () => {
    const doc = document({
      resources: { OrderItem: { operations: ['create'] }, Order: {}, Product: {} },
    });
    const create = doc.components.schemas.OrderItemCreate;
    expect(create.properties?.order).toEqual({ type: ['integer', 'null'] });
    expect(JSON.stringify(create)).not.toContain('$ref');
  });

  test('write statuses are documented', () => {
    const doc = document(writable);
    expect(Object.keys(doc.paths['/products'].post?.responses ?? {})).toEqual([
      '201',
      '400',
      '409',
      '415',
      '422',
    ]);
    expect(Object.keys(doc.paths['/products/{id}'].patch?.responses ?? {})).toEqual([
      '200',
      '400',
      '404',
      '409',
      '415',
      '422',
    ]);
    expect(doc.paths['/products/{id}'].delete?.responses['204']).toEqual({
      description: 'Deleted.',
    });
    expect(doc.components.responses.Conflict.content?.['application/problem+json'].schema).toEqual({
      $ref: '#/components/schemas/Problem',
    });
  });

  test('a column outside the write policy is in no request body', () => {
    const doc = document({
      resources: {
        User: {
          operations: ['list', 'create', 'update'],
          read: { exclude: ['password'] },
          write: { fields: ['email'] },
        },
      },
    });
    expect(JSON.stringify(doc)).not.toContain('password');
    expect(Object.keys(doc.components.schemas.UserCreate.properties ?? {})).toEqual(['email']);
  });
});

describe('aggregate operation', () => {
  test('the route is documented with its grants and nothing more', () => {
    const doc = document({
      resources: {
        Product: {
          operations: ['list', 'aggregate'],
          filter: { fields: ['status'] },
          aggregate: { groupBy: ['status'], fields: ['price'] },
        },
      },
    });
    const operation = doc.paths['/products/aggregate'].get;
    expect(operation?.operationId).toBe('aggregateProducts');
    const names = operation?.parameters.map(entry => entry.name);
    expect(names).toEqual([
      'groupBy',
      'count',
      'sum',
      'avg',
      'min',
      'max',
      'status',
      'status_ne',
      'status_lt',
      'status_le',
      'status_ge',
      'status_gt',
      'status_in',
      'status_notIn',
      'status_null',
      'limit',
      'offset',
    ]);
    expect(operation?.parameters.find(entry => entry.name === 'groupBy')?.schema.items?.enum).toEqual(
      ['status']
    );
    expect(operation?.parameters.find(entry => entry.name === 'sum')?.schema.items?.enum).toEqual([
      'price',
    ]);
  });

  test('a count-only aggregate documents no group or function parameters', () => {
    const doc = document({ resources: { Product: { operations: ['aggregate'] } } });
    const names = doc.paths['/products/aggregate'].get?.parameters.map(entry => entry.name);
    expect(names).toEqual(['count', 'limit', 'offset']);
    expect(Object.keys(doc.paths)).toEqual(['/products/aggregate']);
  });

  test('an unexposed aggregate appears nowhere', () => {
    const doc = document({ resources: { Product: {} } });
    expect(doc.paths['/products/aggregate']).toBe(undefined);
  });
});

describe('schemas', () => {
  test('a row schema has every column optional and nothing else', () => {
    const doc = document({ resources: { Group: {} } });
    expect(doc.components.schemas.Group).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'integer' },
        name: { type: ['string', 'null'], maxLength: 200 },
      },
    });
  });

  test('a nullable foreign key points at the target schema or null', () => {
    const doc = document({ resources: { Order: {}, User: {}, DeliveryAddress: {} } });
    const order = doc.components.schemas.Order;
    expect(order.properties?.user).toEqual({
      anyOf: [{ $ref: '#/components/schemas/User' }, { type: 'null' }],
    });
  });

  test('a foreign key to an unexposed model contributes only its key', () => {
    const doc = document({ resources: { Order: {} } });
    expect(doc.components.schemas.Order.properties?.user).toEqual({
      type: ['object', 'null'],
      properties: { id: { type: 'integer' } },
    });
    expect(doc.components.schemas.User).toBe(undefined);
  });

  test('relations appear only when they are includable', () => {
    const bare = document({ resources: { Order: {}, OrderItem: {} } });
    expect(bare.components.schemas.Order.properties?.orderItems).toBe(undefined);

    const doc = document({
      resources: {
        Order: { include: { relations: ['orderItems', 'orderShipping'] } },
        OrderItem: {},
        OrderShipping: {},
      },
    });
    expect(doc.components.schemas.Order.properties?.orderItems).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/OrderItem' },
      description: "Present only when requested with 'include'.",
    });
    expect(doc.components.schemas.Order.properties?.orderShipping).toEqual({
      anyOf: [{ $ref: '#/components/schemas/OrderShipping' }, { type: 'null' }],
      description: "Present only when requested with 'include'.",
    });
  });

  test('a hidden column appears nowhere in the document', () => {
    const doc = document({
      resources: {
        User: { read: { exclude: ['password'] }, filter: { fields: ['email'] } },
      },
    });
    expect(JSON.stringify(doc)).not.toContain('password');
  });

  test('an unexposed model appears nowhere in the document', () => {
    const doc = document({ resources: { Product: {} } });
    const serialised = JSON.stringify(doc);
    expect(serialised).not.toContain('DeliveryAddress');
    expect(serialised).not.toContain('delivery-addresses');
  });

  test('json and vector columns get honest schemas', () => {
    const doc = document({ resources: { Product: {} } });
    expect(doc.components.schemas.Product.properties?.config).toEqual({
      description: 'Arbitrary JSON.',
    });

    const vector = generateOpenApi(
      compilePlan(new Schema(vectorSchema()), { resources: { Passage: {} } })
    );
    expect(vector.components.schemas.Passage.properties?.embedding).toEqual({
      type: ['array', 'null'],
      items: { type: 'number' },
      minItems: 3,
      maxItems: 3,
    });
  });

  test('PageMeta and Problem are always defined', () => {
    const doc = document({ resources: { Product: {} } });
    expect(doc.components.schemas.PageMeta.required).toEqual(['limit']);
    expect(doc.components.schemas.Problem.required).toEqual(['title', 'status']);
  });
});

describe('security', () => {
  test('declared schemes reach the document, with a 401 on every operation', () => {
    const doc = document(
      {
        resources: {
          Product: { operations: ['list', 'get', 'create', 'aggregate'], write: { exclude: ['config'] } },
        },
      },
      {
        securitySchemes: {
          apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
        },
      }
    );
    expect(doc.components.securitySchemes).toEqual({
      apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
    });
    expect(doc.security).toEqual([{ apiKey: [] }]);
    for (const item of Object.values(doc.paths)) {
      for (const operation of Object.values(item)) {
        expect(operation.responses['401']).toEqual({
          $ref: '#/components/responses/Unauthorized',
        });
      }
    }
  });

  test('an explicit requirement overrides the default', () => {
    const doc = document(
      { resources: { Product: {} } },
      {
        securitySchemes: {
          apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
          bearer: { type: 'http', scheme: 'bearer' },
        },
        security: [{ bearer: [] }],
      }
    );
    expect(doc.security).toEqual([{ bearer: [] }]);
  });

  test('without schemes, nothing security-related appears', () => {
    const doc = document({ resources: { Product: {} } });
    expect(doc.components.securitySchemes).toBe(undefined);
    expect(doc.security).toBe(undefined);
    expect(doc.paths['/products'].get?.responses['401']).toBe(undefined);
    expect(doc.components.responses.Unauthorized).toBe(undefined);
  });
});

describe('authorize', () => {
  test('a gated resource documents the 403 on every operation', () => {
    const doc = document({
      resources: {
        Product: {
          operations: ['list', 'get', 'create', 'update', 'delete', 'aggregate'],
          write: { exclude: ['config'] },
          authorize: () => true,
        },
      },
    });
    for (const item of Object.values(doc.paths)) {
      for (const operation of Object.values(item)) {
        expect(operation.responses['403']).toEqual({
          $ref: '#/components/responses/Forbidden',
        });
      }
    }
    // An ungated resource documents none.
    const open = document({ resources: { Product: {} } });
    expect(open.paths['/products'].get?.responses['403']).toBe(undefined);
  });
});

describe('comments as docs', () => {
  function commented(): OpenApiDocument {
    return generateOpenApi(
      compilePlan(new Schema(commentedSchema()), {
        resources: {
          Part: { operations: ['list', 'get', 'create', 'update'] },
          Supplier: {},
        },
      })
    );
  }

  test('a column comment documents the property', () => {
    const doc = commented();
    expect(doc.components.schemas.Part.properties?.code).toEqual({
      type: ['string', 'null'],
      maxLength: 20,
      description: 'Manufacturer code.',
    });
  });

  test('a technical note keeps its place after the comment', () => {
    const doc = commented();
    expect(doc.components.schemas.Part.properties?.price).toEqual({
      type: ['string', 'null'],
      format: 'decimal',
      description:
        'Unit price in AUD. Exact decimal with precision 8 and scale 2, serialised as a ' +
        'string to preserve precision.',
    });
  });

  test('a foreign key keeps its comment beside the reference', () => {
    const doc = commented();
    // supplier_id is nullable, so the comment sits on the composed schema.
    expect(doc.components.schemas.Part.properties?.supplier).toEqual({
      anyOf: [{ $ref: '#/components/schemas/Supplier' }, { type: 'null' }],
      description: 'Who we buy it from.',
    });
  });

  test('a table comment describes the schema and the tag', () => {
    const doc = commented();
    expect(doc.components.schemas.Part.description).toBe('A part in the catalogue.');
    expect(doc.tags).toEqual([
      { name: 'Part', description: 'A part in the catalogue.' },
      { name: 'Supplier' },
    ]);
  });

  test('write bodies carry the comments, not the technical notes', () => {
    const doc = commented();
    expect(doc.components.schemas.PartCreate.properties?.code?.description).toBe(
      'Manufacturer code.'
    );
    expect(doc.components.schemas.PartUpdate.properties?.price?.description).toBe(
      'Unit price in AUD.'
    );
    expect(doc.components.schemas.PartCreate.properties?.supplier?.description).toBe(
      'Who we buy it from.'
    );
  });

  test('a configured description wins over the table comment', () => {
    const doc = generateOpenApi(
      compilePlan(new Schema(commentedSchema()), {
        resources: { Part: { description: 'The catalogue.' }, Supplier: {} },
      })
    );
    expect(doc.components.schemas.Part.description).toBe('The catalogue.');
    expect(doc.tags?.[0]).toEqual({ name: 'Part', description: 'The catalogue.' });
  });

  test('an uncommented schema stays undescribed', () => {
    const doc = document({ resources: { Product: {} } });
    expect(doc.components.schemas.Product.description).toBe(undefined);
    expect(doc.tags).toEqual([{ name: 'Product' }]);
  });
});

function commentedSchema(): SchemaInfo {
  return {
    name: 'test',
    tables: [
      {
        name: 'supplier',
        columns: [
          { name: 'id', type: 'integer', nullable: false },
          { name: 'name', type: 'varchar', size: 60 },
        ],
        constraints: [{ primaryKey: true, columns: ['id'] }],
      },
      {
        name: 'part',
        comment: 'A part in the catalogue.',
        columns: [
          { name: 'id', type: 'integer', nullable: false },
          { name: 'supplier_id', type: 'integer', comment: 'Who we buy it from.' },
          { name: 'code', type: 'varchar', size: 20, comment: 'Manufacturer code.' },
          {
            name: 'price',
            type: 'decimal',
            precision: 8,
            scale: 2,
            comment: 'Unit price in AUD.',
          },
        ],
        constraints: [
          { primaryKey: true, columns: ['id'] },
          { columns: ['supplier_id'], references: { table: 'supplier', columns: ['id'] } },
        ],
      },
    ],
  };
}

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
