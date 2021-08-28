import { Database, Filter } from './database';
import { QueryBuilder } from './filter';
import { parse, Node as ASTNode } from './parser';
import { InfixNode, Kind, NameNode, rewrite, visit } from './parser/ast';
import { ComputedField, Field, ForeignKeyField, Schema, SimpleField } from './schema';

type TableEntry = string;

type JoinType = 'inner' | 'left' | 'right' | 'cross';

type JoinEntry = {
  type?: JoinType; // default 'inner'
  table: TableEntry;
  on?: string;
};

export type ViewOptions = {
  table: TableEntry;
  joins?: JoinEntry[];
};

export class ViewModel {
  db: Database;
  schema: Schema;
  name: string;
  fields: Field[];
  fieldMap: { [key: string]: SimpleField | ComputedField };
  aliasMap: { [key: string]: string }; // prefix -> table_name
  options: ViewOptions;

  constructor(db: Database, options: ViewOptions) {
    this.db = db;
    this.schema = db.schema;
    this.options = options;

    this.fields = [];
    this.fieldMap = {};
    this.aliasMap = this.buildAliasMap();

    this.buildFields();
  }

  private buildAliasMap() {
    const options = this.options;
    const aliasMap = {};
    const { name, alias } = parseTable(options.table);
    aliasMap[alias] = name;
    if (options.joins) {
      for (const entry of options.joins) {
        const { name, alias } = parseTable(entry.table);
        aliasMap[alias] = name;
      }
    }
    return aliasMap;
  }

  private buildFields() {
    const db = this.db;
    const aliasMap = this.aliasMap;

    for (const alias in aliasMap) {
      const model = db.model(aliasMap[alias]);
      for (const field of model.fields) {
        if (field instanceof SimpleField) {
          const copy = cloneField(field);
          this.fields.push(copy);
          this.fieldMap[field.name] = copy;
        }
      }
    }
  }

  buildFrom(builder: QueryBuilder, filter: Filter) {
    const options = this.options;
    const froms = [];

    const id = (id: string) => this.db.pool.escapeId(id);

    const { name, alias } = parseTable(options.table);
    froms.push(id(name) + ' ' + id(alias));

    let prevAlias = alias;
    let prevModel = this.db.table(name)!.model;

    if (options.joins) {
      for (const entry of options.joins) {
        const { name, alias } = parseTable(entry.table);
        let join = (entry.type || 'inner') + ' join ' + id(name) + ' ' + id(alias);
        if (entry.type !== 'cross') {
          const expr = parse(entry.on!);
          visit(expr, (name) => builder._extendFilter(filter, [name]));
          const options = {
            name: (path: string) => {
              const match = /^([^.]+)\.(.+)$/.exec(path);
              if (match) {
                const path = match[2].split('.');
                if (path.length === 1 && this.aliasMap[match[1]]) {
                  const model = this.db.table(this.aliasMap[match[1]]).model;
                  const field = model.field(match[2]) as SimpleField;
                  return id(match[1]) + '.' + id(field.column.name);
                } else {
                  const context = builder.context!;
                  const names = [];

                  const first = this.aliasMap[match[1]];
                  if (first) {
                    prevAlias = match[1];
                    prevModel = this.db.table(first)!.model;
                  } else {
                    path.unshift(match[1]);
                  }

                  for (let i = 0; i < path.length - 1; i++) {
                    const field = prevModel.field(path[i]) as ForeignKeyField;
                    names.push(path[i]);
                    const model = field.referencedField.model;
                    const alias = context.getAlias(model, field, names).alias;
                    const lhs = `${id(prevAlias)}.${id(field.column.name)}`;
                    const rhs = `${id(alias)}.${id(model.keyField().column.name)}`;
                    froms.push(`join ${id(model.table.name)} ${id(alias)} on ${lhs} = ${rhs}`);
                    prevModel = model;
                    prevAlias = alias;
                  }
                  const field = prevModel.field(path[path.length - 1]) as SimpleField;
                  return id(prevAlias) + '.' + id(field.column.name);
                }
              }
              return id((this.fieldMap[path] as SimpleField).column.name);
            },
            text: (str: string) => this.db.pool.escape(str),
          };

          join += ' on ' + rewrite(expr, options);
        }
        froms.push(join);
      }
    }

    return froms.join(' ');
  }

  model(alias: string) {
    return this.schema.model(this.aliasMap[alias]);
  }

  field(path: string) {
    const dot = path.indexOf('.');
    if (dot > -1) {
      const alias = path.substring(0, dot);
      if (this.aliasMap[alias]) {
        const name = path.substring(dot + 1);
        const model = this.db.table(this.aliasMap[alias]).model;
        return model.field(name);
      } else {
        const model = this.db.table(this.options.table).model;
        return model.field(path);
      }
    }
    return this.fieldMap[path];
  }
}

function parseTable(name: string) {
  const ast = parse(name) as NameNode;
  return { name: ast.name, alias: ast.alias || ast.name };
}

export function cloneField(field: SimpleField): SimpleField {
  if (field instanceof ForeignKeyField) {
    const copy = new ForeignKeyField(field.model, field.column, field.config);
    copy.referencedField = field.referencedField;
    copy.relatedField = field.relatedField;
    return copy
  }
  return new SimpleField(field.model, field.column, field.config);
}
