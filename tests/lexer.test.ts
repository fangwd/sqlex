import * as Token from '../src/parser/parser';
import {
  LogicalValueNode,
  NumberValueNode,
  StringValueNode,
  NameNode,
} from '../src/parser/ast';

import Lexer from '../src/parser/lexer';

test('symbols', () => {
  const text = '( ) * + , - / < = > <= <> >=';
  const lexer = new Lexer(text);
  expect(lexer.lex()).toBe(Token.LPAREN);
  expect(lexer.lex()).toBe(Token.RPAREN);
  expect(lexer.lex()).toBe(Token.MUL);
  expect(lexer.lex()).toBe(Token.PLUS);
  expect(lexer.lex()).toBe(Token.COMMA);
  expect(lexer.lex()).toBe(Token.MINUS);
  expect(lexer.lex()).toBe(Token.DIV);
  expect(lexer.lex()).toBe(Token.LT);
  expect(lexer.lex()).toBe(Token.EQ);
  expect(lexer.lex()).toBe(Token.GT);
  expect(lexer.lex()).toBe(Token.LE);
  expect(lexer.lex()).toBe(Token.NE);
  expect(lexer.lex()).toBe(Token.GE);
  expect(lexer.lex()).toBe(Token.YYEOF);
});

test('keywords', () => {
  const text = 'True False and or as';
  const lexer = new Lexer(text);
  expect(lexer.lex()).toBe(Token.LOGICAL);
  expect(lexer.value).toEqual(new LogicalValueNode(true));
  expect(lexer.lex()).toBe(Token.LOGICAL);
  expect(lexer.value).toEqual(new LogicalValueNode(false));
  expect(lexer.lex()).toBe(Token.AND);
  expect(lexer.lex()).toBe(Token.OR);
  expect(lexer.lex()).toBe(Token.AS);
});

test('number', () => {
  //            0 2   6   10    16   21    27     34     41
  const text = '0 123 .12 12.12 0.12 .12E0 .12e-0 .12e10 .12E-10';
  const lexer = new Lexer(text);

  expect(lexer.lex()).toBe(Token.NUMBER);
  expect(lexer.value).toEqual(new NumberValueNode(0));

  expect(lexer.lex()).toBe(Token.NUMBER);
  expect(lexer.value).toEqual(new NumberValueNode(123));

  expect(lexer.lex()).toBe(Token.NUMBER);
  expect(lexer.value).toEqual(new NumberValueNode(0.12));

  expect(lexer.lex()).toBe(Token.NUMBER);
  expect(lexer.value).toEqual(new NumberValueNode(12.12));

  expect(lexer.lex()).toBe(Token.NUMBER);
  expect(lexer.value).toEqual(new NumberValueNode(0.12));

  expect(lexer.lex()).toBe(Token.NUMBER);
  expect(lexer.value).toEqual(new NumberValueNode(0.12));

  expect(lexer.lex()).toBe(Token.NUMBER);
  expect(lexer.value).toEqual(new NumberValueNode(0.12));

  expect(lexer.lex()).toBe(Token.NUMBER);
  expect(lexer.value).toEqual(new NumberValueNode(0.12e10));

  expect(lexer.lex()).toBe(Token.NUMBER);
  expect(lexer.value).toEqual(new NumberValueNode(0.12e-10));

  expect(lexer.lex()).toBe(Token.YYEOF);
});

test('string', () => {
  const text = "'' 'a''b' '''中文''!' '";
  const lexer = new Lexer(text);

  expect(lexer.lex()).toBe(Token.STRING);
  expect(lexer.value).toEqual(new StringValueNode(''));

  expect(lexer.lex()).toBe(Token.STRING);
  expect(lexer.value).toEqual(new StringValueNode("a'b"));

  expect(lexer.lex()).toBe(Token.STRING);
  expect(lexer.value).toEqual(new StringValueNode("'中文'!"));

  expect(lexer.lex()).toBe(Token.YYUNDEF);
});

test('name', () => {
  const text = 'name 中文.1 special _第2 `foo bar` "blah blah"';
  const lexer = new Lexer(text);

  expect(lexer.lex()).toBe(Token.NAME);
  expect(lexer.value).toEqual(new NameNode('name'));

  expect(lexer.lex()).toBe(Token.NAME);
  expect(lexer.value).toEqual(new NameNode('中文.1'));

  expect(lexer.lex()).toBe(Token.NAME);
  expect(lexer.value).toEqual(new NameNode('special'));

  expect(lexer.lex()).toBe(Token.NAME);
  expect(lexer.value).toEqual(new NameNode('_第2'));

  expect(lexer.lex()).toBe(Token.NAME);
  expect(lexer.value).toEqual(new NameNode('foo bar'));

  expect(lexer.lex()).toBe(Token.NAME);
  expect(lexer.value).toEqual(new NameNode('blah blah'));
});
