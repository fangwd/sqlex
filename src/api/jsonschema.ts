import { ForeignKeyField, SimpleField } from '../schema';
import { classifyColumn, isNullableField, isRequiredOnCreate } from './column';
import { ApiPlan, ResourcePlan } from './plan';

export interface JsonSchema {
  $ref?: string;
  type?: string | string[];
  format?: string;
  description?: string;
  items?: JsonSchema;
  properties?: { [name: string]: JsonSchema };
  required?: string[];
  enum?: (string | number | boolean | null)[];
  anyOf?: JsonSchema[];
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  default?: string | number | boolean;
  additionalProperties?: boolean;
}

/**
 * The schema of a column as it appears on the wire, ignoring nullability.
 *
 * The mappings below follow what the drivers actually return, verified per
 * engine in tests/api-types.test.ts:
 *  - decimal/numeric arrive as strings from mysql and postgres, so the contract
 *    is a string and sqlite's number has to be converted when rows are
 *    serialised;
 *  - bigint arrives as a JS number from every driver, so values beyond 2^53 are
 *    already inexact by the time they reach here;
 *  - date columns arrive as Date objects that JSON would render in UTC, shifting
 *    the calendar day, so they have to be formatted as plain dates;
 *  - time columns come back in a different shape from each engine, so no format
 *    is claimed.
 */
