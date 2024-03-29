import { isReserved } from './keywords';
import * as Token from './parser';

export type InfixOperator =
  | '+'
  | '-'
  | '*'
  | '/'
  | '='
  | '<>'
  | '<'
  | '<='
  | '>'
  | '>='
  | 'and'
  | 'or'
  | 'is';

export type PrefixOperator = '+' | '-' | 'not';

export enum Kind {
  INFIX,
  PREFIX,
  VALUE,
  NAME,
  FCALL,
  LIST,
  STAR, // count(*)
  FLAT,
}

export class Node {
  kind: Kind;
  brackets?: boolean; // honour the user's choice of using '(' and ')'
  alias?: string;
  constructor(kind: Kind) {
    this.kind = kind;
  }
}

export class InfixNode extends Node {
  op: InfixOperator;
  lhs: Node;
  rhs: Node;
  constructor(lhs: Node, op: InfixOperator, rhs: Node) {
    super(Kind.INFIX);
    this.op = op;
    this.lhs = lhs;
    this.rhs = rhs;
  }
}

export class PrefixNode extends Node {
  op: PrefixOperator;
  expr: Node;
  constructor(op: PrefixOperator, expr: Node) {
    super(Kind.PREFIX);
    this.op = op;
    this.expr = expr;
  }
}

export enum ValueType {
  LOGICAL,
  NUMBER,
  STRING,
  NULL,
}

export class ValueNode extends Node {
  type: ValueType;
  constructor(type: ValueType) {
    super(Kind.VALUE);
    this.type = type;
  }
}

export class LogicalValueNode extends ValueNode {
  value: boolean;
  constructor(value: boolean) {
    super(ValueType.LOGICAL);
    this.value = value;
  }
}

export class NumberValueNode extends ValueNode {
  value: number;
  constructor(value: number) {
    super(ValueType.NUMBER);
    this.value = value;
  }
}

export class StringValueNode extends ValueNode {
  value: string;
  constructor(value: string) {
    super(ValueType.STRING);
    this.value = value;
  }
}

export class NullValueNode extends ValueNode {
  constructor() {
    super(ValueType.NULL);
  }
}

export class StarNode extends Node {
  constructor() {
    super(Kind.STAR);
  }
}

export class NameNode extends Node {
  name: string;
  constructor(name: string) {
    super(Kind.NAME);
    this.name = name;
  }
}

export class FunctionCallNode extends Node {
  name: NameNode;
  args: ListNode;
  constructor(name: NameNode, args: ListNode) {
    super(Kind.FCALL);
    this.name = name;
    this.args = args;
  }
}

export class ListNode extends Node {
  list: Node[];
  constructor(node?: Node) {
    super(Kind.LIST);
    this.list = [];
    if (node !== undefined) {
      this.list.push(node);
    }
  }
  push(node: Node) {
    this.list.push(node);
  }
}

export class FlatNode extends Node {
  tokens: Array<{ type: number; text: string }>;

  constructor() {
    super(Kind.FLAT);
    this.tokens = [];
  }
}

export class Statement {
  node?: Node;
}

type Encoder = (s: string) => string;

export type RewriteOptions = {
  func?: Encoder;
  name: Encoder;
  text: Encoder;
};

function encodeValue(ast: ValueNode, encoder: (s: string) => string) {
  switch (ast.type) {
    case ValueType.LOGICAL:
      return (ast as LogicalValueNode).value ? 'true' : 'false';
    case ValueType.NUMBER:
      return (ast as NumberValueNode).value + '';
    case ValueType.STRING:
      return encoder((ast as StringValueNode).value);
    case ValueType.NULL:
      return 'null';
  }
}

export function visit(ast: Node, nameCb: (name: string) => void) {
  switch (ast.kind) {
    case Kind.NAME:
      nameCb((ast as NameNode).name);
      break;
    case Kind.INFIX:
      visit((ast as InfixNode).lhs, nameCb);
      visit((ast as InfixNode).rhs, nameCb);
      break;
    case Kind.FCALL:
      visit((ast as FunctionCallNode).args, nameCb);
      break;
    case Kind.LIST:
      (ast as ListNode).list.map((e) => visit(e, nameCb));
      break;
    case Kind.PREFIX:
      visit((ast as PrefixNode).expr, nameCb);
      break;
    case Kind.STAR:
    case Kind.VALUE:
      break;
    case Kind.FLAT:
      for (const token of (ast as FlatNode).tokens) {
        if (token.type === Token.NAME) {
          nameCb(token.text);
        }
      }
      break;
  }
}

export function rewrite(ast: Node, options: RewriteOptions) {
  let result: string;
  switch (ast.kind) {
    case Kind.NAME:
      result = options.name((ast as NameNode).name);
      break;
    case Kind.INFIX:
      result =
        rewrite((ast as InfixNode).lhs, options) +
        ' ' +
        (ast as InfixNode).op +
        ' ' +
        rewrite((ast as InfixNode).rhs, options);
      break;
    case Kind.FCALL:
      result =
        (options.func
          ? options.func((ast as FunctionCallNode).name.name)
          : (ast as FunctionCallNode).name.name) +
        '(' +
        rewrite((ast as FunctionCallNode).args, options) +
        ')';
      break;
    case Kind.LIST:
      result = (ast as ListNode).list.map((e) => rewrite(e, options)).join(',');
      break;
    case Kind.PREFIX:
      result =
        (ast as PrefixNode).op +
        ((ast as PrefixNode).op === 'not' ? ' ' : '') +
        rewrite((ast as PrefixNode).expr, options);
      break;
    case Kind.STAR:
      result = '*';
      break;
    case Kind.VALUE:
      result = encodeValue(ast as ValueNode, options.text);
      break;
    case Kind.FLAT:
      return rewriteFlat(ast as FlatNode, options);
  }
  return ast.brackets ? `(${result})` : result;
}

export function rewriteFlat(ast: FlatNode, options: { name: Encoder }) {
  const literals = [];
  for (const token of ast.tokens) {
    switch (token.type) {
      case Token.NAME:
        literals.push(options.name(token.text));
        break;
      default:
        literals.push(token.text);
    }
  }
  return literals.join(' ');
}
