import { Filter, OrderBy, toRow, shouldSelectSeparately, getUniqueFields, SelectOptions } from './database';
import { Record } from './record';
import {
  FlatNode,
  FunctionCallNode,
  InfixNode,
  Kind,
  ListNode,
  NameNode,
  Node as AST,
  PrefixNode,
  rewrite,
  rewriteFlat,
  StarNode,
} from './parser/ast';
import { AS, NAME } from './parser/parser';

import {
  Field,
  SimpleField,
  ForeignKeyField,
  RelatedField,
  isValue,
  ComputedField,
  Model as TableModel,
} from './schema';
import { Document, Value } from './types';
import { DialectEncoder } from './engine';
import { toArray } from './misc';
import { parse, parseFlat } from './parser/index';
import { ViewModel } from './view';

type Model = TableModel | ViewModel;

export interface AliasEntry {
  name: string;
  model: Model;
}

export interface SelectQuery {
  fields: string;
  tables: string;
  where?: string;
  orderBy?: string;
  groupBy?: string;
  having?: string;
}

export class Context {
  private counter: number;

  aliasMap: { [key: string]: AliasEntry } = {};

  constructor() {
    this.counter = 0;
  }

  getAliasForBuilder(builder: QueryBuilder) {
    const model = builder.model;
    const field = builder.field;
    const names: string[] = [];
    while (builder.parent) {
      names.unshift(builder.field.name);
      builder = builder.parent;
    }
    return this.getAlias(model, field, names);
  }

  getAlias(model: Model, field: Field, names: string[]) {
    const key = names.join('.');
    const entry = this.aliasMap[key];
    if (!entry) {
      const alias = 't' + this.counter++;
      if (field instanceof ForeignKeyField) {
        this.aliasMap[key] = { name: alias, model: model };
      }
      return { alias, seen: false };
    }
    return { alias: entry.name, seen: true };
  }
}

type FieldEntry = {
  expr: string; // escaped
  name: string; // non-escaped
  skip?: boolean;
};

type HavingContext = {
  fieldMap: {[key:string]: FieldEntry};
}

export class QueryBuilder {
  model: Model;
  field?: Field;
  parent?: QueryBuilder;

  dialect: DialectEncoder;
  context?: Context;
  alias: string;
  skipJoin?: boolean;
  froms?: string[];

  fieldMap = {};
  having?: HavingContext;

  getFroms() {
    let builder: QueryBuilder = this;
    while (builder && builder.field instanceof ForeignKeyField) {
      builder = builder.parent;
    }
    return builder.froms;
  }

  // (model, dialect), or (parent, field)
  constructor(model: Model | QueryBuilder, dialect: DialectEncoder | Field) {
    if (!(model instanceof QueryBuilder)) {
      this.model = model;
      this.dialect = dialect as DialectEncoder;
      this.context = new Context();
      if (model instanceof TableModel) {
        this.alias = model.table.name;
      } else {
        this.alias = '';
        for (const key in model.aliasMap) {
          this.context.aliasMap[key] = {
            name: key,
            model: model.db.model(model.aliasMap[key]),
          };
        }
      }
    } else {
      this.parent = model;
      this.field = dialect as Field;
      this.dialect = this.parent.dialect;
      this.context = this.parent.context;
      if (dialect instanceof ForeignKeyField) {
        this.model = dialect.referencedField.model;
      } else if (dialect instanceof RelatedField) {
        this.model = dialect.referencingField.model;
      }
      const { alias, seen } = this.context.getAliasForBuilder(this);
      this.alias = alias;
      this.skipJoin = seen;
    }
  }

  where(args: Filter): string {
    if (!args) return '';
    if (!this.having) {
      args = plainify(args);
    }
    if (Array.isArray(args)) {
      return this.or(args);
    } else {
      return this.and(args as Filter);
    }
  }

  private or(args: Filter[]): string {
    const exprs = args.map((arg) => this.and(arg));
    return exprs.length === 0
      ? ''
      : exprs.length === 1
      ? exprs[0]
      : exprs.map((x) => `(${x})`).join(' or ');
  }

  private prefix(alias: string | undefined) {
    return alias ? this.escapeId(alias) + '.' : '';
  }