export function columnSchema(field: SimpleField): JsonSchema {
  const kind = classifyColumn(field);
  const column = field.column;

  switch (kind) {
    case 'string':
    case 'enum': {
      const schema: JsonSchema = { type: 'string' };
      if (column.size && column.size > 0) schema.maxLength = column.size;
      const values = column.userDefinedType?.values;
      if (values?.length) schema.enum = [...values];
      return schema;
    }
    case 'integer': {
      const schema: JsonSchema = { type: 'integer' };
      if (/^bigint|^long/i.test(column.type)) {
        schema.format = 'int64';
        schema.description =
          'Values beyond 2^53 are not exact: the driver returns this column as a JavaScript number.';
      }
      return schema;
    }
    case 'number':
      return /^(decimal|numeric)/i.test(column.type)
        ? {
            type: 'string',
            format: 'decimal',
            description: decimalDescription(field),
          }
        : { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'datetime':
      return { type: 'string', format: 'date-time' };
    case 'date':
      return { type: 'string', format: 'date' };
    case 'time':
      return {
        type: 'string',
        description: 'Clock time; the exact rendering depends on the database engine.',
      };
    case 'json':
      return { description: 'Arbitrary JSON.' };
    case 'vector': {
      const schema: JsonSchema = { type: 'array', items: { type: 'number' } };
      if (column.dimensions) {
        schema.minItems = column.dimensions;
        schema.maxItems = column.dimensions;
      }
      return schema;
    }
    case 'unknown':
      return { description: `Unmapped SQL type '${column.type}'.` };
  }
}

/** The column schema with null admitted when the column is nullable. */
export function fieldSchema(field: SimpleField): JsonSchema {
  const schema = describe(field, columnSchema(field));
  return isNullableField(field) ? nullable(schema) : schema;
}

/**
 * Attaches the column's comment as its documentation. A schema that already
 * carries a technical note (an inexact bigint, a decimal's serialisation)
 * keeps it after the comment, so the human text never displaces the warning.
 */
function describe(field: SimpleField, schema: JsonSchema): JsonSchema {
  const comment = field.column.comment;
  if (!comment) return schema;
  schema.description = schema.description ? `${comment} ${schema.description}` : comment;
  return schema;
}

export function nullable(schema: JsonSchema): JsonSchema {
  if (schema.$ref) return { anyOf: [schema, { type: 'null' }] };
  if (typeof schema.type === 'string') return { ...schema, type: [schema.type, 'null'] };
  return schema;
}

/**
 * The row schema for a resource. Every property is optional: a request can ask
 * for a subset with `fields`, and relations only appear when included.
 */
export function rowSchema<TContext>(
  plan: ApiPlan<TContext>,
  resource: ResourcePlan<TContext>
): JsonSchema {
  const properties: { [name: string]: JsonSchema } = {};

  for (const field of resource.readFields) {
    properties[field.name] =
      field instanceof ForeignKeyField ? referenceSchema(plan, field) : fieldSchema(field);
  }

  for (const include of resource.includes) {
    const target = plan.resource(include.target);
    if (!target) continue;
    const ref: JsonSchema = { $ref: `#/components/schemas/${schemaName(target)}` };
    properties[include.name] =
      include.kind === 'many'
        ? {
            type: 'array',
            items: ref,
            description: `Present only when requested with 'include'.`,
          }
        : { anyOf: [ref, { type: 'null' }], description: `Present only when requested with 'include'.` };
  }

  const schema: JsonSchema = { type: 'object', properties, additionalProperties: false };
  if (resource.description) schema.description = resource.description;
  return schema;
}

/**
 * A foreign key comes back as a reference object carrying just the key, or as
 * the full row when included, so it points at the target schema whose
 * properties are all optional. A target that isn't exposed contributes only its
 * key. OpenAPI 3.1 allows a description beside a $ref, so the column's own
 * comment stays visible.
 */
function referenceSchema<TContext>(
  plan: ApiPlan<TContext>,
  field: ForeignKeyField
): JsonSchema {
  const target = plan.resource(field.referencedField.model);
  let schema: JsonSchema = target
    ? { $ref: `#/components/schemas/${schemaName(target)}` }
    : {
        type: 'object',
        properties: { [field.referencedField.name]: columnSchema(field.referencedField) },
      };
  if (isNullableField(field)) schema = nullable(schema);
  // On the composed schema, not inside a nullability branch.
  if (field.column.comment) schema.description = field.column.comment;
  return schema;
}

export function schemaName<TContext>(resource: ResourcePlan<TContext>): string {
  return resource.name;
}

/**
 * The schema of a value a client supplies for a column, in a filter or a path
 * parameter: never null, and never a reference object.
 */
export function filterValueSchema(field: SimpleField): JsonSchema {
  // A foreign key is addressed by its key value, not by a nested object.
  const target = field instanceof ForeignKeyField ? field.referencedField : field;
  const kind = classifyColumn(target);
  if (kind === 'json' || kind === 'unknown') return { type: 'string' };
  const schema = columnSchema(target);
  delete schema.description;
  return schema;
}

function decimalDescription(field: SimpleField): string {
  const { precision, scale } = field.column;
  const digits =
    precision !== undefined
      ? ` with precision ${precision}${scale !== undefined ? ` and scale ${scale}` : ''}`
      : '';
  return `Exact decimal${digits}, serialised as a string to preserve precision.`;
}


/**
 * The body a client may send. A foreign key is the value of the column it
 * points at, never a nested object: nothing about a related row can be written
 * through here.
 */
export function writeSchema<TContext>(
  resource: ResourcePlan<TContext>,
  mode: 'create' | 'update'
): JsonSchema {
  const properties: { [name: string]: JsonSchema } = {};
  const required: string[] = [];

  for (const field of resource.writeFields) {
    const base =
      field instanceof ForeignKeyField ? columnSchema(field.referencedField) : columnSchema(field);
    // The technical note belongs to reads; the column's comment is the doc here.
    delete base.description;
    if (field.column.comment) base.description = field.column.comment;
    properties[field.name] = isNullableField(field) ? nullable(base) : base;
    if (mode === 'create' && isRequiredOnCreate(field)) required.push(field.name);
  }

  const schema: JsonSchema = { type: 'object', properties, additionalProperties: false };
  if (required.length) schema.required = required;
  return schema;
}

export function writeSchemaName<TContext>(
  resource: ResourcePlan<TContext>,
  mode: 'create' | 'update'
): string {
  return `${resource.name}${mode === 'create' ? 'Create' : 'Update'}`;
}
