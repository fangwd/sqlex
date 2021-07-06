import { parse } from '../src/parser/index';
import {
  FunctionCallNode,
  InfixNode,
  Kind,
  NameNode,
  NumberValueNode,
} from '../src/parser/ast';

test('expression', () => {
  const node = parse('(t1.column2.id + 2)*3') as InfixNode;
  expect(node.kind).toBe(Kind.INFIX);
  const expected = new InfixNode(
    new NameNode('t1.column2.id'),
    '+',
    new NumberValueNode(2)
  );
  expected.brackets = true;
  expect(node.lhs).toEqual(expected);
  expect(node.op).toBe('*');
  expect(node.rhs).toEqual(new NumberValueNode(3));
});

test('alias', () => {
  const node = parse('userName as name') as NameNode;
  expect(node.alias).toBe('name');
  expect(node.name).toBe('userName');
  expect(parse('userName name')).toEqual(node);
});

test('count(*)', () => {
  const node = parse('count(*)') as FunctionCallNode;
  expect(node.kind).toBe(Kind.FCALL);
  expect(node.name.name).toBe('count');
  expect(node.args.list.length).toBe(1);
  expect(node.args.list[0].kind).toBe(Kind.STAR);
});
