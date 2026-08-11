import { toPascalCase } from '../utils';
import { ApiFilterOperator } from './config';
import {
  JsonSchema,
  filterValueSchema,
  rowSchema,
  schemaName,
  writeSchema,
  writeSchemaName,
} from './jsonschema';
import { AggregatePlan, ApiPlan, FilterPlan, ResourcePlan } from './plan';

export interface SecuritySchemeObject {
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect' | 'mutualTLS';
  description?: string;
  name?: string;
  in?: 'query' | 'header' | 'cookie';
  scheme?: string;
  bearerFormat?: string;
  openIdConnectUrl?: string;
  flows?: unknown;
}

export type SecurityRequirement = { [scheme: string]: string[] };

export interface OpenApiOptions {
  title?: string;
  version?: string;
  description?: string;
  servers?: ServerObject[];
  /** How callers authenticate; declaring any adds a 401 to every operation. */
  securitySchemes?: { [name: string]: SecuritySchemeObject };
  /** The document-wide requirement, defaulting to any one declared scheme. */
  security?: SecurityRequirement[];
}

export interface ServerObject {
  url: string;
  description?: string;
}

export interface ParameterObject {
  name: string;
  in: 'query' | 'path';
  required?: boolean;
  description?: string;
  style?: 'form';
  explode?: boolean;
  schema: JsonSchema;
}

export interface ResponseObject {
  description: string;
  content?: { [mediaType: string]: { schema: JsonSchema } };
}

export interface ReferenceObject {
  $ref: string;
}

export interface RequestBodyObject {
  required: true;
  content: { [mediaType: string]: { schema: JsonSchema } };
}

export interface OperationObject {
  operationId: string;
  summary: string;
  tags: string[];
  parameters: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses: { [status: string]: ResponseObject | ReferenceObject };
}

export interface PathItemObject {
  get?: OperationObject;
  post?: OperationObject;
  patch?: OperationObject;
  delete?: OperationObject;
}

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: ServerObject[];
  tags?: { name: string; description?: string }[];
  paths: { [path: string]: PathItemObject };
  security?: SecurityRequirement[];
  components: {
    schemas: { [name: string]: JsonSchema };
    responses: { [name: string]: ResponseObject };
    securitySchemes?: { [name: string]: SecuritySchemeObject };
  };
}

const JSON_MEDIA_TYPE = 'application/json';
const PROBLEM_MEDIA_TYPE = 'application/problem+json';

const OPERATOR_DESCRIPTIONS: { [key in ApiFilterOperator]: string } = {
  eq: 'equals',
  ne: 'is not',
  lt: 'is less than',
  le: 'is at most',
  ge: 'is at least',
  gt: 'is greater than',
  in: 'is any of',
  notIn: 'is none of',
  like: 'matches the pattern (% and _ are wildcards)',
  ilike: 'matches the pattern, ignoring case',
  null: 'is null when true, is not null when false',
};

export function generateOpenApi<TContext>(
  plan: ApiPlan<TContext>,
  options: OpenApiOptions = {}
): OpenApiDocument {
  const paths: { [path: string]: PathItemObject } = {};
  const schemas: { [name: string]: JsonSchema } = {};

  for (const resource of plan.resources) {
    schemas[schemaName(resource)] = rowSchema(plan, resource);

    const collection: PathItemObject = {};
    if (resource.operations.has('list')) collection.get = listOperation(resource);
    if (resource.operations.has('create')) collection.post = createOperation(resource);
    if (Object.keys(collection).length) paths[`/${resource.path}`] = collection;

    if (resource.operations.has('aggregate')) {
      paths[`/${resource.path}/aggregate`] = { get: aggregateOperation(resource) };
    }

    if (resource.identity) {
      const item: PathItemObject = {};
      if (resource.operations.has('get')) item.get = itemOperation(resource);
      if (resource.operations.has('update')) item.patch = updateOperation(resource);
      if (resource.operations.has('delete')) item.delete = deleteOperation(resource);
      if (Object.keys(item).length) {
        paths[`/${resource.path}/${identityTemplate(resource)}`] = item;
      }
    }

    // Where an authorize gate exists, any of these operations can be refused.
    if (resource.authorize) {
      for (const path of [
        `/${resource.path}`,
        `/${resource.path}/aggregate`,
        `/${resource.path}/${identityTemplate(resource)}`,
      ]) {
        const item = paths[path];
        if (!item) continue;
        for (const operation of Object.values(item)) {
          operation.responses['403'] = { $ref: '#/components/responses/Forbidden' };
        }
      }
    }

    if (resource.operations.has('create')) {
      schemas[writeSchemaName(resource, 'create')] = writeSchema(resource, 'create');
    }
    if (resource.operations.has('update')) {
      schemas[writeSchemaName(resource, 'update')] = writeSchema(resource, 'update');
    }
  }

  schemas.PageMeta = pageMetaSchema();
  schemas.Problem = problemSchema();

  const document: OpenApiDocument = {
    openapi: '3.1.1',
    info: {
      title: options.title ?? 'sqlex API',
      version: options.version ?? '1.0.0',
      ...(options.description ? { description: options.description } : {}),
    },
    paths,
    components: {
      schemas,
      responses: {
        BadRequest: problemResponse('The request parameters are not valid.'),
        Forbidden: problemResponse('This request may not perform the operation.'),
        NotFound: problemResponse('No such row.'),
        Conflict: problemResponse('The write would break a uniqueness constraint.'),
        Unprocessable: problemResponse('The write was refused: see the detail.'),
        UnsupportedMediaType: problemResponse('The body must be application/json.'),
      },
    },
  };

  if (options.securitySchemes && Object.keys(options.securitySchemes).length) {
    document.components.securitySchemes = options.securitySchemes;
    document.security =
      options.security ??
      Object.keys(options.securitySchemes).map(name => ({ [name]: [] }));
    document.components.responses.Unauthorized = problemResponse(
      'The request did not authenticate.'
    );
    for (const item of Object.values(paths)) {
      for (const operation of Object.values(item)) {
        operation.responses['401'] = { $ref: '#/components/responses/Unauthorized' };
      }
    }
  }

  const servers = options.servers ?? (plan.basePath === '/' ? undefined : [{ url: plan.basePath }]);
  if (servers) document.servers = servers;

  const tags = plan.resources.map(resource => ({
    name: resource.name,
    ...(resource.description ? { description: resource.description } : {}),
  }));
  if (tags.length) document.tags = tags;

  return document;
}

