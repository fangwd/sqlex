import sprintf, { tokenise } from '../src/sprintf';

const literal = (text: string) => ({ type: 'literal', text });
const variable = (name?: string) => ({ type: 'variable', name });
const space = literal(' ');

describe('tokeniser', () => {
  it('should handle empty strings', () => {
    expect(tokenise('').length).toBe(0);
  });

  it('should handle escaped ? and :', () => {
    expect(tokenise('\\:\\?')).toEqual([literal(':'), literal('?')]);
    expect(tokenise('\\:name')).toEqual([literal(':'), literal('name')]);
  });

  it('should handle ?', () => {
    expect(tokenise('?')).toEqual([variable()]);
  });

  it('should handle :', () => {
    expect(tokenise(':id')).toEqual([variable('id')]);
    expect(() => tokenise(': id')).toThrow();
  });

  it('should handle strings', () => {
    expect(tokenise(`''`)).toEqual([literal(`''`)]);
    expect(tokenise(`'\\'`)).toEqual([literal(`'\\'`)]);
    expect(tokenise(`'1'`)).toEqual([literal(`'1'`)]);
    expect(tokenise(`'1\\'`)).toEqual([literal(`'1\\'`)]);
    expect(tokenise(`'joe\\'s' 'joe''s' '''' '\\''`)).toEqual([
      literal(`'joe\\'s'`),
      space,
      literal(`'joe''s'`),
      space,
      literal(`''''`),
      space,
      literal(`'\\''`),
    ]);
    expect(tokenise(`1'joe'`)).toEqual([literal('1'), literal(`'joe'`)]);
    expect(tokenise(`1'joe`)).toEqual([literal('1'), literal(`'joe`)]);
    expect(tokenise(`'joe\\`)).toEqual([literal(`'joe\\`)]);
    expect(tokenise(`'joe'2`)).toEqual([literal(`'joe'`), literal('2')]);
    expect(tokenise(`\\'joe\\`)).toEqual([literal('\\'), literal(`'joe\\`)]);
    expect(tokenise(`\\'joe'2`)).toEqual([literal('\\'), literal(`'joe'`), literal(`2`)]);
    expect(tokenise(`\\'joe'2'`)).toEqual([
      literal('\\'),
      literal(`'joe'`),
      literal(`2`),
      literal("'"),
    ]);
    expect(tokenise(`1'joe\\'2`)).toEqual([literal('1'), literal(`'joe\\'2`)]);
  });

  it('should handle spaces', () => {
    expect(tokenise(' \n')).toEqual([space]);
  });

  it('should handle names', () => {
    expect(tokenise('name')).toEqual([literal('name')]);
  });

  it('should handle special chars', () => {
    expect(tokenise('+/\\\\x')).toEqual([literal('+/'), literal('\\\\x')]);
  });

  it('should handle mixed strings (1)', () => {
    expect(tokenise('1e+3 - \\ ?id:key')).toEqual([
      literal('1e+3'),
      space,
      literal('-'),
      space,
      literal('\\'),
      space,
      variable(),
      literal('id'),
      variable('key'),
    ]);
  });
});

describe('sprintf', () => {
  it('should handle list arguments', () => {
    expect(sprintf('name like  ? and age > ?', ['%joe', 20])).toBe(`name like '%joe' and age > 20`);
    expect(sprintf('? in (?)', [1, [2, 3]])).toBe(`1 in (2, 3)`);
  });

  it('should handle object arguments', () => {
    expect(sprintf(':name and :range', { name: 'joe', range: [1, 2] })).toBe(`'joe' and 1, 2`);
  });

  it('should throw on insufficient arguments', () => {
    expect(() => sprintf('? ?', [0])).toThrow();
    expect(() => sprintf(':key :value', { key: 1 })).toThrow();
  });
});
