type int = number;

export default class Position {
  line: int;
  column: int;

  constructor(line: number, column: number) {
    this.line = line;
    this.column = column;
  }

  equals(p: Position): boolean {
    return p.line == this.line && p.column == this.column;
  }

  toString(): String {
    return this.line + '.' + this.column;
  }
}
