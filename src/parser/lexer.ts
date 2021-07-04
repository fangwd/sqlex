import * as ast from './ast';
import * as Token from './parser';
import Position from './position';

export default class Lexer implements Token.Lexer {
  source: string;
  cursor: number;
  token: number;

  value: ast.Node | undefined;

  constructor(source: string) {
    this.source = source;
    this.cursor = 0;
    this.token = -1;
  }

  lex(): number {
    let state = 1;
    let marker = this.cursor;
    let yych = '';
    let yyaccept = 0;

    this.token = this.cursor;

    while (1) {
      switch (state) {
        case 1 /*var yych*/:
          yyaccept = 0;
          yych = this.charAt(this.cursor);
          switch (yych) {
            case String.fromCharCode(0x0000):
            case String.fromCharCode(0x0001):
            case String.fromCharCode(0x0002):
            case String.fromCharCode(0x0003):
            case String.fromCharCode(0x0004):
            case String.fromCharCode(0x0005):
            case String.fromCharCode(0x0006):
            case String.fromCharCode(0x0007):
            case String.fromCharCode(0x0008):
            case '\f':
            case String.fromCharCode(0x000e):
            case String.fromCharCode(0x000f):
            case String.fromCharCode(0x0010):
            case String.fromCharCode(0x0011):
            case String.fromCharCode(0x0012):
            case String.fromCharCode(0x0013):
            case String.fromCharCode(0x0014):
            case String.fromCharCode(0x0015):
            case String.fromCharCode(0x0016):
            case String.fromCharCode(0x0017):
            case String.fromCharCode(0x0018):
            case String.fromCharCode(0x0019):
            case String.fromCharCode(0x001a):
            case String.fromCharCode(0x001b):
            case String.fromCharCode(0x001c):
            case String.fromCharCode(0x001d):
            case String.fromCharCode(0x001e):
            case String.fromCharCode(0x001f):
            case '!':
            case '"':
            case '#':
            case '$':
            case '%':
            case '&':
            case ':':
            case ';':
            case '?':
            case '@':
            case '[':
            case ']':
            case '^':
            case '`':
            case '{':
            case '|':
            case '}':
            case '~':
            case String.fromCharCode(0x007f): {
              state = 2;
              continue;
            }
            case '\t':
            case '\n':
            case '\v':
            case '\r':
            case ' ': {
              state = 4;
              continue;
            }
            case "'": {
              state = 7;
              continue;
            }
            case '(': {
              state = 8;
              continue;
            }
            case ')': {
              state = 10;
              continue;
            }
            case '*': {
              state = 12;
              continue;
            }
            case '+': {
              state = 14;
              continue;
            }
            case ',': {
              state = 16;
              continue;
            }
            case '-': {
              state = 18;
              continue;
            }
            case '.': {
              state = 20;
              continue;
            }
            case '/': {
              state = 21;
              continue;
            }
            case '0':
            case '1':
            case '2':
            case '3':
            case '4':
            case '5':
            case '6':
            case '7':
            case '8':
            case '9': {
              state = 23;
              continue;
            }
            case '<': {
              state = 26;
              continue;
            }
            case '=': {
              state = 28;
              continue;
            }
            case '>': {
              state = 30;
              continue;
            }
            case 'A':
            case 'a': {
              state = 32;
              continue;
            }
            case 'F':
            case 'f': {
              state = 36;
              continue;
            }
            case 'O':
            case 'o': {
              state = 37;
              continue;
            }
            case 'T':
            case 't': {
              state = 38;
              continue;
            }
            default: {
              state = 34;
              continue;
            }
          }
        case 2:
          ++this.cursor;
        case 3: {
          if (this.token >= this.source.length) return Token.YYEOF;
          return Token.YYUNDEF;
        }
        case 4:
          yych = this.charAt(++this.cursor);
          if (yych <= '\f') {
            if (yych <= String.fromCharCode(0x0008)) {
              state = 6;
              continue;
            }
            if (yych <= '\v') {
              state = 4;
              continue;
            }
          } else {
            if (yych <= '\r') {
              state = 4;
              continue;
            }
            if (yych == ' ') {
              state = 4;
              continue;
            }
          }
        case 6: {
          this.token = this.cursor;
          state = 1;
          continue;
          continue;
        }
        case 7:
          yyaccept = 0;
          yych = this.charAt((marker = ++this.cursor));
          if (yych <= String.fromCharCode(0x0000)) {
            state = 3;
            continue;
          }
          {
            state = 40;
            continue;
          }
        case 8:
          ++this.cursor;
          {
            return Token.LPAREN;
          }
        case 10:
          ++this.cursor;
          {
            return Token.RPAREN;
          }
        case 12:
          ++this.cursor;
          {
            return Token.MUL;
          }
        case 14:
          ++this.cursor;
          {
            return Token.PLUS;
          }
        case 16:
          ++this.cursor;
          {
            return Token.COMMA;
          }
        case 18:
          ++this.cursor;
          {
            return Token.MINUS;
          }
        case 20:
          yych = this.charAt(++this.cursor);
          if (yych <= '/') {
            state = 3;
            continue;
          }
          if (yych <= '9') {
            state = 44;
            continue;
          }
          {
            state = 3;
            continue;
          }
        case 21:
          ++this.cursor;
          {
            return Token.DIV;
          }
        case 23:
          yyaccept = 1;
          yych = this.charAt((marker = ++this.cursor));
          if (yych == '.') {
            state = 46;
            continue;
          }
          if (yych <= '/') {
            state = 25;
            continue;
          }
          if (yych <= '9') {
            state = 23;
            continue;
          }
        case 25: {
          return this._number();
        }
        case 26:
          yych = this.charAt(++this.cursor);
          if (yych <= '<') {
            state = 27;
            continue;
          }
          if (yych <= '=') {
            state = 47;
            continue;
          }
          if (yych <= '>') {
            state = 49;
            continue;
          }
        case 27: {
          return Token.LT;
        }
        case 28:
          ++this.cursor;
          {
            return Token.EQ;
          }
        case 30:
          yych = this.charAt(++this.cursor);
          if (yych == '=') {
            state = 51;
            continue;
          }
          {
            return Token.GT;
          }
        case 32:
          yych = this.charAt(++this.cursor);
          if (yych <= 'S') {
            if (yych == 'N') {
              state = 53;
              continue;
            }
            if (yych <= 'R') {
              state = 35;
              continue;
            }
            {
              state = 54;
              continue;
            }
          } else {
            if (yych <= 'n') {
              if (yych <= 'm') {
                state = 35;
                continue;
              }
              {
                state = 53;
                continue;
              }
            } else {
              if (yych == 's') {
                state = 54;
                continue;
              }
              {
                state = 35;
                continue;
              }
            }
          }
        case 33: {
          return this._name();
        }
        case 34:
          yych = this.charAt(++this.cursor);
        case 35:
          if (yych <= 'Z') {
            if (yych <= '9') {
              if (yych == '.') {
                state = 34;
                continue;
              }
              if (yych <= '/') {
                state = 33;
                continue;
              }
              {
                state = 34;
                continue;
              }
            } else {
              if (yych == '?') {
                state = 34;
                continue;
              }
              if (yych <= '@') {
                state = 33;
                continue;
              }
              {
                state = 34;
                continue;
              }
            }
          } else {
            if (yych <= '_') {
              if (yych == '\\') {
                state = 34;
                continue;
              }
              if (yych <= '^') {
                state = 33;
                continue;
              }
              {
                state = 34;
                continue;
              }
            } else {
              if (yych <= '`') {
                state = 33;
                continue;
              }
              if (yych <= 'z') {
                state = 34;
                continue;
              }
              if (yych <= String.fromCharCode(0x007f)) {
                state = 33;
                continue;
              }
              {
                state = 34;
                continue;
              }
            }
          }
        case 36:
          yych = this.charAt(++this.cursor);
          if (yych == 'A') {
            state = 56;
            continue;
          }
          if (yych == 'a') {
            state = 56;
            continue;
          }
          {
            state = 35;
            continue;
          }
        case 37:
          yych = this.charAt(++this.cursor);
          if (yych == 'R') {
            state = 57;
            continue;
          }
          if (yych == 'r') {
            state = 57;
            continue;
          }
          {
            state = 35;
            continue;
          }
        case 38:
          yych = this.charAt(++this.cursor);
          if (yych == 'R') {
            state = 59;
            continue;
          }
          if (yych == 'r') {
            state = 59;
            continue;
          }
          {
            state = 35;
            continue;
          }
        case 39:
          yych = this.charAt(++this.cursor);
        case 40:
          if (yych <= String.fromCharCode(0x0000)) {
            state = 41;
            continue;
          }
          if (yych == "'") {
            state = 42;
            continue;
          }
          {
            state = 39;
            continue;
          }
        case 41:
          this.cursor = marker;
          if (yyaccept <= 1) {
            if (yyaccept == 0) {
              {
                state = 3;
                continue;
              }
            } else {
              {
                state = 25;
                continue;
              }
            }
          } else {
            {
              state = 43;
              continue;
            }
          }
        case 42:
          yyaccept = 2;
          yych = this.charAt((marker = ++this.cursor));
          if (yych == "'") {
            state = 39;
            continue;
          }
        case 43: {
          return this._string();
        }
        case 44:
          yyaccept = 1;
          yych = this.charAt((marker = ++this.cursor));
          if (yych <= 'D') {
            if (yych <= '/') {
              state = 25;
              continue;
            }
            if (yych <= '9') {
              state = 44;
              continue;
            }
            {
              state = 25;
              continue;
            }
          } else {
            if (yych <= 'E') {
              state = 60;
              continue;
            }
            if (yych == 'e') {
              state = 60;
              continue;
            }
            {
              state = 25;
              continue;
            }
          }
        case 46:
          yych = this.charAt(++this.cursor);
          if (yych <= '/') {
            state = 41;
            continue;
          }
          if (yych <= '9') {
            state = 44;
            continue;
          }
          {
            state = 41;
            continue;
          }
        case 47:
          ++this.cursor;
          {
            return Token.LE;
          }
        case 49:
          ++this.cursor;
          {
            return Token.NE;
          }
        case 51:
          ++this.cursor;
          {
            return Token.GE;
          }
        case 53:
          yych = this.charAt(++this.cursor);
          if (yych == 'D') {
            state = 61;
            continue;
          }
          if (yych == 'd') {
            state = 61;
            continue;
          }
          {
            state = 35;
            continue;
          }
        case 54:
          yych = this.charAt(++this.cursor);
          if (yych <= 'Z') {
            if (yych <= '9') {
              if (yych == '.') {
                state = 34;
                continue;
              }
              if (yych >= '0') {
                state = 34;
                continue;
              }
            } else {
              if (yych == '?') {
                state = 34;
                continue;
              }
              if (yych >= 'A') {
                state = 34;
                continue;
              }
            }
          } else {
            if (yych <= '_') {
              if (yych == '\\') {
                state = 34;
                continue;
              }
              if (yych >= '_') {
                state = 34;
                continue;
              }
            } else {
              if (yych <= '`') {
                state = 55;
                continue;
              }
              if (yych <= 'z') {
                state = 34;
                continue;
              }
              if (yych >= String.fromCharCode(0x0080)) {
                state = 34;
                continue;
              }
            }
          }
        case 55: {
          return Token.AS;
        }
        case 56:
          yych = this.charAt(++this.cursor);
          if (yych == 'L') {
            state = 63;
            continue;
          }
          if (yych == 'l') {
            state = 63;
            continue;
          }
          {
            state = 35;
            continue;
          }
        case 57:
          yych = this.charAt(++this.cursor);
          if (yych <= 'Z') {
            if (yych <= '9') {
              if (yych == '.') {
                state = 34;
                continue;
              }
              if (yych >= '0') {
                state = 34;
                continue;
              }
            } else {
              if (yych == '?') {
                state = 34;
                continue;
              }
              if (yych >= 'A') {
                state = 34;
                continue;
              }
            }
          } else {
            if (yych <= '_') {
              if (yych == '\\') {
                state = 34;
                continue;
              }
              if (yych >= '_') {
                state = 34;
                continue;
              }
            } else {
              if (yych <= '`') {
                state = 58;
                continue;
              }
              if (yych <= 'z') {
                state = 34;
                continue;
              }
              if (yych >= String.fromCharCode(0x0080)) {
                state = 34;
                continue;
              }
            }
          }
        case 58: {
          return Token.OR;
        }
        case 59:
          yych = this.charAt(++this.cursor);
          if (yych == 'U') {
            state = 64;
            continue;
          }
          if (yych == 'u') {
            state = 64;
            continue;
          }
          {
            state = 35;
            continue;
          }
        case 60:
          yych = this.charAt(++this.cursor);
          if (yych <= ',') {
            if (yych == '+') {
              state = 65;
              continue;
            }
            {
              state = 41;
              continue;
            }
          } else {
            if (yych <= '-') {
              state = 65;
              continue;
            }
            if (yych <= '/') {
              state = 41;
              continue;
            }
            if (yych <= '9') {
              state = 66;
              continue;
            }
            {
              state = 41;
              continue;
            }
          }
        case 61:
          yych = this.charAt(++this.cursor);
          if (yych <= 'Z') {
            if (yych <= '9') {
              if (yych == '.') {
                state = 34;
                continue;
              }
              if (yych >= '0') {
                state = 34;
                continue;
              }
            } else {
              if (yych == '?') {
                state = 34;
                continue;
              }
              if (yych >= 'A') {
                state = 34;
                continue;
              }
            }
          } else {
            if (yych <= '_') {
              if (yych == '\\') {
                state = 34;
                continue;
              }
              if (yych >= '_') {
                state = 34;
                continue;
              }
            } else {
              if (yych <= '`') {
                state = 62;
                continue;
              }
              if (yych <= 'z') {
                state = 34;
                continue;
              }
              if (yych >= String.fromCharCode(0x0080)) {
                state = 34;
                continue;
              }
            }
          }
        case 62: {
          return Token.AND;
        }
        case 63:
          yych = this.charAt(++this.cursor);
          if (yych == 'S') {
            state = 68;
            continue;
          }
          if (yych == 's') {
            state = 68;
            continue;
          }
          {
            state = 35;
            continue;
          }
        case 64:
          yych = this.charAt(++this.cursor);
          if (yych == 'E') {
            state = 69;
            continue;
          }
          if (yych == 'e') {
            state = 69;
            continue;
          }
          {
            state = 35;
            continue;
          }
        case 65:
          yych = this.charAt(++this.cursor);
          if (yych <= '/') {
            state = 41;
            continue;
          }
          if (yych >= ':') {
            state = 41;
            continue;
          }
        case 66:
          yych = this.charAt(++this.cursor);
          if (yych <= '/') {
            state = 25;
            continue;
          }
          if (yych <= '9') {
            state = 66;
            continue;
          }
          {
            state = 25;
            continue;
          }
        case 68:
          yych = this.charAt(++this.cursor);
          if (yych == 'E') {
            state = 71;
            continue;
          }
          if (yych == 'e') {
            state = 71;
            continue;
          }
          {
            state = 35;
            continue;
          }
        case 69:
          yych = this.charAt(++this.cursor);
          if (yych <= 'Z') {
            if (yych <= '9') {
              if (yych == '.') {
                state = 34;
                continue;
              }
              if (yych >= '0') {
                state = 34;
                continue;
              }
            } else {
              if (yych == '?') {
                state = 34;
                continue;
              }
              if (yych >= 'A') {
                state = 34;
                continue;
              }
            }
          } else {
            if (yych <= '_') {
              if (yych == '\\') {
                state = 34;
                continue;
              }
              if (yych >= '_') {
                state = 34;
                continue;
              }
            } else {
              if (yych <= '`') {
                state = 70;
                continue;
              }
              if (yych <= 'z') {
                state = 34;
                continue;
              }
              if (yych >= String.fromCharCode(0x0080)) {
                state = 34;
                continue;
              }
            }
          }
        case 70: {
          return this._bool(true);
        }
        case 71:
          yych = this.charAt(++this.cursor);
          if (yych <= 'Z') {
            if (yych <= '9') {
              if (yych == '.') {
                state = 34;
                continue;
              }
              if (yych >= '0') {
                state = 34;
                continue;
              }
            } else {
              if (yych == '?') {
                state = 34;
                continue;
              }
              if (yych >= 'A') {
                state = 34;
                continue;
              }
            }
          } else {
            if (yych <= '_') {
              if (yych == '\\') {
                state = 34;
                continue;
              }
              if (yych >= '_') {
                state = 34;
                continue;
              }
            } else {
              if (yych <= '`') {
                state = 72;
                continue;
              }
              if (yych <= 'z') {
                state = 34;
                continue;
              }
              if (yych >= String.fromCharCode(0x0080)) {
                state = 34;
                continue;
              }
            }
          }
        case 72: {
          return this._bool(false);
        }
      }
    }
    return Token.YYUNDEF;
  }

  private _bool(value: boolean) {
    this.value = new ast.LogicalValueNode(value);
    return Token.LOGICAL;
  }

  private _number() {
    this.value = new ast.NumberValueNode(parseFloat(this.yytext()));
    return Token.NUMBER;
  }

  private _string() {
    const value = this.yytext().replace(/^'|'$/g, '').replace(/''/g, "'");
    this.value = new ast.StringValueNode(value);
    return Token.STRING;
  }

  private _name() {
    this.value = new ast.NameNode(this.yytext());
    return Token.NAME;
  }

  charAt(cursor: number) {
    if (cursor < this.source.length) {
      return this.source.charAt(cursor);
    }
    if (cursor > this.source.length) {
      throw Error('Illegal.');
    }
    return '\0';
  }

  yytext() {
    return this.source.substring(this.token, this.cursor);
  }

  yyerror(loc: Token.Location, msg: String) {
    console.error('ERROR', loc, msg);
  }

  reportSyntaxError(ctx: Token.Context) {
    console.error(ctx);
  }

  getLocation() {
    return new Token.Location(
      new Position(1, this.token),
      new Position(1, this.cursor)
    );
  }
}