function listOperation<TContext>(resource: ResourcePlan<TContext>): OperationObject {
  const parameters: ParameterObject[] = [
    ...filterParameters(resource),
    ...(resource.sorts.length ? [sortParameter(resource)] : []),
    ...(resource.includes.length ? [includeParameter(resource)] : []),
    fieldsParameter(resource),
    limitParameter(resource),
    offsetParameter(),
    ...(resource.identity ? [cursorParameter()] : []),
    totalParameter(),
  ];

  return {
    operationId: `list${toPascalCase(resource.model.pluralName)}`,
    summary: `List ${resource.model.pluralName}`,
    tags: [resource.name],
    parameters,
    responses: {
      '200': {
        description: `A page of ${resource.model.pluralName}.`,
        content: {
          [JSON_MEDIA_TYPE]: {
            schema: {
              type: 'object',
              properties: {
                data: {
                  type: 'array',
                  items: { $ref: `#/components/schemas/${schemaName(resource)}` },
                },
                meta: { $ref: '#/components/schemas/PageMeta' },
              },
              required: ['data', 'meta'],
            },
          },
        },
      },
      '400': { $ref: '#/components/responses/BadRequest' },
    },
  };
}

function itemOperation<TContext>(resource: ResourcePlan<TContext>): OperationObject {
  const parameters: ParameterObject[] = [
    ...identityParameters(resource),
    ...(resource.includes.length ? [includeParameter(resource)] : []),
    fieldsParameter(resource),
  ];

  return {
    operationId: `get${resource.name}`,
    summary: `Fetch one ${resource.name}`,
    tags: [resource.name],
    parameters,
    responses: {
      '200': {
        description: `The requested ${resource.name}.`,
        content: {
          [JSON_MEDIA_TYPE]: {
            schema: {
              type: 'object',
              properties: { data: { $ref: `#/components/schemas/${schemaName(resource)}` } },
              required: ['data'],
            },
          },
        },
      },
      '400': { $ref: '#/components/responses/BadRequest' },
      '404': { $ref: '#/components/responses/NotFound' },
    },
  };
}

