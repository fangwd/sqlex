import { Database } from './database';
import { parse, Node as ASTNode } from './parser';
import { Kind, NameNode, rewrite } from './parser/ast';
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
  from: string;

  constructor(db: Database, options: ViewOptions) {
    this.db = db;
    this.schema = db.schema;
    this.options = options;

    this.fields = [];
    this.fieldMap = {};
    this.aliasMap = this.buildAliasMap();
    this.from = this.buildFrom();

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

  private buildFrom() {
    const options = this.options;
    const froms = [];

    const id = (id: string) => this.db.pool.escapeId(id);

    const { name, alias } = parseTable(options.table);
    froms.push(id(name) + ' ' + id(alias));

    if (options.joins) {
      for (const entry of options.joins) {
        const { name, alias } = parseTable(entry.table);
        let join = (entry.type || 'inner') + ' join ' + id(name) + ' ' + id(alias);
        if (entry.type !== 'cross') {
          const expr = parse(entry.on!);

          const options = {
            name: (path: string) => {
              const match = /^([^.]+)\.(.+)$/.exec(path);
              if (match) {
                const model = this.db.table(this.aliasMap[match[1]]).model;
                const field = model.field(match[2]) as SimpleField;
                return id(match[1]) + '.' + id(field.column.name);
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

  model(alias:string) {
    return this.schema.model(this.aliasMap[alias]);
  }

  field(path:string) {
    const dot = path.indexOf('.');
    if (dot > -1) {
      const alias = path.substring(0, dot);
      const name = path.substring(dot+1);
      const model = this.db.table(this.aliasMap[alias]).model;
      return model.field(name);
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
    return new ForeignKeyField(field.model, field.column, field.config);
  }
  return new SimpleField(field.model, field.column, field.config);
}
