import { isDate } from 'util';
import { DialectEncoder } from './engine';
import { Value } from './types';

type LiteralToken = {
  kind: 'literal';
  text: string;
};

type VariableType =
  | 'bool'
  | 'integer'
  | 'float'
  | 'string'
  | 'identifier'
  | 'reserved'
  | 'date'
  | 'time'
  | 'datetime'
  | 'value'; // number, string, Date ...

const typeMap: { [key: string]: VariableType } = {
  b: 'bool',
  d: 'integer',
  f: 'float',
  s: 'string',
  i: 'identifier',
  r: 'reserved',
  D: 'date',
  t: 'time',
  T: 'datetime',
  '?': 'value',
};

type VariableToken = {
  kind: 'variable';
  key?: string;
  type: VariableType;
  array?: boolean;
};

type Token = LiteralToken | VariableToken;

const tokenised: { [key: string]: Token[] } = {};

export function tokenise(input: string): Token[] {
  if (input in tokenised) {
    return tokenised[input];
  }

  const result: Token[] = [];

  let token: LiteralToken | undefined;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];

    if (c !== '%') {
      if (token === undefined) {
        token = { kind: 'literal', text: c };
      } else {
        token.text += c;
      }
      continue;
    }

    if (token) {
      result.push(token);
      token = undefined;
    }

    if (i === input.length - 1) {
      result.push({ kind: 'literal', text: '%' });
      continue;
    }

    let next = input[++i];
    if (next === '%') {
      result.push({ kind: 'literal', text: '%' });
    } else if (next === '{') {
      const data = ['', ''];
      let index = 0;
      for (let j = i + 1; j < input.length; j++) {
        const char = input[j];
        if (char === '}') {
          i = j;
          break;
        }
        if (char === ':') {
          if (index > 0) {
            throw Error(`Invalid format: ${input.substring(i, j + 1)}`);
          }
          index = 1;
        } else {
          data[index] += char;
        }
      }
      if (input[i] !== '}') {
        throw Error(`Invalid format: ${input.substring(i)}`);
      }
      const key = data[0];
      let type: VariableType = 'value';
      let array: boolean | undefined;
      if (data[1][0] === 'a') {
        array = true;
        data[1] = data[1].substring(1);
      }
      if (data[1]) {
        type = parseVariableType(data[1]);
      }
      result.push({ kind: 'variable', key, type, array });
    } else {
      let array: boolean | undefined;
      let type: VariableType;

      if (next === 'a') {
        array = true;
        next = input[++i];
        if (!(next in typeMap)) {
          if (next && /[a-zA-Z]/.test(next)) {
            throw Error(`Unknown flag: ${next}`);
          }
          type = 'value';
          i--;
        } else {
          type = typeMap[next];
        }
      } else {
        type = parseVariableType(next);
      }
      result.push({ kind: 'variable', type, array });
    }
  }

  if (token) {
    result.push(token);
  }

  tokenised[input] = result;

  return result;
}

function parseVariableType(key: string) {
  if (!(key in typeMap)) {
    throw Error(`Unknown flag: ${key}`);
  }
  return typeMap[key];
}

const defaultEncoder: DialectEncoder = {
  dialect: 'postgres',
  escapeId: (s) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"',
  escape: (s) => `'${(s + '').replace(/'/g, "''")}'`,
  escapeDate: (d) => "'" + d.toISOString() + "'",
};

export default function sprintf(
  fmt: string,
  args?: Value[] | Value[][] | { [key: string]: Value | Value[] },
  encoder = defaultEncoder
) {
  if (!args || (Array.isArray(args) && args.length === 0) || Object.keys(args).length === 0) {
    return fmt;
  }

  const tokens = tokenise(fmt);
  const result = [];

  let next = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind === 'literal') {
      result.push(token.text);
    } else {
      const value: Value = token.key ? args[token.key] : args[next++];
      if (value === undefined) {
        throw Error(`Too few arguments for '${fmt}'`);
      }
      if (token.array) {
        if (!Array.isArray(value)) {
          throw Error(`Not an array: ${value}`);
        }
        result.push(value.map((val) => toString(token.type, val, encoder)).join(','));
      } else {
        result.push(toString(token.type, value, encoder));
      }
    }
  }
  return result.join('');
}

function toString(type: VariableType, value: Value, encoder: DialectEncoder) {
  switch (type) {
    case 'bool':
      return value ? 'true' : 'false';
    case 'integer':
      return String(parseInt(value as string));
    case 'float':
      return String(parseFloat(value as string));
    case 'string':
      return encoder.escape(value);
    case 'identifier':
      return encoder.escapeId(String(value));
    case 'reserved':
      return String(value);
    case 'date':
      return encoder.escapeDate(new Date(value as string)).replace(/[ T].+'/, "'");
    case 'time':
      return encoder.escapeDate(new Date(value as string)).replace(/'.+[ T]/, "'");
    case 'datetime':
      return encoder.escapeDate(new Date(value as string));
    case 'value':
      if (isDate(value)) {
        return encoder.escapeDate(value);
      } else if (value === undefined || value === null) {
        return 'null';
      } else if (typeof value === 'string') {
        return encoder.escape(value);
      } else {
        return String(value);
      }
    default:
      throw Error(`Unknown format: ${type}`);
  }
}
