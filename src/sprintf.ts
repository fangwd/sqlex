import { isDate } from 'util';
import { DialectEncoder } from './engine';
import { Value } from './types';

type LiteralToken = {
  type: 'literal';
  text: string;
};

type VariableToken = {
  type: 'variable';
  name?: string;
};

type Token = LiteralToken | VariableToken;

const tokenised: { [key: string]: Token[] } = {};

export function tokenise(input: string): Token[] {
  if (input in tokenised) {
    return tokenised[input];
  }

  const tokens: Token[] = [];

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '\\') {
      // '\?' -> '?', '\:' -> ':'
      const d = input[i + 1];
      if (d === '?' || d === ':') {
        tokens.push({ type: 'literal', text: d });
        i++;
      } else {
        let text = c;
        for (let j = i + 1; ; j++) {
          const e = input[j];
          if (/[\s'"`?:]/.test(e) || j === input.length) {
            i = j - 1;
            break;
          } else {
            text += e;
          }
        }
        tokens.push({ type: 'literal', text });
      }
    } else if (c === '?') {
      tokens.push({ type: 'variable' });
    } else if (c === ':') {
      let name = '';
      for (let j = i + 1; ; j++) {
        if (j === input.length) {
          i = j - 1;
          break;
        }
        const d = input[j];
        if (/\w/.test(d)) {
          name += d;
        } else {
          i = j - 1;
          break;
        }
      }
      if (name.length === 0) {
        throw Error(`Missing name (near '${input.substring(i, 10)}')`);
      }
      tokens.push({ type: 'variable', name });
    } else if (c === "'" || c === '"' || c === '`') {
      // 'joe\'s' 'joe''s' 'joes'
      let text = c;
      let last = c;
      for (let j = i + 1; j < input.length; j++) {
        const d = input[j];
        text += d;
        if (d === c) {
          if (last !== '\\') {
            const e = input[j + 1];
            if (e === c) {
              text += e;
              j++;
            } else {
              i = j;
              break;
            }
          }
        }
        if (j === input.length - 1) {
          i = j;
        }
        else {
          last = d;
        }
      }
      tokens.push({ type: 'literal', text });
    } else if (/\s/.test(c)) {
      tokens.push({ type: 'literal', text: ' ' });
      for (let j = i + 1; ; j++) {
        if (!/\s/.test(input[j]) || j === input.length) {
          i = j - 1;
          break;
        }
      }
    } else {
      let text = c;
      for (let j = i + 1; ; j++) {
        const d = input[j];
        if (/[\s\\'"`?:]/.test(d) || j === input.length) {
          i = j - 1;
          break;
        } else {
          text += d;
        }
      }
      tokens.push({ type: 'literal', text });
    }
  }

  tokenised[input] = tokens;

  return tokens;
}

const defaultEncoder: DialectEncoder = {
  dialect: 'postgres',
  escapeId: (s) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"',
  escape: (s) => `'${(s + '').replace(/'/g, "''")}'`,
  escapeDate: (d) => "'" + d.toISOString() + "'",
};

export type ArgType = Value | (Value | Value[])[] | { [key: string]: Value | Value[] };

export default function sprintf(
  fmt: string,
  args?: ArgType,
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
    if (token.type === 'literal') {
      result.push(token.text);
    } else {
      const key = token.name ? token.name : next++;
      const value: Value = args[key];
      if (value === undefined) {
        throw Error(`Missing argument ${key}`);
      }
      result.push(toString(value, encoder));
    }
  }
  return result.join('');
}

function toString(value: Value, encoder: DialectEncoder) {
  if (Array.isArray(value)) {
    return value.map((entry) => toString(entry, encoder)).join(', ');
  }
  if (isDate(value)) {
    return encoder.escapeDate(value);
  } else if (value === undefined || value === null) {
    return 'null';
  } else if (typeof value === 'string') {
    return encoder.escape(value);
  } else {
    return String(value);
  }
}