  private and(args: Filter): string {
    const exprs: string[] = [];
    for (const key in args) {
      const [name, operator] = splitKey(key);
      const field = this.having ? null : this.model.field(name);
      const value = args[key];
      if (field instanceof ForeignKeyField) {
        const query = value as Filter;
        if (query === null || typeof query !== 'object') {
          exprs.push(this.expr(field, operator || '=', value));
        } else if (Array.isArray(query)) {
          const values = [];
          const filter = [];
          for (const arg of query) {
            if (arg === null || typeof arg !== 'object') {
              values.push(arg);
            } else {
              filter.push(arg);
            }
          }
          let expr = values.length > 0 ? this.expr(field, 'in', values) : 'false';
          if (filter.length > 0) {
            if (expr.length > 0) expr += ' or ';
            expr += this._join(field, filter);
          }
          if (expr.length > 0) {
            exprs.push(`${expr}`);
          }
        } else {
          const keys = Object.keys(query);
          if (keys.length === 1) {
            const [name, operator] = splitKey(keys[0] as string);
            if (name === field.referencedField.name) {
              const value = query[keys[0]] as Value;
              if (isValue(value)) {
                exprs.push(this.expr(field, operator, value));
                continue;
              }
            }
            const relatedField = field.referencedField.model.field(name);
            if (relatedField instanceof RelatedField) {
              const referencingField = relatedField.referencingField;
              const builder = new QueryBuilder(referencingField.model, this.dialect);
              let where = query[keys[0]] as Filter;
              if (relatedField.throughField && relatedField.name === keys[0]) {
                where = {
                  [relatedField.throughField.name]: where,
                };
              }
              const rhs = builder.select(referencingField, { where });
              const lhs = this.alias
                ? `${this.prefix(this.alias)}${this.escapeId(field)}`
                : this.escapeId(field);
              exprs.push(`${lhs} in (${rhs})`);
              continue;
            }
          }
          const expr = this._join(field, query);
          if (expr.length > 0) {
            exprs.push(`${expr}`);
          }
        }
      } else if (field instanceof SimpleField) {
        exprs.push(this.expr(field, operator, value));
      } else if (field instanceof RelatedField) {
        const filter = value === '*' ? {} : (value as Filter);
        exprs.push(this.exists(field, operator, filter));
      } else if (key === AND) {
        // { and: [{name_like: "%Apple%"}, {price_lt: 6}] }
        exprs.push(value.map((c) => this.and(c)).join(' and '));
      } else if (key === OR) {
        /*
         { or: [
                { name_like: "%Apple%" },
                { productCategories_some:
                  { category: { name: 'Banana' } }
                }
              ]
         }
         */
        exprs.push('(' + value.map((c) => this.and(c)).join(' or ') + ')');
      } else if (key === NOT) {
        /*
         { not: [
                { name_like: "%Apple%" },
                { productCategories_some:
                  { category: { name: 'Banana' } }
                }
              ]
         }
         */
        const filters = toArray(value);
        exprs.push('not (' + filters.map((c) => this.and(c)).join(' or ') + ')');
      } else if (field instanceof ComputedField) {
        exprs.push(this.expr(field, operator, value));
      } else if (this.having) {
        const lhs = this.having.fieldMap[name].expr;
        const rhs =
          typeof value === 'number' || typeof value === 'boolean'
            ? value
            : this.dialect.escape(value);
        exprs.push(`${lhs} ${operator} ${rhs}`);
      } else if (name !== '*') {
        throw Error(`Bad field: ${this.model.name}.${name}`);
      }
    }
    return exprs.length === 0
      ? ''
      : exprs.length === 1
      ? exprs[0]
      : exprs.map((x) => `(${x})`).join(' and ');
  }

