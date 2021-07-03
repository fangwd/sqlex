import Lexer from '../src/parser/lexer';
import {
  Expression,
  FunctionCallNode,
  InfixNode,
  Kind,
  NameNode,
  Node,
  NumberValueNode,
} from '../src/parser/ast';
import { Parser, YYEOF, YYPUSH_MORE } from '../src/parser/parser';

function parse(formula: string): Node | undefined {
  const lexer = new Lexer(formula);
  const result: Expression = {};
  const parser = new Parser(lexer, result);
  do {
    const token = lexer.lex();
    const yyloc = lexer.getLocation();
    if (parser.push_parse(token, lexer.value!, yyloc) !== YYPUSH_MORE) {
      return token === YYEOF ? result.node : undefined;
    }
  } while (true);
}

test('expression', () => {
  const node = parse('(t1.column2.id + 2)*3') as InfixNode;
  expect(node.kind).toBe(Kind.INFIX);
  expect(node.lhs).toEqual(
    new InfixNode(new NameNode('t1.column2.id'), '+', new NumberValueNode(2))
  );
  expect(node.op).toBe('*');
  expect(node.rhs).toEqual(new NumberValueNode(3));
});

test('count(*)', () => {
  const node = parse('count(*)') as FunctionCallNode;
  expect(node.kind).toBe(Kind.FCALL);
  expect(node.name.name).toBe('count');
  expect(node.args.list.length).toBe(1);
  expect(node.args.list[0].kind).toBe(Kind.STAR);
});
