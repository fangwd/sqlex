import { FlatNode, NameNode, Node, Statement } from './ast';
import { Dialect, isReserved } from './keywords';
import Lexer from './lexer';
import {
  AS,
  NAME,
  Parser,
  RESERVED,
  YYEOF,
  YYPUSH_MORE,
  YYUNDEF,
} from './parser';

export function parse(formula: string): Node | undefined {
  const lexer = new Lexer(formula);
  const result: Statement = {};
  const parser = new Parser(lexer, result);
  do {
    const token = lexer.lex();
    const yyloc = lexer.getLocation();
    if (parser.push_parse(token, lexer.value!, yyloc) !== YYPUSH_MORE) {
      return token === YYEOF ? result.node : undefined;
    }
  } while (true);
}

export function parseFlat(formula: string, dialect?: Dialect): FlatNode {
  const lexer = new Lexer(formula);
  const node = new FlatNode();
  const tokens = [];
  while (true) {
    const type = lexer.lex();
    if (type === YYEOF) {
      break;
    }
    if (type === YYUNDEF) {
      throw Error(`Unknown token at ${lexer.cursor}`);
    }
    const text = lexer.yytext();
    tokens.push({
      type,
      text,
      value: lexer.value,
    });
  }

  const length = tokens.length;
  let ignore = 0;
  if (length > 2) {
    if (tokens[length - 2].type === AS) {
      const last = tokens[length - 1].value;
      if (last instanceof NameNode) {
        node.alias = last.name;
        ignore = 2;
      }
    }
  }

  for (let i = 0; i < length - ignore; i++) {
    const { type, text } = tokens[i];
    if (type === NAME) {
      const upper = text.toUpperCase();
      if (isReserved(upper, dialect)) {
        node.tokens.push({ type: RESERVED, text: upper });
      } else {
        node.tokens.push({ type, text });
      }
    } else {
      node.tokens.push({ type, text });
    }
  }

  return node;
}

export { Lexer, Parser, Node, Statement };