function aggregateOperation<TContext>(resource: ResourcePlan<TContext>): OperationObject {
  const aggregate: AggregatePlan = resource.aggregate ?? {
    groupBy: [],
    summable: [],
    comparable: [],
  };
  const parameters: ParameterObject[] = [];

  if (aggregate.groupBy.length) {
    parameters.push({
      name: 'groupBy',
      in: 'query',
      description: 'Columns to group by (comma separated); one entry per group comes back.',
      style: 'form',
      explode: false,
      schema: {
        type: 'array',
        items: { type: 'string', enum: aggregate.groupBy.map(entry => entry.path) },
      },
    });
  }
  parameters.push({
    name: 'count',
    in: 'query',
    description: 'Count the rows of each group. On by default when nothing else is asked for.',
    schema: { type: 'boolean' },
  });
  for (const fn of ['sum', 'avg', 'min', 'max'] as const) {
    const fields = fn === 'sum' || fn === 'avg' ? aggregate.summable : aggregate.comparable;
    if (!fields.length) continue;
    parameters.push({
      name: fn,
      in: 'query',
      description: `Columns to apply ${fn} to (comma separated).`,
      style: 'form',
      explode: false,
      schema: { type: 'array', items: { type: 'string', enum: fields.map(field => field.name) } },
    });
  }
  parameters.push(...filterParameters(resource), limitParameter(resource), offsetParameter());

  const entry: JsonSchema = {
    type: 'object',
    properties: {
      ...(aggregate.groupBy.length
        ? {
            group: {
              type: 'object',
              description: 'The grouped column values; present when groupBy was given.',
            },
          }
        : {}),
      count: { type: 'integer' },
      ...(aggregate.summable.length
        ? {
            sum: { type: 'object', description: 'Sums of the requested columns, as numbers.' },
            avg: { type: 'object', description: 'Averages of the requested columns, as numbers.' },
          }
        : {}),
      ...(aggregate.comparable.length
        ? {
            min: { type: 'object' },
            max: { type: 'object' },
          }
        : {}),
    },
  };

  return {
    operationId: `aggregate${toPascalCase(resource.model.pluralName)}`,
    summary: `Aggregate over ${resource.model.pluralName}`,
    tags: [resource.name],
    parameters,
    responses: {
      '200': {
        description: `Aggregates over the matching ${resource.model.pluralName}.`,
        content: {
          [JSON_MEDIA_TYPE]: {
            schema: {
              type: 'object',
              properties: {
                data: { type: 'array', items: entry },
                meta: { $ref: '#/components/schemas/PageMeta' },
              },
              required: ['data', 'meta'],
            },
          },
        },
      },
      '400': { $ref: '#/components/responses/BadRequest' },
    },
  };
}

function createOperation<TContext>(resource: ResourcePlan<TContext>): OperationObject {
  return {
    operationId: `create${resource.name}`,
    summary: `Create a ${resource.name}`,
    tags: [resource.name],
    parameters: [],
    requestBody: body(writeSchemaName(resource, 'create')),
    responses: {
      '201': {
        description: `The created ${resource.name}; its URL is in the Location header.`,
        content: { [JSON_MEDIA_TYPE]: { schema: itemEnvelope(resource) } },
      },
      '400': { $ref: '#/components/responses/BadRequest' },
      '409': { $ref: '#/components/responses/Conflict' },
      '415': { $ref: '#/components/responses/UnsupportedMediaType' },
      '422': { $ref: '#/components/responses/Unprocessable' },
    },
  };
}

function updateOperation<TContext>(resource: ResourcePlan<TContext>): OperationObject {
  return {
    operationId: `update${resource.name}`,
    summary: `Change some columns of a ${resource.name}`,
    tags: [resource.name],
    parameters: identityParameters(resource),
    requestBody: body(writeSchemaName(resource, 'update')),
    responses: {
      '200': {
        description: `The updated ${resource.name}.`,
        content: { [JSON_MEDIA_TYPE]: { schema: itemEnvelope(resource) } },
      },
      '400': { $ref: '#/components/responses/BadRequest' },
      '404': { $ref: '#/components/responses/NotFound' },
      '409': { $ref: '#/components/responses/Conflict' },
      '415': { $ref: '#/components/responses/UnsupportedMediaType' },
      '422': { $ref: '#/components/responses/Unprocessable' },
    },
  };
}

function deleteOperation<TContext>(resource: ResourcePlan<TContext>): OperationObject {
  return {
    operationId: `delete${resource.name}`,
    summary: `Delete a ${resource.name}`,
    tags: [resource.name],
    parameters: identityParameters(resource),
    responses: {
      '204': { description: 'Deleted.' },
      '404': { $ref: '#/components/responses/NotFound' },
      '422': { $ref: '#/components/responses/Unprocessable' },
    },
  };
}

function body(schema: string): RequestBodyObject {
  return {
    required: true,
    content: { [JSON_MEDIA_TYPE]: { schema: { $ref: `#/components/schemas/${schema}` } } },
  };
}

function itemEnvelope<TContext>(resource: ResourcePlan<TContext>): JsonSchema {
  return {
    type: 'object',
    properties: { data: { $ref: `#/components/schemas/${schemaName(resource)}` } },
    required: ['data'],
  };
}

function identityParameters<TContext>(resource: ResourcePlan<TContext>): ParameterObject[] {
  return (resource.identity?.fields ?? []).map(field => ({
    name: field.name,
    in: 'path' as const,
    required: true,
    schema: filterValueSchema(field),
  }));
}

function filterParameters<TContext>(resource: ResourcePlan<TContext>): ParameterObject[] {
  const parameters: ParameterObject[] = [];
  for (const filter of resource.filters) {
    for (const operator of filter.operators) {
      parameters.push(filterParameter(filter, operator));
    }
  }
  return parameters;
}

