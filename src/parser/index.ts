import { FlatNode, Node, Statement } from './ast';
import { Dialect, isReserved } from './keywords';
import Lexer from './lexer';
import { NAME, Parser, RESERVED, YYEOF, YYPUSH_MORE, YYUNDEF } from './parser';

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
  while (true) {
    const type = lexer.lex();
    if (type === YYEOF) {
      break;
    }
    if (type === YYUNDEF) {
      throw Error(`Unknown token at ${lexer.cursor}`);
    }
    const text = lexer.yytext();
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
