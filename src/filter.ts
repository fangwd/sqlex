import { Filter, OrderBy, shouldSelectSeparately, getUniqueFields, SelectOptions } from './database';
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
import { isPlainObject } from './utils';
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
  fieldMap = new FieldMap();

  constructor() {
    this.counter = 0;
  }

  getAliasForBuilder(builder: QueryBuilder) {
    const model = builder.model;
    const field = builder.field;
    const names: string[] = [];
    while (builder.parent) {
      names.unshift(builder.field!.name);
      builder = builder.parent;
    }
    return this.getAlias(model, field!, names);
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
  name?: string; // non-escaped
  skip?: boolean;
};

type HavingContext = {
  fieldMap: {[key:string]: FieldEntry};
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
export const ILIKE = 'ilike';
export const NULL = 'null';
export const SOME = 'some';
export const NONE = 'none';

export type OperatorMap = { [key:string]: string };

const DEFAULT_OPERATOR_MAP: OperatorMap = {
  [LT]: '<',
  [LE]: '<=',
  [GE]: '>=',
  [GT]: '>',
  [NE]: '<>',
  [IN]: 'in',
  [NOT_IN]: 'notIn',
  [LIKE]: 'like',
  [ILIKE]: 'ilike',
};

export const CONTAINS = 'contains';
export const EQ = 'eq';

export type JsonOperatorSyntax = 'explicit' | 'suffix' | 'both';

export interface JsonFilterOptions {
  operatorSyntax?: JsonOperatorSyntax;
  operatorDelimiter?: '_' | '__';
}

type ResolvedJsonFilterOptions = Required<JsonFilterOptions>;

const DEFAULT_JSON_FILTER_OPTIONS: ResolvedJsonFilterOptions = {
  operatorSyntax: 'both',
  operatorDelimiter: '_',
};

function isJsonField(field: SimpleField): boolean {
  return /^json/i.test(field.column.type);
}

export class QueryBuilder {
  model!: Model;
  field?: Field;
  parent?: QueryBuilder;

  dialect: DialectEncoder;
  context!: Context;
  alias: string;
  skipJoin?: boolean;
  froms?: string[];

  having?: HavingContext;
  operatorMap: OperatorMap;
  jsonOptions!: ResolvedJsonFilterOptions;

  getFroms() {
    let builder: QueryBuilder = this;
    while (builder && builder.field instanceof ForeignKeyField) {
      builder = builder.parent!;
    }
    return builder.froms;
  }

  // (model, dialect), or (parent, field)
  constructor(model: Model | QueryBuilder, dialect: DialectEncoder | Field,
      operatorMap?: OperatorMap, jsonOptions?: JsonFilterOptions) {
    if (!(model instanceof QueryBuilder)) {
      this.model = model;
      this.dialect = dialect as DialectEncoder;
      this.operatorMap = { ...DEFAULT_OPERATOR_MAP, ...operatorMap };
      this.jsonOptions = { ...DEFAULT_JSON_FILTER_OPTIONS, ...jsonOptions };
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
      if (this.dialect.dialect !== 'postgres') {
        this.operatorMap['ilike'] = 'like';
      }
    } else {
      this.parent = model;
      this.field = dialect as Field;
      this.dialect = this.parent.dialect;
      this.operatorMap = this.parent.operatorMap;
      this.jsonOptions = this.parent.jsonOptions;
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
      args = plainify(args) as Filter;
    }
    if (Array.isArray(args)) {
      return this.or(args);
    } else {
      return this.and(args as Filter);
    }
  }

  private or(args: Filter[]): string {
    const model = this.model;
    const keys = Object.keys(args[0]);
    const fields:SimpleField[] = [];
    let useIn = !keys.some(entry => {
      const [key, op] = this.splitKey(entry);
      if (op && op !== 'eq') {
        return true;
      }
      const field = model.field(key);
      if (!(field instanceof SimpleField)) {
        return true;
      }
      fields.push(field);
    });
    if (useIn) {
      const keySet = new Set(keys);
      for (const arg of args) {
        const keys = Object.keys(arg);
        if (keys.length !== keySet.size) {
          useIn = false;
          break;
        }
        for (const key of keys) {
          const value = (arg as Document)[key];
          if (!keySet.has(key) || Array.isArray(value)) {
            useIn = false;
            break;
          }
          const field = model.field(this.splitKey(key)[0]) as SimpleField;
          if (field instanceof ForeignKeyField) {
            if (value && typeof value === 'object') {
              const keys = Object.keys(value);
              if (keys.length !== 1 || keys[0] !== field.referencedField.name) {
                useIn = false;
                break;
              }
            }
          }
        }
        if (!useIn) {
          break;
        }
      }
      if (useIn) {
        const alias = this.prefix(this.alias);
        const names = fields.map((field) => alias + this.escapeId(field)).join(',');
        const values = args
          .map((arg) => {
            const tuple = keys
              .map((key, i) => {
                const field = fields[i];
                const value = (arg as Document)[key];
                const actual =
                  field instanceof ForeignKeyField && value && typeof value === 'object'
                    ? (value as Document)[field.referencedField.name]
                    : value;
                return this.escape(field, actual as Value);
              })
              .join(',');
            return fields.length > 1 ? '(' + tuple + ')' : tuple;
          })
          .join(',');
        const prefix = fields.length > 1 && this.dialect.dialect === 'sqlite3' ? 'values ' : '';
        return `(${names}) in (${prefix}${values})`;
      }
    }

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
      const [name, operator] = this.splitKey(key);
      const field = this.having ? null : this.model.field(name);
      const value = (args as Document)[key];
      if (field instanceof ForeignKeyField) {
        const query = value as Filter;
        if (query === null || typeof query !== 'object') {
          exprs.push(this.expr(field, operator || '=', value as Value));
        } else if (Array.isArray(query)) {
          const values: Value[] = [];
          const filter: Document[] = [];
          for (const arg of query as (Value | Document)[]) {
            if (arg === null || typeof arg !== 'object') {
              values.push(arg as Value);
            } else {
              filter.push(arg as Document);
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
            const [name, operator] = this.splitKey(keys[0] as string);
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
              const builder = new QueryBuilder(
                referencingField.model,
                this.dialect,
                this.operatorMap,
                this.jsonOptions
              );
              let where = query[keys[0]] as Filter;
              if (relatedField.throughField && relatedField.name === name) {
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
        if (isJsonField(field) && isPlainObject(value)) {
          if (operator) {
            throw Error(`Operator '${operator}' cannot take an object value: ${name}`);
          }
          const expr = this.jsonWhere(field, value as Document, []);
          if (expr) exprs.push(expr);
        } else {
          exprs.push(this.expr(field, operator, value as Value | Value[]));
        }
      } else if (field instanceof RelatedField) {
        const filter = value === '*' ? {} : (value as Filter);
        exprs.push(this.exists(field, operator, filter));
      } else if (key === AND) {
        // { and: [{name_like: "%Apple%"}, {price_lt: 6}] }
        exprs.push((value as Document[]).map((c) => this.and(c)).join(' and '));
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
        exprs.push('(' + (value as Document[]).map((c) => this.and(c)).join(' or ') + ')');
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
        const filters = toArray(value as Document | Document[]);
        exprs.push('not (' + filters.map((c) => this.and(c)).join(' or ') + ')');
      } else if (field instanceof ComputedField) {
        exprs.push(this.expr(field, operator, value as Value | Value[]));
      } else if (this.having) {
        const lhs = this.having.fieldMap[name].expr;
        const rhs =
          typeof value === 'number' || typeof value === 'boolean'
            ? value
            : this.dialect.escape(value as string);
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

  private expr(field: SimpleField | ComputedField, operator: string | null, value: Value | Value[]) {
    const lhs =
      field instanceof ComputedField
        ? this.escapeId(field.name)
        : this.encodeField(field.column.name);
    if (Array.isArray(value)) {
      if (!operator || operator === 'in' || operator === 'notIn') {
        return this.listExpr(lhs, operator, value, (value) => this.escape(field, value));
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

  private listExpr(
    lhs: string,
    operator: string | null,
    values: Value[],
    escape: (value: Value) => string
  ): string {
    const escaped = values.filter((value) => value !== null).map((value) => escape(value));
    const not = operator === 'notIn' ? 'not ' : '';
    const or = operator === 'notIn' ? 'and' : 'or';
    if (escaped.length < values.length) {
      return escaped.length === 0
        ? `${lhs} is ${not}null`
        : `(${lhs} is ${not}null ${or} ${lhs} ${not}in (${escaped.join(', ')}))`;
    }
    if (escaped.length === 0) return 'false';
    return `${lhs} ${not}in (${escaped.join(', ')})`;
  }

  // Builds a filter expression for a JSON column. `obj` is a plain object whose
  // keys describe paths into the JSON document; `path` is the path accumulated
  // from enclosing objects.
  private jsonWhere(field: SimpleField, obj: Document, path: string[]): string {
    const exprs: string[] = [];
    for (const key in obj) {
      const value = obj[key];
      if (isPlainObject(value)) {
        const kind = this.classifyJsonObject(value as Document);
        if (kind === 'operator') {
          if (this.jsonOptions.operatorSyntax === 'suffix') {
            throw Error(`Explicit operators are disabled (operatorSyntax: 'suffix'): ${key}`);
          }
          const segs = this.jsonPath(path, key);
          for (const opKey in value as Document) {
            const token = opKey.slice(1);
            if (!this.isJsonOperator(token)) {
              throw Error(`Unknown JSON operator: ${opKey}`);
            }
            exprs.push(this.jsonLeaf(field, segs, token, (value as Document)[opKey] as Value | Value[]));
          }
          continue;
        }
        if (kind === 'mixed') {
          throw Error(`Mixed operators and fields in JSON filter: ${key}`);
        }
        // path descent
        const { name, operator } = this.jsonSplitKey(key);
        if (operator) {
          throw Error(`Operator '${operator}' cannot take an object value: ${key}`);
        }
        const sub = this.jsonWhere(field, value as Document, this.jsonPath(path, name));
        if (sub) exprs.push(sub);
        continue;
      }
      const { name, operator } = this.jsonSplitKey(key);
      exprs.push(this.jsonLeaf(field, this.jsonPath(path, name), operator, value as Value | Value[]));
    }
    return exprs.length === 0
      ? ''
      : exprs.length === 1
      ? exprs[0]
      : exprs.map((x) => `(${x})`).join(' and ');
  }

  // 'operator' = every key is $-prefixed, 'descent' = none are, 'mixed' = both.
  private classifyJsonObject(obj: Document): 'operator' | 'descent' | 'mixed' {
    let hasOperator = false;
    let hasField = false;
    for (const key in obj) {
      if (key[0] === '$') hasOperator = true;
      else hasField = true;
    }
    if (hasOperator && hasField) return 'mixed';
    return hasOperator ? 'operator' : 'descent';
  }

  // Splits a JSON object key into its literal path text and an operator token.
  // Unlike splitKey, a suffix is only stripped when it is a known operator, so
  // snake_case keys such as `first_name` stay literal.
  private jsonSplitKey(key: string): { name: string; operator: string | null } {
    if (this.jsonOptions.operatorSyntax === 'explicit') {
      return { name: key, operator: null };
    }
    const delimiter = this.jsonOptions.operatorDelimiter;
    const index = key.lastIndexOf(delimiter);
    if (index > 0) {
      const suffix = key.slice(index + delimiter.length);
      if (this.isJsonOperator(suffix)) {
        return { name: key.slice(0, index), operator: suffix };
      }
    }
    return { name: key, operator: null };
  }

  private isJsonOperator(token: string): boolean {
    return token in this.operatorMap || token === EQ || token === NULL || token === CONTAINS;
  }

  private jsonPath(path: string[], name: string): string[] {
    const segments = name.split('.');
    for (const segment of segments) {
      this.validateJsonSegment(segment);
    }
    return [...path, ...segments];
  }

  private validateJsonSegment(segment: string) {
    if (segment[0] === '$') {
      throw Error(`Reserved JSON key (starts with $): ${segment}`);
    }
    if (
      !/^[A-Za-z_][0-9A-Za-z_$]*$/.test(segment) &&
      !/^(0|[1-9][0-9]*)$/.test(segment)
    ) {
      throw Error(`Bad JSON path segment: ${segment}`);
    }
  }

  private jsonLeaf(
    field: SimpleField,
    path: string[],
    operator: string | null,
    value: Value | Value[]
  ): string {
    if (operator === CONTAINS) {
      return this.jsonContains(field, path, value as Value);
    }
    if (operator === NULL) {
      return this.jsonNull(field, path, !!value);
    }
    if (Array.isArray(value)) {
      const op = operator || IN;
      if (op !== IN && op !== NOT_IN) {
        throw Error(`Operator '${op}' cannot take an array value`);
      }
      const col = this.encodeField(field.column.name);
      const dialect = this.dialect.dialect;
      const nonNull = value.filter((v) => v !== null);
      // JSON booleans extract as 1/0 (sqlite), true/false (postgres ::boolean),
      // or 'true'/'false' text (mysql), so a boolean list needs typed handling.
      if (nonNull.length > 0 && nonNull.every((v) => typeof v === 'boolean')) {
        if (dialect === 'postgres') {
          const lhs = `(${this.jsonExtract(col, path, true)})::boolean`;
          return this.listExpr(lhs, op, value, (v) => (v ? 'true' : 'false'));
        }
        if (dialect === 'sqlite3') {
          const lhs = this.jsonExtract(col, path, false);
          return this.listExpr(lhs, op, value, (v) => (v ? '1' : '0'));
        }
        const lhs = this.jsonExtract(col, path, true);
        return this.listExpr(lhs, op, value, (v) => this.dialect.escape(v ? 'true' : 'false'));
      }
      // A purely numeric list compares against numeric extraction so SQLite,
      // whose json_extract is typed, matches. Otherwise compare as text.
      const numeric = nonNull.length > 0 && nonNull.every((v) => typeof v === 'number');
      const lhs =
        numeric && dialect === 'postgres'
          ? `(${this.jsonExtract(col, path, true)})::numeric`
          : this.jsonExtract(col, path, !numeric);
      return this.listExpr(lhs, op, value, (v) => this.escapeJsonScalar(v));
    }
    if (isPlainObject(value)) {
      throw Error(`Unsupported object value in JSON filter: ${path.join('.')}`);
    }

    const sqlOp = operator && operator !== EQ ? this.operatorMap[operator] || operator : '=';

    if (value === null && (sqlOp === '=' || sqlOp === '<>')) {
      return this.jsonNull(field, path, sqlOp === '=');
    }

    if (sqlOp === 'like' || sqlOp === 'ilike') {
      if (typeof value !== 'string') {
        throw Error(`Operator '${operator}' expects a string value`);
      }
    }

    return this.jsonCompare(field, path, sqlOp, value);
  }

  private jsonCompare(field: SimpleField, path: string[], sqlOp: string, value: Value): string {
    const col = this.encodeField(field.column.name);
    const dialect = this.dialect.dialect;
    const isLike = sqlOp === 'like' || sqlOp === 'ilike';

    if (typeof value === 'number' && !isLike) {
      const lhs =
        dialect === 'postgres'
          ? `(${this.jsonExtract(col, path, true)})::numeric`
          : this.jsonExtract(col, path, false);
      return `${lhs} ${sqlOp} ${value}`;
    }

    if (typeof value === 'boolean' && !isLike) {
      if (dialect === 'postgres') {
        return `(${this.jsonExtract(col, path, true)})::boolean ${sqlOp} ${value ? 'true' : 'false'}`;
      }
      if (dialect === 'sqlite3') {
        return `${this.jsonExtract(col, path, false)} ${sqlOp} ${value ? 1 : 0}`;
      }
      return `${this.jsonExtract(col, path, true)} ${sqlOp} ${this.dialect.escape(value ? 'true' : 'false')}`;
    }

    const lhs = this.jsonExtract(col, path, true);
    const rhs =
      value instanceof Date ? this.dialect.escapeDate(value) : this.dialect.escape(String(value));
    return `${lhs} ${sqlOp} ${rhs}`;
  }

  // JSON null or absent. When `isNull` is false, present and not JSON null.
  private jsonNull(field: SimpleField, path: string[], isNull: boolean): string {
    const col = this.encodeField(field.column.name);
    if (this.dialect.dialect === 'mysql') {
      const ex = this.jsonExtract(col, path, false);
      return isNull
        ? `(${ex} is null or json_type(${ex}) = 'NULL')`
        : `(${ex} is not null and json_type(${ex}) <> 'NULL')`;
    }
    const ex = this.jsonExtract(col, path, true);
    return isNull ? `${ex} is null` : `${ex} is not null`;
  }

  // The JSON value at `path` is an array containing the scalar `value`.
  private jsonContains(field: SimpleField, path: string[], value: Value): string {
    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
      throw Error(`Operator 'contains' expects a scalar value`);
    }
    const col = this.encodeField(field.column.name);
    const dialect = this.dialect.dialect;

    if (dialect === 'postgres') {
      const target = `(${this.jsonExtract(col, path, false)})::jsonb`;
      const literal = this.dialect.escape(JSON.stringify(value));
      return `${target} @> ${literal}::jsonb`;
    }
    if (dialect === 'mysql') {
      const jsonPath = this.dialect.escape(this.buildPathString(path));
      const candidate = this.dialect.escape(JSON.stringify(value));
      return `json_contains(${col}, ${candidate}, ${jsonPath})`;
    }
    if (dialect === 'sqlite3') {
      const jsonPath = this.dialect.escape(this.buildPathString(path));
      const condition =
        value === null
          ? 'value is null'
          : typeof value === 'boolean'
          ? `value = ${value ? 1 : 0}`
          : typeof value === 'number'
          ? `value = ${value}`
          : `value = ${this.dialect.escape(String(value))}`;
      return `exists (select 1 from json_each(${col}, ${jsonPath}) where ${condition})`;
    }
    throw Error(`JSON filtering is not supported for dialect: ${dialect}`);
  }

  private jsonExtract(columnSql: string, path: string[], asText: boolean): string {
    if (path.length === 0) {
      throw Error('Empty JSON path');
    }
    const dialect = this.dialect.dialect;
    if (dialect === 'postgres') {
      const array = 'array[' + path.map((segment) => this.dialect.escape(segment)).join(',') + ']';
      return `${columnSql} ${asText ? '#>>' : '#>'} ${array}`;
    }
    if (dialect === 'mysql' || dialect === 'sqlite3') {
      const jsonPath = this.dialect.escape(this.buildPathString(path));
      const extract = `json_extract(${columnSql}, ${jsonPath})`;
      return asText && dialect === 'mysql' ? `json_unquote(${extract})` : extract;
    }
    throw Error(`JSON filtering is not supported for dialect: ${dialect}`);
  }

  private buildPathString(path: string[]): string {
    let result = '$';
    for (const segment of path) {
      result += /^(0|[1-9][0-9]*)$/.test(segment) ? `[${segment}]` : `.${segment}`;
    }
    return result;
  }

  private escapeJsonScalar(value: Value): string {
    if (value === null) return 'null';
    if (typeof value === 'number') return String(value);
    if (value instanceof Date) return this.dialect.escapeDate(value);
    return this.dialect.escape(String(value));
  }

  _extendFilter(filter: Filter, orderBy: OrderBy): Filter {
    for (const entry of toArray(orderBy)) {
      const fields = entry.replace(/^-/, '').split('.');
      let result = filter as Document;
      let model: TableModel, start: number;
      if (this.model instanceof ViewModel) {
        model = this.model.model(fields[0])!;
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
          result = result[name] as Document;
          model = field.referencedField.model;
        }
      }
    }
    return filter;
  }

  _resolveField(fullpath: string, flat?: boolean): { column: string; alias?: string } {
    const aliasMap = this.context.aliasMap;
    let alias,
      field: Field | undefined,
      path = fullpath,
      model = this.model;

    if (this.model instanceof ViewModel) {
      const match = /^([^\.]+)\.(.+)$/.exec(fullpath);
      if (match && this.model.model(match[1])) {
        path = match[2];
        model = this.model.model(match[1])!;
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
        const name = this.context.fieldMap.add(path);
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
          extendByAst(this.model, filter as Document, ast);
        }
      } else {
        // { code: 'ID', user: { firstName: 'name' } }
        extendFilter(this.model, filter as Document, name as Document);
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
            const model = view.model(key)!;
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
          name = field!.name;
        }
        fields.push({ name, expr });
      });
    } else {
      const names = getFields(this.model, name, this.context.fieldMap);
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
        fieldMap: fields.reduce<{ [key: string]: (typeof fields)[number] }>((map, field) => {
          if (field.name !== undefined) {
            map[field.name] = field;
          }
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
      orderBy: orderBy ? (orderBy as string[]).join(', ') : undefined,
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
      filterThunk?: (builder: QueryBuilder) => string;
    }
  ): string {
    const query = this._select(
      Array.isArray(name) ? name.map((entry) => (raw ? parseFlat(entry) : parse(entry)!)) : name,
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
    if (keys.length === 1 && keys[0] === model.keyField()!.name) {
      if (isValue((args as Document)[keys[0]])) {
        return this.expr(field, null, (args as Document)[keys[0]] as Value);
      }
    }

    if (!builder.skipJoin) {
      const name = `${this.escapeId(model.table.name)} ${builder.alias}`;
      const lhs = this.encodeField(field);
      const rhs = builder.encodeField(field.referencedField.column.name);
      this.getFroms()!.push(`${name} on ${lhs}=${rhs}`);
    }

    return builder.where(args);
  }

  private _in(field: ForeignKeyField, args: Filter) {
    const builder = new QueryBuilder(this, field);
    const model = field.referencedField.model;
    const keys = Object.keys(args);
    if (keys.length === 1 && keys[0] === model.keyField()!.name) {
      return this.expr(field, null, (args as Document)[keys[0]] as Value);
    }
    const lhs = this.encodeField(field.column.name);
    const rhs = builder.select(model.keyField()!.column.name, { where: args });
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
    if (value && /date|time/i.test(field.column.type)) {
      return this.dialect.escapeDate(new Date(value as string));
    }
    if (value === null || value === undefined) {
      return 'null';
    }
    return this.dialect.escape(value + '');
  }

  private escapeId(name: string | SimpleField): string {
    if (name instanceof SimpleField) {
      name = name.column.name;
    }
    return this.dialect.escapeId(name);
  }

  splitKey(arg: string): string[] {
    const match = /^(.+?)_([^_]+)$/.exec(arg);
    if (match) {
      return [match[1], this.operatorMap[match[2]] || match[2]];
    }
    return [arg];
  }
}

export function encodeFilter(
  args: Filter,
  model: Model,
  escape: DialectEncoder,
  operatorMap?: OperatorMap,
  jsonOptions?: JsonFilterOptions
): string {
  const builder = new QueryBuilder(model, escape, operatorMap, jsonOptions);
  return builder.where(args);
}

export function plainify(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry !== undefined).map((entry) => plainify(entry));
  } else if (isValue(value)) {
    return value;
  } else if (value instanceof Record) {
    const model = value.__table.model;
    if (value.__primaryKey()) {
      return { [model.keyField()!.name]: value.__primaryKey() };
    } else {
      return getUniqueFields(model, value.__data);
    }
  } else {
    const result: { [key: string]: unknown } = {};
    const record = value as { [key: string]: unknown };
    for (const key in record) {
      result[key] = plainify(record[key]);
    }
    return result;
  }
}

function pkOnly(doc: Document | string, field: ForeignKeyField) {
  const model = field.referencedField.model;
  if (typeof doc === 'string') {
    return doc === model.keyField()!.name;
  }
  if (doc && !isValue(doc)) {
    const keys = Object.keys(doc);
    return keys.length === 1 && keys[0] === model.keyField()!.name;
  }
  return false;
}

// Extends the filter to include foreign key fields
function extendFilter(model: Model, filter: Document, fields: Document) {
  for (const name in fields) {
    const value = fields[name] === '*' ? {} : fields[name];
    if (value && typeof value === 'object') {
      const field = model.field(name);
      if (field instanceof ForeignKeyField) {
        if (!filter[name]) {
          filter[name] = {};
        }
        if (fields[name] === '*' || !pkOnly(value as Document, field)) {
          (filter[name] as Document)['*'] = true;
        }
        extendFilter(field.referencedField.model, filter[name] as Document, value as Document);
      }
    }
  }
}

// name: order.user.email
function extendByFieldName(model: Model, filter: Document, dotted: string) {
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
      (filter[name] as Document)['*'] = true;
    }
    extendByFieldName(field.referencedField.model, filter[name] as Document, doc);
  }
}

function extendByAst(model: Model, filter: Document, ast: AST) {
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

function getFields(model: Model, input: string | Document, fieldMap: FieldMap, prefix?: string): string[] {
  let result: string[] = [];

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
    const value = (input as Document)[name];

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
        fieldMap.add(key, value);
      }
    }
  }

  return result;
}

export class FieldMap {
  map2: {[key: string]: string } = {};
  map: {[key: string]: {alias?: string, path: string} } = {};
  count = 0;

  constructor(public prefix = '__f') {
  }

  add(path: string, alias?: string) {
    if (path in this.map2) {
      return this.map2[path];
    }
    let name: string;
    //if ( alias === undefined ) {
      this.count++;
      name = this.prefix + this.count;
   // }
   // else {
    //  name = alias;
    //}
    this.map[name] = { alias, path };
    this.map2[path] = name;
    return name;
  }

  get(name: string) {
    return this.map[name];
  }
}