  private expr(field: SimpleField | ComputedField, operator: string, value: Value | Value[]) {
    const lhs =
      field instanceof ComputedField
        ? this.escapeId(field.name)
        : this.encodeField(field.column.name);
    if (Array.isArray(value)) {
      if (!operator || operator === 'in' || operator === 'notIn') {
        const values = value
          .filter((value) => value !== null)
          .map((value) => this.escape(field, value));
        const not = operator === 'notIn' ? 'not ' : '';
        const or = operator === 'notIn' ? 'and' : 'or';
        if (values.length < value.length) {
          return values.length === 0
            ? `${lhs} is ${not}null`
            : `(${lhs} is ${not}null ${or} ${lhs} ${not}in (${values.join(', ')}))`;
        } else {
          if (values.length === 0) return 'false';
          return `${lhs} ${not}in (${values.join(', ')})`;
        }
      } else {
        throw Error(`Bad value: ${JSON.stringify(value)}`);
      }
    }

    operator = operator || '=';

    if ((operator === '=' || operator === '<>') && value === null) {
      const not = operator === '<>' ? 'not ' : '';
      return `${lhs} is ${not}null`;
    }

    if (operator === 'null') {
      return value ? `${lhs} is null` : `${lhs} is not null`;
    }

    return `${lhs} ${operator} ${this.escape(field, value)}`;
  }

  _extendFilter(filter: Filter, orderBy: OrderBy): Filter {
    for (const entry of toArray(orderBy)) {
      const fields = entry.replace(/^-/, '').split('.');
      let result = filter;
      let model, start;
      if (this.model instanceof ViewModel) {
        model = this.model.model(fields[0]);
        start = 1;
      } else {
        model = this.model;
        start = 0;
      }
      for (let i = start; i < fields.length - 1; i++) {
        const name = fields[i];
        const field = model.field(name);
        if (!(field instanceof ForeignKeyField)) {
          throw Error(`Not a foreign key: ${entry}`);
        }
        if (
          i < fields.length - 2 ||
          (i === fields.length - 2 &&
            fields[i + 1] !== field.referencedField.model.primaryKey.name())
        ) {
          if (!result[name]) {
            result[name] = {};
          }
          result = result[name];
          model = field.referencedField.model;
        }
      }
    }
    return filter;
  }

  _resolveField(fullpath: string, flat?: boolean): { column: string; alias?: string } {
    const aliasMap = this.context.aliasMap;
    let alias,
      field: Field,
      path = fullpath,
      model = this.model;

    if (this.model instanceof ViewModel) {
      const match = /^([^\.]+)\.(.+)$/.exec(fullpath);
      if (match && this.model.model(match[1])) {
        path = match[2];
        model = this.model.model(match[1]);
      }
    }

    const match = /^(.+)\.([^\.]+)$/.exec(path);

    if (match) {
      const entry = aliasMap[match[1]];
      if (entry) {
        alias = entry.name;
        field = entry.model.field(match[2]);
      } else {
        const name = path.split('.')[0];
        alias = this.alias;
        field = model.field(name);
      }
    } else {
      alias = this.alias;
      field = model.field(path);
    }

    if (field instanceof SimpleField) {
      const column = `${this.prefix(alias)}${this.escapeId(field)}`;
      if (match) {
        const name = path.replace(/\./g, '__');
        return { column, alias: name };
      } else {
        return { column };
      }
    }

    if (flat) {
      return { column: fullpath };
    }

    throw new Error(`Invalid field: ${fullpath}`);
  }

  _pushField(fields: FieldEntry[], path: string) {
    const { column, alias } = this._resolveField(path);
    fields.push({ expr: column, name: alias });
    return column;
  }

  _prefix(path: string, escapedField: string) {
    if (this.model instanceof ViewModel) {
      const match = /^([^.]+)\.[^.]+$/.exec(path);
      if (match && match[1] in this.model.aliasMap) {
        return this.escapeId(match[1]) + '.' + escapedField;
      }
    }
    return escapedField;
  }