function filterParameter(filter: FilterPlan, operator: ApiFilterOperator): ParameterObject {
  const value = filterValueSchema(filter.field);
  const description = `${filter.path} ${OPERATOR_DESCRIPTIONS[operator]}`;

  if (operator === 'null') {
    return {
      name: `${filter.path}_null`,
      in: 'query',
      description,
      schema: { type: 'boolean' },
    };
  }

  if (operator === 'in' || operator === 'notIn') {
    return {
      name: `${filter.path}_${operator}`,
      in: 'query',
      description: `${description} (comma separated)`,
      style: 'form',
      explode: false,
      schema: { type: 'array', items: value },
    };
  }

  if (operator === 'like' || operator === 'ilike') {
    return {
      name: `${filter.path}_${operator}`,
      in: 'query',
      description,
      schema: { type: 'string' },
    };
  }

  return {
    name: operator === 'eq' ? filter.path : `${filter.path}_${operator}`,
    in: 'query',
    description,
    schema: value,
  };
}

function sortParameter<TContext>(resource: ResourcePlan<TContext>): ParameterObject {
  const values = resource.sorts.flatMap(sort => [sort.path, `-${sort.path}`]);
  const description = resource.defaultSort.length
    ? `Sort order; defaults to ${resource.defaultSort.join(', ')}. Prefix with '-' for descending.`
    : `Sort order. Prefix with '-' for descending.`;
  return {
    name: 'sort',
    in: 'query',
    description,
    style: 'form',
    explode: false,
    schema: { type: 'array', items: { type: 'string', enum: values } },
  };
}

function includeParameter<TContext>(resource: ResourcePlan<TContext>): ParameterObject {
  const relations = resource.includes.map(include => include.name).join(', ');
  return {
    name: 'include',
    in: 'query',
    description:
      `Relations to embed (comma separated), up to ${resource.includeMaxDepth} ` +
      `${resource.includeMaxDepth === 1 ? 'level' : 'levels'} deep. ` +
      `Directly available here: ${relations}.`,
    style: 'form',
    explode: false,
    schema: { type: 'array', items: { type: 'string' } },
  };
}

function fieldsParameter<TContext>(resource: ResourcePlan<TContext>): ParameterObject {
  return {
    name: 'fields',
    in: 'query',
    description: 'Columns to return (comma separated); all of them by default.',
    style: 'form',
    explode: false,
    schema: {
      type: 'array',
      items: { type: 'string', enum: resource.readFields.map(field => field.name) },
    },
  };
}

function limitParameter<TContext>(resource: ResourcePlan<TContext>): ParameterObject {
  return {
    name: 'limit',
    in: 'query',
    description: 'Maximum rows to return.',
    schema: {
      type: 'integer',
      minimum: 1,
      maximum: resource.page.maxLimit,
      default: resource.page.defaultLimit,
    },
  };
}

function offsetParameter(): ParameterObject {
  return {
    name: 'offset',
    in: 'query',
    description: 'Rows to skip.',
    schema: { type: 'integer', minimum: 0, default: 0 },
  };
}

function cursorParameter(): ParameterObject {
  return {
    name: 'cursor',
    in: 'query',
    description:
      "The page mark from a previous response's meta.next. The sort must be the " +
      'one it was minted under, and it replaces offset.',
    schema: { type: 'string' },
  };
}

function totalParameter(): ParameterObject {
  return {
    name: 'total',
    in: 'query',
    description: 'Count the matching rows and report it as meta.total.',
    schema: { type: 'boolean', default: false },
  };
}

function identityTemplate<TContext>(resource: ResourcePlan<TContext>): string {
  return (resource.identity?.fields ?? []).map(field => `{${field.name}}`).join(',');
}

function pageMetaSchema(): JsonSchema {
  return {
    type: 'object',
    properties: {
      limit: { type: 'integer' },
      offset: { type: 'integer', description: 'Absent when the page came from a cursor.' },
      total: { type: 'integer', description: "Present when 'total=true' was requested." },
      next: {
        type: 'string',
        description: 'The cursor naming the next page; absent on the last one.',
      },
    },
    required: ['limit'],
  };
}

function problemSchema(): JsonSchema {
  return {
    type: 'object',
    description: 'An error, as described by RFC 9457.',
    properties: {
      type: { type: 'string' },
      title: { type: 'string' },
      status: { type: 'integer' },
      detail: { type: 'string' },
      errors: {
        type: 'array',
        description: 'Per-parameter details for a rejected request.',
        items: {
          type: 'object',
          properties: { parameter: { type: 'string' }, detail: { type: 'string' } },
        },
      },
    },
    required: ['title', 'status'],
  };
}

function problemResponse(description: string): ResponseObject {
  return {
    description,
    content: { [PROBLEM_MEDIA_TYPE]: { schema: { $ref: '#/components/schemas/Problem' } } },
  };
}
