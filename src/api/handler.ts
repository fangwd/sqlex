import { Database } from '../database';
import { Document } from '../types';
import { ApiConfig, Operation } from './config';
import { ApiError, errorResponse } from './errors';
import { OpenApiDocument, OpenApiOptions, generateOpenApi } from './openapi';
import { IncludeNode, parseAggregateRequest, parseIdentity, parseReadRequest, parseWriteBody } from './params';
import { ApiPlan, ResourcePlan, compilePlan } from './plan';
import { createRow, deleteRow, readAggregate, readItem, readList, updateRow } from './runner';

export interface ApiOptions {
  /** Called with anything thrown that is not an ApiError, before a bare 500. */
  onError?: (error: unknown) => void;
}

export interface Api<TContext> {
  plan: ApiPlan<TContext>;
  handle(request: Request, context: TContext): Promise<Response>;
  openapi(options?: OpenApiOptions): OpenApiDocument;
}

/**
 * Compiles the configuration and returns the pair that share it: a request
 * handler and the document describing exactly what that handler serves.
 */
export function createApi<TContext = unknown>(
  db: Database,
  config: ApiConfig<TContext>,
  options: ApiOptions = {}
): Api<TContext> {
  if (!db.schema) {
    throw Error('createApi needs a schema: call buildSchema() or pass one to the Database');
  }
  const plan = compilePlan(db.schema, config);

  return {
    plan,
    openapi: (openApiOptions?: OpenApiOptions) => generateOpenApi(plan, openApiOptions),
    handle: async (request, context) => {
      try {
        return await route(db, plan, request, context);
      } catch (error) {
        return errorResponse(error, options.onError);
      }
    },
  };
}

async function route<TContext>(
  db: Database,
  plan: ApiPlan<TContext>,
  request: Request,
  context: TContext
): Promise<Response> {
  const url = new URL(request.url);
  const segments = pathSegments(url.pathname, plan.basePath);

  if (!segments || segments.length === 0 || segments.length > 2) {
    throw ApiError.notFound(`No resource at ${url.pathname}`);
  }

  const resource = plan.resourceAt(decodeSegment(segments[0]));
  if (!resource) throw ApiError.notFound(`No resource at ${url.pathname}`);

  const collection = segments.length === 1;

  // The aggregate route sits where an item URL would, so it is recognised
  // first; a resource that does not expose it treats the segment as a key.
  if (!collection && tryDecodeSegment(segments[1]) === 'aggregate' && resource.operations.has('aggregate')) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      throw ApiError.methodNotAllowed(request.method, 'GET, HEAD');
    }
    await authorize(resource, 'aggregate', context);
    return json(
      await readAggregate(db, resource, parseAggregateRequest(resource, url.searchParams), context),
      request
    );
  }

  const operation = operationFor(request.method, collection);
  if (!operation) {
    throw ApiError.methodNotAllowed(request.method, allowed(resource, collection));
  }
  if (!resource.operations.has(operation)) {
    // A route the policy withholds is absent rather than disabled, except where
    // a sibling method on the same route exists to advertise.
    const others = allowed(resource, collection);
    if (others) throw ApiError.methodNotAllowed(request.method, others);
    throw ApiError.notFound(`No resource at ${url.pathname}`);
  }

  // Before anything is parsed or read: an actor the gate refuses learns only
  // that it is refused.
  await authorize(resource, operation, context);

  switch (operation) {
    case 'list': {
      const readRequest = parseReadRequest(plan, resource, url.searchParams);
      await authorizeIncludes(plan, readRequest.includes, context);
      return json(await readList(db, plan, resource, readRequest, context), request);
    }

    case 'get': {
      const identity = parseIdentity(resource, segments[1]);
      const readRequest = parseReadRequest(plan, resource, url.searchParams);
      await authorizeIncludes(plan, readRequest.includes, context);
      const row = await readItem(db, plan, resource, identity, readRequest, context);
      if (!row) throw ApiError.notFound(itemNotFound(resource, segments[1]));
      return json({ data: row }, request);
    }

    case 'create': {
      const body = parseWriteBody(resource, await readBody(request), 'create');
      const { row, identity } = await createRow(db, plan, resource, body, context);
      return json({ data: row }, request, {
        status: 201,
        headers: { location: itemLocation(plan, resource, identity) },
      });
    }

    case 'update': {
      const identity = parseIdentity(resource, segments[1]);
      const body = parseWriteBody(resource, await readBody(request), 'update');
      return json({ data: await updateRow(db, plan, resource, identity, body, context) }, request);
    }

    case 'delete': {
      const identity = parseIdentity(resource, segments[1]);
      await deleteRow(db, plan, resource, identity, context);
      return new Response(null, { status: 204 });
    }

    // Recognised above, before the method is mapped to an operation.
    case 'aggregate':
      throw ApiError.notFound(`No resource at ${url.pathname}`);
  }
}

