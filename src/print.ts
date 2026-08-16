import {
  Schema,
  Model,
  SimpleField,
  ForeignKeyField,
  RelatedField,
  hasColumnDefault
} from './schema';
import { Database as SchemaInfo } from './types';

export function printSchema(
  schema: Schema | SchemaInfo,
  keyword: string = 'interface'
): string {
  if (!(schema instanceof Schema)) {
    schema = new Schema(schema);
  }

  const lines = [];
  for (const model of schema.models) {
    lines.push(`export ${keyword} ${model.name}`);
    lines.push(`{`);
    for (const field of model.fields) {
      let typeName;
      if (field instanceof ForeignKeyField) {
        typeName = field.referencedField.model.name;
      } else if (field instanceof SimpleField) {
        typeName = getTypeName(field.column.type);
      } else {
        const relatedField = field as RelatedField;
        if (relatedField.referencingField.isUnique()) {
          typeName = relatedField.referencingField.model.name;
        } else {
          typeName = relatedField.referencingField.model.name + '[]';
        }
      }
      let flag = '';
      if (field instanceof SimpleField && isNullable(field)) {
        flag = '?';
      }
      lines.push(`${field.name}${flag}: ${typeName};`);
    }
    lines.push(`}`);
    lines.push('');
  }

  return lines.join('\n');
}

export interface PrintSchemaTypeMapOptions {
  importPath?: string;
  tableMapName?: string;
  databaseName?: string;
}

export function printSchemaTypeMap(
  schema: Schema | SchemaInfo,
  options: PrintSchemaTypeMapOptions = {}
): string {
  if (!(schema instanceof Schema)) {
    schema = new Schema(schema);
  }

  const importPath = options.importPath || 'sqlex';
  const tableMapName = options.tableMapName || 'SqlexTables';
  const databaseName = options.databaseName || 'SqlexDatabase';
  const lines = [
    `import type { Database, FilterShape, Identifiable, JsonValue, ParentMutation, RelatedMutation, ScalarValue, TableSpec } from '${importPath}';`,
    '',
  ];

  // Models whose primary key isn't a single `id` column still need a bespoke
  // reference interface; the common case reuses the shared `Identifiable` type.
  for (const model of schema.models) {
    if (refType(model) !== `${model.name}Ref`) continue;
    lines.push(`export interface ${model.name}Ref {`);
    const key = model.keyField();
    if (key) {
      lines.push(`  ${member(key.name, false, rowFieldType(key, true))}`);
    }
    lines.push('}');
    lines.push('');
  }

  for (const model of schema.models) {
    lines.push(`export interface ${model.name}Row extends ${refType(model)} {`);
    for (const field of model.fields) {
      if (field instanceof SimpleField) {
        lines.push(`  ${member(field.name, false, rowFieldType(field))}`);
      }
    }
    lines.push('}');
    lines.push('');

    lines.push(`export interface ${model.name}Relations {`);
    for (const field of model.fields) {
      if (field instanceof RelatedField) {
        lines.push(`  ${member(field.name, true, relationRowType(field))}`);
      }
    }
    lines.push('}');
    lines.push('');

    lines.push(`export type ${model.name}Selected = ${model.name}Row & ${model.name}Relations;`);
    lines.push(`export type ${model.name}Filter = FilterShape<${model.name}Row>;`);
    lines.push('');

    lines.push(`export interface ${model.name}Create {`);
    for (const field of model.fields) {
      if (field instanceof SimpleField) {
        lines.push(`  ${member(field.name, createOptional(field), createFieldType(field))}`);
      } else if (field instanceof RelatedField) {
        lines.push(`  ${member(field.name, true, relatedMutationType(field))}`);
      }
    }
    lines.push('}');
    lines.push('');

    lines.push(`export type ${model.name}Update = Partial<${model.name}Create>;`);
    lines.push('');
  }

  lines.push(`export interface ${tableMapName} {`);
  const aliases = new Set<string>();
  for (const model of schema.models) {
    for (const alias of [model.table.name, model.table.shortName, model.name]) {
      if (aliases.has(alias)) continue;
      aliases.add(alias);
      lines.push(
        `  ${member(alias, false, `TableSpec<${model.name}Row, ${model.name}Create, ${model.name}Update, ${model.name}Filter>`)}`
      );
    }
  }
  lines.push('}');
  lines.push('');
  lines.push(`export type ${databaseName} = Database<${tableMapName}>;`);

  return lines.join('\n');
}

function member(name: string, optional: boolean, type: string): string {
  const escaped = /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(name) ? name : JSON.stringify(name);
  return `${escaped}${optional ? '?' : ''}: ${type};`;
}

// The reference type for a model: the shared `Identifiable` for a single `id`-column
// primary key, otherwise a model-specific `*Ref` interface.
function refType(model: Model): string {
  const key = model.keyField();
  if (key && key.name === 'id' && !(key instanceof ForeignKeyField)) {
    const type = columnType(key);
    return type === 'number' ? 'Identifiable' : `Identifiable<${type}>`;
  }
  return `${model.name}Ref`;
}

function rowFieldType(field: SimpleField, refKey: boolean = false): string {
  const typeName = field instanceof ForeignKeyField
    ? refType(field.referencedField.model)
    : columnType(field);
  return !refKey && isNullable(field) ? `${typeName} | null` : typeName;
}

function createFieldType(field: SimpleField): string {
  let typeName: string;
  if (field instanceof ForeignKeyField) {
    const model = field.referencedField.model;
    typeName = [
      refType(model),
      'ScalarValue',
      `ParentMutation<${model.name}Filter, ${model.name}Create, ${model.name}Update>`,
    ].join(' | ');
  } else {
    typeName = columnType(field);
  }
  return isNullable(field) ? `${typeName} | null` : typeName;
}

function columnType(field: SimpleField): string {
  if (field.config.userType) {
    return field.config.userType;
  }
  if (/^json/i.test(field.column.type)) {
    return 'JsonValue';
  }
  return getTypeName(field.column.type);
}

function isNullable(field: SimpleField): boolean {
  return field.column.nullable !== false && !(field.uniqueKey && field.uniqueKey.primary);
}

function createOptional(field: SimpleField): boolean {
  return !!field.column.autoIncrement || hasColumnDefault(field.column) || isNullable(field);
}

function relatedModel(field: RelatedField): Model {
  return field.throughField
    ? field.throughField.referencedField.model
    : field.referencingField.model;
}

function relationRowType(field: RelatedField): string {
  const typeName = `${relatedModel(field).name}Row`;
  return field.referencingField.isUnique() ? `${typeName} | null` : `${typeName}[]`;
}

function relatedMutationType(field: RelatedField): string {
  const model = relatedModel(field);
  return `RelatedMutation<${model.name}Filter, ${model.name}Create, ${model.name}Update>`;
}

export type DataType = 'Date' | 'number' | 'number[]' | 'string' | 'boolean' | 'object';

export function getTypeName(name: string): DataType {
  if (/date|time/i.test(name)) {
    return 'Date';
  }

  if (/char|text|string/i.test(name)) {
    return 'string';
  }

  if (/int|long/i.test(name)) {
    return 'number';
  }

  if (/float|double|decimal/i.test(name)) {
    return 'number';
  }

  if (/^bool/i.test(name)) {
    return 'boolean';
  }

  if (/^json/i.test(name)) {
    return 'object';
  }

  if (/^vector/i.test(name)) {
    return 'number[]';
  }

  if (/enum/i.test(name)) {
    // todo: export enums separately
    return 'string';
  }

  throw Error(`Unknown type '${name}'`);
}
