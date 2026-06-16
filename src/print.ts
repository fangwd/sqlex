import {
  Schema,
  Model,
  Field,
  SimpleField,
  ForeignKeyField,
  RelatedField
} from './schema';
import { Database as SchemaInfo } from './types';
import { writeFileSync } from 'fs';
import { join } from 'path';

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
      if (field instanceof SimpleField && !field.column.nullable) {
        flag = '?';
      }
      lines.push(`${field.name}${flag}: ${typeName};`);
    }
    lines.push(`}`);
    lines.push('');
  }

  return lines.join('\n');
}

export function printSchemaTypeScript(
  schema: Schema | SchemaInfo,
  base: string = 'Model',
  column: string = 'Column'
): string {
  if (!(schema instanceof Schema)) {
    schema = new Schema(schema);
  }

  const lines = [
    `import {Filter, Value, ForeignKeyField} from 'sqlit'`,
    `import {${base}, ${column}, db} from './${base.toLowerCase()}'`,
    ''
  ];

  for (const model of schema.models) {
    lines.push(`export class ${model.name} extends ${base}`);
    lines.push(`{`);

    const table = model.table;

    for (const field of model.fields) {
      lines.push('');
      let typeName;
      if (field instanceof ForeignKeyField) {
        lines.push(`@${column}()`);
        typeName = field.referencedField.model.name;
      } else if (field instanceof SimpleField) {
        lines.push(`@${column}()`);
        typeName = getTypeName(field.config.userType || field.column.type);
      } else {
        const relatedField = field as RelatedField;
        typeName = relatedField.throughField
          ? relatedField.throughField.referencedField.model.name
          : relatedField.referencingField.model.name;
        if (!relatedField.referencingField.isUnique()) {
          typeName += '[]';
        }
      }
      lines.push(`${field.name}!: ${typeName};`);
    }

    lines.push('');
    lines.push(`constructor(data?: Partial<${model.name}>)`);
    lines.push('{');
    lines.push(`super(db.table('${table.name}'), data);`);
    lines.push('}');

    lines.push('');

    const type = `Promise<${model.name} | null>`;

    lines.push(`static async get(key: Value | Filter):${type} {
      const row = await db.table('${table.name}').get(key);
      return row ? new ${model.name}(row) : null;
    }`);

    lines.push('');

    lines.push(`
    __set(data: { [key: string]: any }) {
      for (const name in data) {
        const value = data[name];
        if (value === null || value === undefined) {
          this._set(name, null);
          continue;
        }
        switch(name) {
    `);

    for (const field of model.fields) {
      if (field instanceof ForeignKeyField) {
        lines.push(`case '${field.name}':
          this.${field.name} = new ${field.referencedField.model.name}(value);
          break;
        `);
      }
    }

    lines.push(`default:
          this._set(name, value);
          break;
        }
      }
    }`);

    for (const field of model.fields) {
      if (field instanceof ForeignKeyField) {
        lines.push('');
        const name = field.name.charAt(0).toUpperCase() + field.name.slice(1);
        const type = field.referencedField.model.name;
        const promise = `Promise<${type}|null>`;
        lines.push(`async get${name}():${promise} {
          const field = this.table.model.field('${field.name}');
          const row = await super.get(field as ForeignKeyField);
          if (row) {
            this.${field.name} =  new ${type}(row);
            return this.${field.name};
          }
          return null;
        }`);
      }
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
  return !!field.column.autoIncrement || field.column.default !== undefined || isNullable(field);
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

export type DataType = 'Date' | 'number' | 'string' | 'boolean' | 'object';

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

  if (/enum/i.test(name)) {
    // todo: export enums separately
    return 'string';
  }

  throw Error(`Unknown type '${name}'`);
}

interface ExportOptions {
  path?: string;
  package?: string;
  types?: string[];
}

export function shouldSkip(entry: Model | Field, options: ExportOptions) {
  if (!options.types || options.types.length === 0) {
    return false;
  }

  if (entry instanceof Model) {
    return (
      options.types.indexOf(entry.table.name) === -1 &&
      options.types.indexOf(entry.name) === -1
    );
  }

  if (entry instanceof ForeignKeyField) {
    return shouldSkip(entry.referencedField.model, options);
  }

  if (entry instanceof RelatedField) {
    if (entry.throughField) {
      return shouldSkip(entry.throughField.referencedField.model, options);
    } else {
      return shouldSkip(entry.referencingField.model, options);
    }
  }

  return false;
}

export function exportSchemaJava(
  schema: Schema | SchemaInfo,
  options: ExportOptions
) {
  if (!(schema instanceof Schema)) {
    schema = new Schema(schema);
  }

  options = { path: '.', package: '', types: [], ...options };

  for (const model of schema.models) {
    if (!shouldSkip(model, options)) {
      writeModelJava(model, options);
    }
  }

  printDateTimeConverter(options);
}

function writeModelJava(model: Model, options: ExportOptions) {
  const imports: Set<string> = new Set();
  const members: [string, string][] = [];
  imports.add('com.thoughtworks.xstream.annotations.XStreamAlias');
  for (const field of model.fields) {
    if (shouldSkip(field, options)) continue;
    let typeName;
    if (field instanceof ForeignKeyField) {
      typeName = field.referencedField.model.name;
    } else if (field instanceof SimpleField) {
      typeName = getTypeNameJava(field.column.type);
      if (/Date/.test(typeName)) {
        imports.add(`java.time.${typeName}`);
        imports.add('com.thoughtworks.xstream.annotations.XStreamConverter');
      }
    } else {
      const relatedField = field as RelatedField;
      if (relatedField.referencingField.isUnique()) {
        typeName = relatedField.referencingField.model.name;
      } else {
        const relatedField = field as RelatedField;
        const name = relatedField.throughField
          ? relatedField.throughField.referencedField.model.name
          : relatedField.referencingField.model.name;
        if (relatedField.referencingField.isUnique()) {
          typeName = name;
        } else {
          typeName = `List<${name}>`;
          imports.add('java.util.List');
        }
      }
    }
    members.push([typeName, field.name]);
  }

  imports.add('java.util.Objects');

  const lines = [];

  for (const name of imports) {
    lines.push(`import ${name};`);
  }

  const alias = model.name[0].toLowerCase() + model.name.slice(1);
  lines.push(`@XStreamAlias("${alias}")`);
  lines.push(`public class ${model.name} {`);

  for (const [type, name] of members) {
    if (/Date/.test(type)) {
      lines.push('@XStreamConverter(DateTimeConverter.class)');
    }
    lines.push(`private ${type} ${name}`);
  }

  for (const [type, name] of members) {
    const getter = 'get' + name[0].toUpperCase() + name.slice(1);
    lines.push(`public ${type} ${getter}() {`);
    lines.push(`return ${name}`);
    lines.push('}');

    const setter = 'set' + name[0].toUpperCase() + name.slice(1);
    lines.push(`public void ${setter}(${type} ${name}) {`);
    lines.push(`this.${name}=${name}`);
    lines.push('}');
  }

  const pk = model.keyField()!.name;

  lines.push(`
  @Override
  public boolean equals(Object o) {
    if (o == this) return true;
    if (!(o instanceof ${model.name})) {
      return false;
    }
    return ((${model.name})o).${pk} == ${pk};
  }
  `);

  lines.push(`
  @Override
  public int hashCode() {
    return Objects.hash(this.getId());
  }
  `);

  lines.push('}');

  const code = lines
    .join(';\n')
    .replace(/\{;/g, '{')
    .replace(/\};/g, '}')
    .replace(/(@.+?);/g, '$1');

  writeFileJava(model.name, code, options);
}

function getTypeNameJava(name: string) {
  if (/date|time/i.test(name)) {
    return 'LocalDateTime';
  }

  if (/char|text|string/i.test(name)) {
    return 'String';
  }

  if (/int|long/i.test(name)) {
    return 'int';
  }

  if (/float|double/i.test(name)) {
    return 'double';
  }

  if (/^bool/i.test(name)) {
    return 'boolean';
  }

  if (/^json/i.test(name)) {
    return 'String';
  }

  throw Error(`Unknown type '${name}'`);
}

// LocalDateTime.ofInstant(Instant.parse(s), ZoneOffset.of("+10:30"));
function printDateTimeConverter(options: ExportOptions) {
  const code = `
  import com.thoughtworks.xstream.converters.Converter;
  import com.thoughtworks.xstream.converters.MarshallingContext;
  import com.thoughtworks.xstream.converters.UnmarshallingContext;
  import com.thoughtworks.xstream.io.HierarchicalStreamReader;
  import com.thoughtworks.xstream.io.HierarchicalStreamWriter;
  import java.time.Instant;
  import java.time.LocalDateTime;
  import java.time.ZoneOffset;

  public class DateTimeConverter implements Converter {

    public boolean canConvert(Class clazz) {
      return clazz.equals(LocalDateTime.class);
    }

    public void marshal(Object value, HierarchicalStreamWriter writer, MarshallingContext context) {
      LocalDateTime dateTime = (LocalDateTime) value;
      writer.setValue(dateTime.toInstant(ZoneOffset.UTC).toString());
    }

    public Object unmarshal(HierarchicalStreamReader reader, UnmarshallingContext context) {
      LocalDateTime dateTime =
          LocalDateTime.ofInstant(Instant.parse(reader.getValue()), ZoneOffset.UTC);
      return dateTime;
    }
  }
  `;

  writeFileJava('DateTimeConverter', code, options);
}

function writeFileJava(
  className: string,
  code: string,
  options: ExportOptions
) {
  const path = join(
    options.path!,
    (options.package ?? '').replace(/\./g, '/'),
    `${className}.java`
  );
  writeFileSync(
    path,
    options.package ? `package ${options.package};\n${code}` : code
  );
}
