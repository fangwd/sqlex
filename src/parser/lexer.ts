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
            case '"': {
              state = 7;
              continue;
            }
            case "'": {
              state = 8;
              continue;
            }
            case '(': {
              state = 9;
              continue;
            }
            case ')': {
              state = 11;
              continue;
            }
            case '*': {
              state = 13;
              continue;
            }
            case '+': {
              state = 15;
              continue;
            }
            case ',': {
              state = 17;
              continue;
            }
            case '-': {
              state = 19;
              continue;
            }
            case '.': {
              state = 21;
              continue;
            }
            case '/': {
              state = 22;
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
              state = 24;
              continue;
            }
            case '<': {
              state = 27;
              continue;
            }
            case '=': {
              state = 29;
              continue;
            }
            case '>': {
              state = 31;
              continue;
            }
            case 'A':
            case 'a': {
              state = 33;
              continue;
            }
            case 'F':
            case 'f': {
              state = 37;
              continue;
            }
            case 'O':
            case 'o': {
              state = 38;
              continue;
            }
            case 'T':
            case 't': {
              state = 39;
              continue;
            }
            case '`': {
              state = 40;
              continue;
            }
            default: {
              state = 35;
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
          if (yych == '"') {
            state = 3;
            continue;
          }
          {
            state = 41;
            continue;
          }
        case 8:
          yyaccept = 0;
          yych = this.charAt((marker = ++this.cursor));
          if (yych <= String.fromCharCode(0x0000)) {
            state = 3;
            continue;
          }
          {
            state = 45;
            continue;
          }
        case 9:
          ++this.cursor;
          {
            return Token.LPAREN;
          }
        case 11:
          ++this.cursor;
          {
            return Token.RPAREN;
          }
        case 13:
          ++this.cursor;
          {
            return Token.MUL;
          }
        case 15:
          ++this.cursor;
          {
            return Token.PLUS;
          }
        case 17:
          ++this.cursor;
          {
            return Token.COMMA;
          }
        case 19:
          ++this.cursor;
          {
            return Token.MINUS;
          }
        case 21:
          yych = this.charAt(++this.cursor);
          if (yych <= '/') {
            state = 3;
            continue;
          }
          if (yych <= '9') {
            state = 48;
            continue;
          }
          {
            state = 3;
            continue;
          }
        case 22:
          ++this.cursor;
          {
            return Token.DIV;
          }
        case 24:
          yyaccept = 1;
          yych = this.charAt((marker = ++this.cursor));
          if (yych == '.') {
            state = 50;
            continue;
          }
          if (yych <= '/') {
            state = 26;
            continue;
          }
          if (yych <= '9') {
            state = 24;
            continue;
          }
        case 26: {
          return this._number();
        }
        case 27:
          yych = this.charAt(++this.cursor);
          if (yych <= '<') {
            state = 28;
            continue;
          }
          if (yych <= '=') {
            state = 51;
            continue;
          }
          if (yych <= '>') {
            state = 53;
            continue;
          }
        case 28: {
          return Token.LT;
        }
        case 29:
          ++this.cursor;
          {
            return Token.EQ;
          }
        case 31:
          yych = this.charAt(++this.cursor);
          if (yych == '=') {
            state = 55;
            continue;
          }
          {
            return Token.GT;
          }
        case 33:
          yych = this.charAt(++this.cursor);
          if (yych <= 'S') {
            if (yych == 'N') {
              state = 57;
              continue;
            }
            if (yych <= 'R') {
              state = 36;
              continue;
            }
            {
              state = 58;
              continue;
            }
          } else {
            if (yych <= 'n') {
              if (yych <= 'm') {
                state = 36;
                continue;
              }
              {
                state = 57;
                continue;
              }
            } else {
              if (yych == 's') {
                state = 58;
                continue;
              }
              {
                state = 36;
                continue;
              }
            }
          }
        case 34: {
          return this._name();
        }
        case 35:
          yych = this.charAt(++this.cursor);
        case 36:
          if (yych <= 'Z') {
            if (yych <= '9') {
              if (yych == '.') {
                state = 35;
                continue;
              }
              if (yych <= '/') {
                state = 34;
                continue;
              }
              {
                state = 35;
                continue;
              }
            } else {
              if (yych == '?') {
                state = 35;
                continue;
              }
              if (yych <= '@') {
                state = 34;
                continue;
              }
              {
                state = 35;
                continue;
              }
            }
          } else {
            if (yych <= '_') {
              if (yych == '\\') {
                state = 35;
                continue;
              }
              if (yych <= '^') {
                state = 34;
                continue;
              }
              {
                state = 35;
                continue;
              }
            } else {
              if (yych <= '`') {
                state = 34;
                continue;
              }
              if (yych <= 'z') {
                state = 35;
                continue;
              }
              if (yych <= String.fromCharCode(0x007f)) {
                state = 34;
                continue;
              }
              {
                state = 35;
                continue;
              }
            }
          }
        case 37:
          yych = this.charAt(++this.cursor);
          if (yych == 'A') {
            state = 60;
            continue;
          }
          if (yych == 'a') {
            state = 60;
            continue;
          }
          {
            state = 36;
            continue;
          }
        case 38:
          yych = this.charAt(++this.cursor);
          if (yych == 'R') {
            state = 61;
            continue;
          }
          if (yych == 'r') {
            state = 61;
            continue;
          }
          {
            state = 36;
            continue;
          }
        case 39:
          yych = this.charAt(++this.cursor);
          if (yych == 'R') {
            state = 63;
            continue;
          }
          if (yych == 'r') {
            state = 63;
            continue;
          }
          {
            state = 36;
            continue;
          }
        case 40:
          yyaccept = 0;
          yych = this.charAt((marker = ++this.cursor));
          if (yych <= String.fromCharCode(0x0000)) {
            state = 3;
            continue;
          }
          if (yych == '`') {
            state = 3;
            continue;
          }
          {
            state = 64;
            continue;
          }
        case 41:
          yych = this.charAt(++this.cursor);
          if (yych <= String.fromCharCode(0x0000)) {
            state = 43;
            continue;
          }
          if (yych == '"') {
            state = 66;
            continue;
          }
          {
            state = 41;
            continue;
          }
        case 43:
          this.cursor = marker;
          if (yyaccept <= 1) {
            if (yyaccept == 0) {
              {
                state = 3;
                continue;
              }
            } else {
              {
                state = 26;
                continue;
              }
            }
          } else {
            {
              state = 47;
              continue;
            }
          }
        case 44:
          yych = this.charAt(++this.cursor);
        case 45:
          if (yych <= String.fromCharCode(0x0000)) {
            state = 43;
            continue;
          }
          if (yych != "'") {
            state = 44;
            continue;
          }
          yyaccept = 2;
          yych = this.charAt((marker = ++this.cursor));
          if (yych == "'") {
            state = 44;
            continue;
          }
        case 47: {
          return this._string();
        }
        case 48:
          yyaccept = 1;
          yych = this.charAt((marker = ++this.cursor));
          if (yych <= 'D') {
            if (yych <= '/') {
              state = 26;
              continue;
            }
            if (yych <= '9') {
              state = 48;
              continue;
            }
            {
              state = 26;
              continue;
            }
          } else {
            if (yych <= 'E') {
              state = 68;
              continue;
            }
            if (yych == 'e') {
              state = 68;
              continue;
            }
            {
              state = 26;
              continue;
            }
          }
        case 50:
          yych = this.charAt(++this.cursor);
          if (yych <= '/') {
            state = 43;
            continue;
          }
          if (yych <= '9') {
            state = 48;
            continue;
          }
          {
            state = 43;
            continue;
          }
        case 51:
          ++this.cursor;
          {
            return Token.LE;
          }
        case 53:
          ++this.cursor;
          {
            return Token.NE;
          }
        case 55:
          ++this.cursor;
          {
            return Token.GE;
          }
        case 57:
          yych = this.charAt(++this.cursor);
          if (yych == 'D') {
            state = 69;
            continue;
          }
          if (yych == 'd') {
            state = 69;
            continue;
          }
          {
            state = 36;
            continue;
          }
        case 58:
          yych = this.charAt(++this.cursor);
          if (yych <= 'Z') {
            if (yych <= '9') {
              if (yych == '.') {
                state = 35;
                continue;
              }
              if (yych >= '0') {
                state = 35;
                continue;
              }
            } else {
              if (yych == '?') {
                state = 35;
                continue;
              }
              if (yych >= 'A') {
                state = 35;
                continue;
              }
            }
          } else {
            if (yych <= '_') {
              if (yych == '\\') {
                state = 35;
                continue;
              }
              if (yych >= '_') {
                state = 35;
                continue;
              }
            } else {
              if (yych <= '`') {
                state = 59;
                continue;
              }
              if (yych <= 'z') {
                state = 35;
                continue;
              }
              if (yych >= String.fromCharCode(0x0080)) {
                state = 35;
                continue;
              }
            }
          }
        case 59: {
          return Token.AS;
        }
        case 60:
          yych = this.charAt(++this.cursor);
          if (yych == 'L') {
            state = 71;
            continue;
          }
          if (yych == 'l') {
            state = 71;
            continue;
          }
          {
            state = 36;
            continue;
          }
        case 61:
          yych = this.charAt(++this.cursor);
          if (yych <= 'Z') {
            if (yych <= '9') {
              if (yych == '.') {
                state = 35;
                continue;
              }
              if (yych >= '0') {
                state = 35;
                continue;
              }
            } else {
              if (yych == '?') {
                state = 35;
                continue;
              }
              if (yych >= 'A') {
                state = 35;
                continue;
              }
            }
          } else {
            if (yych <= '_') {
              if (yych == '\\') {
                state = 35;
                continue;
              }
              if (yych >= '_') {
                state = 35;
                continue;
              }
            } else {
              if (yych <= '`') {
                state = 62;
                continue;
              }
              if (yych <= 'z') {
                state = 35;
                continue;
              }
              if (yych >= String.fromCharCode(0x0080)) {
                state = 35;
                continue;
              }
            }
          }
        case 62: {
          return Token.OR;
        }
        case 63:
          yych = this.charAt(++this.cursor);
          if (yych == 'U') {
            state = 72;
            continue;
          }
          if (yych == 'u') {
            state = 72;
            continue;
          }
          {
            state = 36;
            continue;
          }
        case 64:
          yych = this.charAt(++this.cursor);
          if (yych <= String.fromCharCode(0x0000)) {
            state = 43;
            continue;
          }
          if (yych == '`') {
            state = 73;
            continue;
          }
          {
            state = 64;
            continue;
          }
        case 66:
          ++this.cursor;
          {
            return this._name();
          }
        case 68:
          yych = this.charAt(++this.cursor);
          if (yych <= ',') {
            if (yych == '+') {
              state = 75;
              continue;
            }
            {
              state = 43;
              continue;
            }
          } else {
            if (yych <= '-') {
              state = 75;
              continue;
            }
            if (yych <= '/') {
              state = 43;
              continue;
            }
            if (yych <= '9') {
              state = 76;
              continue;
            }
            {
              state = 43;
              continue;
            }
          }
        case 69:
          yych = this.charAt(++this.cursor);
          if (yych <= 'Z') {
            if (yych <= '9') {
              if (yych == '.') {
                state = 35;
                continue;
              }
              if (yych >= '0') {
                state = 35;
                continue;
              }
            } else {
              if (yych == '?') {
                state = 35;
                continue;
              }
              if (yych >= 'A') {
                state = 35;
                continue;
              }
            }
          } else {
            if (yych <= '_') {
              if (yych == '\\') {
                state = 35;
                continue;
              }
              if (yych >= '_') {
                state = 35;
                continue;
              }
            } else {
              if (yych <= '`') {
                state = 70;
                continue;
              }
              if (yych <= 'z') {
                state = 35;
                continue;
              }
              if (yych >= String.fromCharCode(0x0080)) {
                state = 35;
                continue;
              }
            }
          }
        case 70: {
          return Token.AND;
        }
        case 71:
          yych = this.charAt(++this.cursor);
          if (yych == 'S') {
            state = 78;
            continue;
          }
          if (yych == 's') {
            state = 78;
            continue;
          }
          {
            state = 36;
            continue;
          }
        case 72:
          yych = this.charAt(++this.cursor);
          if (yych == 'E') {
            state = 79;
            continue;
          }
          if (yych == 'e') {
            state = 79;
            continue;
          }
          {
            state = 36;
            continue;
          }
        case 73:
          ++this.cursor;
          {
            return this._name();
          }
        case 75:
          yych = this.charAt(++this.cursor);
          if (yych <= '/') {
            state = 43;
            continue;
          }
          if (yych >= ':') {
            state = 43;
            continue;
          }
        case 76:
          yych = this.charAt(++this.cursor);
          if (yych <= '/') {
            state = 26;
            continue;
          }
          if (yych <= '9') {
            state = 76;
            continue;
          }
          {
            state = 26;
            continue;
          }
        case 78:
          yych = this.charAt(++this.cursor);
          if (yych == 'E') {
            state = 81;
            continue;
          }
          if (yych == 'e') {
            state = 81;
            continue;
          }
          {
            state = 36;
            continue;
          }
        case 79:
          yych = this.charAt(++this.cursor);
          if (yych <= 'Z') {
            if (yych <= '9') {
              if (yych == '.') {
                state = 35;
                continue;
              }
              if (yych >= '0') {
                state = 35;
                continue;
              }
            } else {
              if (yych == '?') {
                state = 35;
                continue;
              }
              if (yych >= 'A') {
                state = 35;
                continue;
              }
            }
          } else {
            if (yych <= '_') {
              if (yych == '\\') {
                state = 35;
                continue;
              }
              if (yych >= '_') {
                state = 35;
                continue;
              }
            } else {
              if (yych <= '`') {
                state = 80;
                continue;
              }
              if (yych <= 'z') {
                state = 35;
                continue;
              }
              if (yych >= String.fromCharCode(0x0080)) {
                state = 35;
                continue;
              }
            }
          }
        case 80: {
          return this._bool(true);
        }
        case 81:
          yych = this.charAt(++this.cursor);
          if (yych <= 'Z') {
            if (yych <= '9') {
              if (yych == '.') {
                state = 35;
                continue;
              }
              if (yych >= '0') {
                state = 35;
                continue;
              }
            } else {
              if (yych == '?') {
                state = 35;
                continue;
              }
              if (yych >= 'A') {
                state = 35;
                continue;
              }
            }
          } else {
            if (yych <= '_') {
              if (yych == '\\') {
                state = 35;
                continue;
              }
              if (yych >= '_') {
                state = 35;
                continue;
              }
            } else {
              if (yych <= '`') {
                state = 82;
                continue;
              }
              if (yych <= 'z') {
                state = 35;
                continue;
              }
              if (yych >= String.fromCharCode(0x0080)) {
                state = 35;
                continue;
              }
            }
          }
        case 82: {
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
    const value = this.yytext().replace(/^[`"]|[`"]$/g, '');
    this.value = new ast.NameNode(value);
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