  _select(
    name: string | SimpleField | Document | AST[],
    { where: filter, orderBy, groupBy, having }: SelectOptions
  ): SelectQuery {
    filter = filter || {};
    if (this.model instanceof ViewModel) {
      this.froms = [this.model.buildFrom(this, filter)];
    } else {
      this.froms = [`${this.escapeId(this.model.table.name)} ${this.escapeId(this.alias) || ''}`];
    }

    if (!(name instanceof Field || typeof name === 'string')) {
      if (Array.isArray(name)) {
        for (const ast of name) {
          extendByAst(this.model, filter, ast);
        }
      } else {
        // { code: 'ID', user: { firstName: 'name' } }
        extendFilter(this.model, filter, name as Document);
      }
    }

    if (orderBy) {
      // orderBy: ['-user.email']
      filter = this._extendFilter(filter, orderBy);
    }

    const where = this.where(filter).trim();

    const fields: FieldEntry[] = [];
    if (name instanceof Field || typeof name === 'string') {
      const entry = {
        name: typeof name === 'string' ? name : name.column.name,
        expr: this.encodeField(name),
      };
      fields.push(entry);
      if (name === '*') {
        for (const field of this.model.fields) {
          if (field instanceof SimpleField) {
            fields.push({
              expr: this.encodeField(field),
              name: field.name,
              skip: true,
            });
          }
        }
      }
    } else if (Array.isArray(name)) {
      const options = {
        name: (path: string) => this._resolveField(path).column,
        text: (str: string) => this.dialect.escape(str),
      };
      const flat = {
        name: (path: string) => this._resolveField(path, true).column,
      };
      name.forEach((ast) => {
        if (ast instanceof FlatNode) {
          const node = ast as FlatNode;
          const expr = rewriteFlat(node, flat);
          fields.push({ expr, name: node.alias });
          return;
        }
        if (ast instanceof NameNode) {
          const path = ast.name;
          const match = /^([^.]+)\.\*$/.exec(path);
          if (match) {
            // p.*
            const model = this.context.aliasMap[match[1]].model;
            for (const field of model.fields) {
              if (field instanceof SimpleField) {
                const prefix = this.dialect.escapeId(match[1]);
                const expr = `${prefix}.${this.escapeId(field.column.name)}`;
                fields.push({ expr, name: field.name });
              }
            }
            return;
          }
        } else if (ast instanceof StarNode) {
          const view = this.model as ViewModel;
          for (const key in view.aliasMap) {
            const model = view.model(key);
            for (const field of model.fields) {
              if (field instanceof SimpleField) {
                const prefix = this.dialect.escapeId(key);
                const expr = `${prefix}.${this.escapeId(field.column.name)}`;
                fields.push({ name: field.name, expr });
              }
            }
          }
          return;
        }
        const expr = rewrite(ast, options);
        let name;
        if (ast.alias) {
          name = ast.alias;
        } else if (ast.kind === Kind.NAME) {
          const field = this.model.field((ast as NameNode).name);
          name = field.name;
        }
        fields.push({ name, expr });
      });
    } else {
      const names = getFields(this.model, name, this.fieldMap);
      for (const key of names) {
        this._pushField(fields, key);
      }
    }

    let groupByPart = undefined;

    if (groupBy) {
      groupByPart = groupBy
        .map((path) => this._prefix(path, this._resolveField(path).column))
        .join(',');
    }

    if (orderBy) {
      orderBy = toArray(orderBy).map((order: string) => {
        const [path, direction] = order[0] === '-' ? [order.substr(1), 'DESC'] : [order, 'ASC'];
        const column =
          this.model instanceof ViewModel
            ? this._resolveField(path).column
            : this._pushField(fields, path);
        return `${column} ${direction}`;
      });
    }

    let havingPart = undefined;
    if (having) {
      this.having = {
        fieldMap: fields.reduce((map, field) => {
          map[field.name] = field;
          return map;
        }, {}),
      };
      havingPart = this.where(having);
      this.having = undefined;
    }

    return {
      fields: fields
        .filter((field) => !field.skip)
        .map((field) =>
          field.name && field.name !== '*'
            ? `${field.expr} as ${this.escapeId(field.name)}`
            : field.expr
        )
        .join(', '),
      tables: this.froms.join(' left join '),
      where,
      orderBy: orderBy ? (orderBy as string[]).join(', ') : null,
      groupBy: groupByPart,
      having: havingPart,
    };
  }

  select(
    name: string | SimpleField | Document | string[],
    {
      where,
      orderBy,
      groupBy,
      raw,
      filterThunk,
      having,
    }: SelectOptions & {
      filterThunk?: (QueryBuilder) => string;
    }
  ): string {
    const query = this._select(
      Array.isArray(name) ? name.map((entry) => (raw ? parseFlat(entry) : parse(entry))) : name,
      { where, orderBy, groupBy, having }
    );
    let sql = `select ${query.fields} from ${query.tables}`;
    if (query.where) {
      sql += ` where ${query.where}`;
    }
    if (filterThunk) {
      const extra = filterThunk(this);
      if (extra) {
        if (!query.where) {
          sql += ' where ';
        } else {
          sql += ' and ';
        }
        sql += `(${extra})`;
      }
    }
    if (query.groupBy) {
      sql += ` group by ${query.groupBy}`;
    }
    if (query.orderBy) {
      sql += ` order by ${query.orderBy}`;
    }
    if (query.having) {
      sql += ` having ${query.having}`;
    }
    return sql;
  }

