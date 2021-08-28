import { rewrite, rewriteFlat } from '../src/parser/ast';
import { parse, parseFlat } from '../src/parser/index';

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
  test('flat', () => {
    const sql = `EXTRACT (day FROM TIMESTAMP '2001-02-16 20:38:40') AS "one day"`;
    const ast = parseFlat(sql, 'postgres');
    const isFieldName = (name:string) => name === 'oneday'
    const res = rewriteFlat(ast!, {
      name: (name) => isFieldName(name) ? `"${name}"` : name,
    });
    expect(res).toBe(`EXTRACT ( day FROM TIMESTAMP '2001-02-16 20:38:40' )`);
    expect(ast.alias).toBe('one day')
  });

});
