import { rewrite } from '../src/parser/ast';
import { parse } from '../src/parser/index';

describe('rewrite', () => {
  test('expr', () => {
    const ast = parse(`length(order.user.email + 'foo')`);
    const res = rewrite(ast!, {
      name: (name) => `"${name}"`,
      func: (name) => name,
      text: (text) => `'${text}'`,
    });
    expect(res).toBe(`length("order.user.email" + 'foo')`);
  });
});