  encodeField(name: string | SimpleField): string {
    if (name instanceof SimpleField) {
      name = name.column.name;
    }

    if (/count\(\*\)/i.test(name)) {
      return name;
    }

    if (name !== '*') {
      name = this.escapeId(name);
    }

    return `${this.prefix(this.alias)}${name}`;
  }

  private _join(field: ForeignKeyField, args: Filter) {
    if (!this.getFroms()) return this._in(field, args);

    const builder = new QueryBuilder(this, field);
    const model = field.referencedField.model;
    const keys = Object.keys(args);
    if (keys.length === 1 && keys[0] === model.keyField().name) {
      if (isValue(args[keys[0]])) {
        return this.expr(field, null, args[keys[0]]);
      }
    }

    if (!builder.skipJoin) {
      const name = `${this.escapeId(model.table.name)} ${builder.alias}`;
      const lhs = this.encodeField(field);
      const rhs = builder.encodeField(model.keyField());
      this.getFroms().push(`${name} on ${lhs}=${rhs}`);
    }

    return builder.where(args);
  }

  private _in(field: ForeignKeyField, args: Filter) {
    const builder = new QueryBuilder(this, field);
    const model = field.referencedField.model;
    const keys = Object.keys(args);
    if (keys.length === 1 && keys[0] === model.keyField().name) {
      return this.expr(field, null, args[keys[0]]);
    }
    const lhs = this.encodeField(field.column.name);
    const rhs = builder.select(model.keyField().column.name, { where: args });
    return `${lhs} in (${rhs})`;
  }

  private exists(field: RelatedField, operator: string, args: Filter) {
    const builder = new QueryBuilder(this, field);

    const where = field.throughField ? builder._in(field.throughField, args) : builder.where(args);

    const keyField = field.referencingField.referencedField;
    const scope =
      builder.select('*', {}) +
      ' where ' +
      builder.encodeField(field.referencingField.column.name) +
      '=' +
      this.encodeField(keyField.name);

    const exists = operator === 'none' ? 'not exists' : 'exists';

    return where.length > 0 ? `${exists} (${scope} and ${where})` : `${exists} (${scope})`;
  }

  private escape(field: SimpleField | ComputedField, value: Value): string {
    if (field instanceof ComputedField) {
      return this.dialect.escape(value);
    }
    if (/^bool/i.test(field.column.type)) {
      return value ? 'true' : 'false';
    }
    if (/int|float|double|number/i.test(field.column.type)) {
      if (typeof value === 'number') {
        return value + '';
      }
    }
    return this.dialect.escape(toRow(value, field) + '');
  }

  private escapeId(name: string | SimpleField): string {
    if (name instanceof SimpleField) {
      name = name.column.name;
    }
    return this.dialect.escapeId(name);
  }
}

export function encodeFilter(args: Filter, model: Model, escape: DialectEncoder): string {
  const builder = new QueryBuilder(model, escape);
  return builder.where(args);
}

export const AND = 'and';
export const OR = 'or';
export const NOT = 'not';
export const LT = 'lt';
export const LE = 'le';
export const GE = 'ge';
export const GT = 'gt';
export const NE = 'ne';
export const IN = 'in';
export const NOT_IN = 'notIn';
export const LIKE = 'like';
export const NULL = 'null';
export const SOME = 'some';
export const NONE = 'none';

const OPERATOR_MAP = {
  [LT]: '<',
  [LE]: '<=',
  [GE]: '>=',
  [GT]: '>',
  [NE]: '<>',
  [IN]: 'in',
  [NOT_IN]: 'notIn',
  [LIKE]: 'like',
};

export function splitKey(arg: string): string[] {
  const match = /^(.+?)_([^_]+)$/.exec(arg);
  if (match) {
    const op = match[2] in OPERATOR_MAP ? OPERATOR_MAP[match[2]] : match[2];
    return [match[1], op];
  }
  return [arg];
}