async function authorize<TContext>(
  resource: ResourcePlan<TContext>,
  operation: Operation,
  context: TContext
): Promise<void> {
  if (resource.authorize && !(await resource.authorize(context, operation))) {
    throw ApiError.forbidden(operation);
  }
}

/**
 * Embedding a resource is reading it, so the target's read gate must pass too:
 * otherwise `?include=` would reach around an authorize that refuses the
 * resource directly. Checked before the query runs, at every depth. Row-level
 * access is still the target's scope, applied during the read.
 */
async function authorizeIncludes<TContext>(
  plan: ApiPlan<TContext>,
  includes: IncludeNode[],
  context: TContext
): Promise<void> {
  for (const node of includes) {
    const target = plan.resource(node.include.target);
    if (target) {
      await authorize(target, 'get', context);
      await authorizeIncludes(plan, node.children, context);
    }
  }
}

function operationFor(method: string, collection: boolean): Operation | undefined {
  if (method === 'GET' || method === 'HEAD') return collection ? 'list' : 'get';
  if (method === 'POST' && collection) return 'create';
  if (method === 'PATCH' && !collection) return 'update';
  if (method === 'DELETE' && !collection) return 'delete';
  return undefined;
}

/** The methods this route actually serves, for the Allow header. */
function allowed<TContext>(resource: ResourcePlan<TContext>, collection: boolean): string {
  const methods: string[] = [];
  if (resource.operations.has(collection ? 'list' : 'get')) methods.push('GET', 'HEAD');
  if (collection) {
    if (resource.operations.has('create')) methods.push('POST');
  } else {
    if (resource.operations.has('update')) methods.push('PATCH');
    if (resource.operations.has('delete')) methods.push('DELETE');
  }
  return methods.join(', ');
}

async function readBody(request: Request): Promise<unknown> {
  const type = request.headers.get('content-type') ?? '';
  if (!/^application\/(\w+\+)?json\b/i.test(type)) {
    throw ApiError.unsupportedMediaType(`expected application/json, got '${type || 'nothing'}'`);
  }
  const text = await request.text();
  try {
    return JSON.parse(text);
  } catch {
    throw ApiError.badRequest([{ parameter: 'body', detail: 'expected valid JSON' }]);
  }
}

/** Decodes a path segment, treating malformed percent-encoding as no such path. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw ApiError.notFound('No such resource');
  }
}

/** Decodes a segment for comparison, without deciding what malformed means. */
function tryDecodeSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/**
 * Path segments below basePath, still percent-encoded, or undefined when the
 * path is outside it. Decoding is left to the caller: an identity segment has
 * to be split on its commas before they are decoded, so that a key value
 * containing an encoded comma survives.
 */
function pathSegments(pathname: string, basePath: string): string[] | undefined {
  let rest = pathname;
  if (basePath !== '/') {
    if (rest !== basePath && !rest.startsWith(`${basePath}/`)) return undefined;
    rest = rest.slice(basePath.length);
  }
  return rest.split('/').filter(segment => segment !== '');
}

function itemLocation<TContext>(
  plan: ApiPlan<TContext>,
  resource: ResourcePlan<TContext>,
  identity: Document
): string {
  const values = (resource.identity?.fields ?? [])
    .map(field => encodeURIComponent(String(identity[field.name])))
    .join(',');
  const base = plan.basePath === '/' ? '' : plan.basePath;
  return `${base}/${resource.path}/${values}`;
}

function itemNotFound<TContext>(resource: ResourcePlan<TContext>, segment: string): string {
  return `No ${resource.name} with ${(resource.identity?.fields ?? [])
    .map(field => field.name)
    .join(', ')} ${segment}`;
}

function json(
  body: unknown,
  request: Request,
  options: { status?: number; headers?: Record<string, string> } = {}
): Response {
  const payload = JSON.stringify(body);
  return new Response(request.method === 'HEAD' ? null : payload, {
    status: options.status ?? 200,
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(payload)),
      ...options.headers,
    },
  });
}
