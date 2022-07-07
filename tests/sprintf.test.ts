import sprintf, { tokenise } from '../src/sprintf';

describe('tokeniser', () => {
  it('should parse empty strings', () => {
    expect(tokenise('').length).toBe(0);
  });

  it('should parse (empty) literals', () => {
    expect(tokenise('\n')).toEqual([
      {
        kind: 'literal',
        text: '\n',
      },
    ]);

    expect(tokenise('Hello" %')).toEqual([
      {
        kind: 'literal',
        text: 'Hello" ',
      },
      {
        kind: 'literal',
        text: '%',
      },
    ]);

    expect(tokenise('%% %')).toEqual([
      {
        kind: 'literal',
        text: '%',
      },
      {
        kind: 'literal',
        text: ' ',
      },
      {
        kind: 'literal',
        text: '%',
      },
    ]);
  });

  it('should parse variables', () => {
    expect(tokenise('%b%d%f%%%D%t%T')).toEqual([
      {
        kind: 'variable',
        type: 'bool',
      },
      {
        kind: 'variable',
        type: 'integer',
      },
      {
        kind: 'variable',
        type: 'float',
      },
      {
        kind: 'literal',
        text: '%',
      },
      {
        kind: 'variable',
        type: 'date',
      },
      {
        kind: 'variable',
        type: 'time',
      },
      {
        kind: 'variable',
        type: 'datetime',
      },
    ]);
  });

  it('should parse literals and variables', () => {
    expect(tokenise('insert into t1(d) values(%D);')).toEqual([
      {
        kind: 'literal',
        text: 'insert into t1(d) values(',
      },
      {
        kind: 'variable',
        type: 'date',
      },
      {
        kind: 'literal',
        text: ');',
      },
    ]);
  });

  it('should throw on unknown flag', () => {
    expect(() => tokenise('%@')).toThrow();
  });
});

describe('sprintf', () => {
  it('should print', () => {
    const d = '2022-07-06T12:39:00.000Z';
    const sql = sprintf('%b %d %f %s %D %t %T %i %r', [0, 1, 2, "'s", d, d, d, 'and', '1,2,3']);
    expect(sql).toBe(
      `false 1 2 '''s' '2022-07-06' '12:39:00.000Z' '2022-07-06T12:39:00.000Z' "and" 1,2,3`
    );
  });

  it('should print named args', () => {
    const d = '2022-07-06T12:39:00.000Z';
    const sql = sprintf('%{bool:b} %{date} %%{a} %{1:i};', {
      bool: 1,
      date: new Date(d),
      1: 'and',
      a: 2,
    });
    expect(sql).toBe(`true '2022-07-06T12:39:00.000Z' %{a} "and";`);
  });

  it('should treat format string as raw sql when no args are provided', () => {
    const fmt = 'select * from t1 where d like %A';
    expect(sprintf(fmt)).toBe(fmt);
    expect(sprintf(fmt, [])).toBe(fmt);
  });

  it('should handle array type', () => {
    expect(sprintf('in (%ad)', [[1, 2, 3]])).toBe('in (1,2,3)');
    expect(sprintf('in (%a)', [[1, 2, 3]])).toBe('in (1,2,3)');
    expect(() => sprintf('in (%aa)', [[1, 2, 3]])).toThrow();
    expect(sprintf('in (%{date:aD})', { date: ['2022-07-06', '2022-07-07'] })).toBe(
      `in ('2022-07-06','2022-07-07')`
    );
    expect(sprintf('in (%{date:a})', { date: ['2022-07-06', '2022-07-07'] })).toBe(
      `in ('2022-07-06','2022-07-07')`
    );
  });

  it('should handle any type', () => {
    expect(sprintf('in (%a?)', [[1, 2, 3]])).toBe('in (1,2,3)');
    expect(sprintf('in (%?)', ['123'])).toBe("in ('123')");
  });

  it('should throw on insufficient arguments', () => {
    expect(() => sprintf('%b %d', [0])).toThrow();
  });
});