export function plainify(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry !== undefined).map((entry) => plainify(entry));
  } else if (isValue(value)) {
    return value;
  } else if (value instanceof Record) {
    const model = value.__table.model;
    if (value.__primaryKey()) {
      return { [model.keyField().name]: value.__primaryKey() };
    } else {
      return getUniqueFields(model, value.__data);
    }
  } else {
    const result = {};
    for (const key in value) {
      result[key] = plainify(value[key]);
    }
    return result;
  }
}

function pkOnly(doc: Document | string, field: ForeignKeyField) {
  const model = field.referencedField.model;
  if (typeof doc === 'string') {
    return doc === model.keyField().name;
  }
  if (doc && !isValue(doc)) {
    const keys = Object.keys(doc);
    return keys.length === 1 && keys[0] === model.keyField().name;
  }
  return false;
}

// Extends the filter to include foreign key fields
function extendFilter(model: Model, filter: Filter, fields: Document) {
  for (const name in fields) {
    const value = fields[name] === '*' ? {} : fields[name];
    if (value && typeof value === 'object') {
      const field = model.field(name);
      if (field instanceof ForeignKeyField) {
        if (!filter[name]) {
          filter[name] = {};
        }
        if (fields[name] === '*' || !pkOnly(value as Document, field)) {
          filter[name]['*'] = true;
        }
        extendFilter(field.referencedField.model, filter[name] as Filter, value as Document);
      }
    }
  }
}

// name: order.user.email
function extendByFieldName(model: Model, filter: Filter, dotted: string) {
  let dot = dotted.indexOf('.');

  if (dot < 0) {
    return;
  }

  if (model instanceof ViewModel) {
    if (dotted.substring(0, dot) in model.aliasMap) {
      dot = dotted.indexOf('.', dot + 1);
    }
  }

  const name = dotted.substring(0, dot);
  const field = model.field(name);
  const doc = dotted.substring(dot + 1);

  if (field instanceof ForeignKeyField) {
    if (!filter[name]) {
      filter[name] = {};
    }
    if (!pkOnly(doc, field)) {
      filter[name]['*'] = true;
    }
    extendByFieldName(field.referencedField.model, filter[name], doc);
  }
}

function extendByAst(model: Model, filter: Filter, ast: AST) {
  if (ast.kind === Kind.FLAT) {
    const flat = ast as FlatNode;
    for (const token of flat.tokens) {
      if (token.type === NAME) {
        extendByFieldName(model, filter, token.text);
      }
    }
    return;
  }
  switch (ast.kind) {
    case Kind.NAME:
      extendByFieldName(model, filter, (ast as NameNode).name);
      break;
    case Kind.INFIX:
      extendByAst(model, filter, (ast as InfixNode).lhs);
      extendByAst(model, filter, (ast as InfixNode).rhs);
      break;
    case Kind.FCALL:
      extendByAst(model, filter, (ast as FunctionCallNode).args);
      break;
    case Kind.LIST:
      for (const entry of (ast as ListNode).list) {
        extendByAst(model, filter, entry);
      }
      break;
    case Kind.PREFIX:
      extendByAst(model, filter, (ast as PrefixNode).expr);
      break;
    default:
      break;
  }
}

function getFields(model: Model, input: string | Document, fieldMap, prefix?: string) {
  let result = [];

  const getKey = (name: string) => (prefix ? `${prefix}.${name}` : name);

  // By default, all fields in a model are included in the query result
  for (const field of model.fields) {
    if (field instanceof SimpleField) {
      result.push(getKey(field.name));
    }
  }

  if (typeof input === 'string') {
    if (input === '*') return result;
  }

  for (const name in input as Document) {
    const key = getKey(name);
    const value = input[name];

    if (!value) {
      const index = result.indexOf(key);
      if (index > -1) {
        result.splice(index, 1);
      }
    } else {
      const field = model.field(name);
      if (field instanceof ForeignKeyField) {
        const model = field.referencedField.model;
        if (!shouldSelectSeparately(model, value as Document)) {
          const fields = getFields(model, value as Document, fieldMap, key);
          result = result.concat(fields);
        }
      } else if (typeof value === 'string') {
        fieldMap[key.replace(/\./g, '__')] = value;
      }
    }
  }

  return result;
}
