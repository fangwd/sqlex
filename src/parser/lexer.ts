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
          if (yych <= '<') {
            if (yych <= '(') {
              if (yych <= '\r') {
                if (yych <= String.fromCharCode(0x0008)) {
                  state = 2;
                  continue;
                }
                if (yych != '\f') {
                  state = 4;
                  continue;
                }
              } else {
                if (yych <= ' ') {
                  if (yych >= ' ') {
                    state = 4;
                    continue;
                  }
                } else {
                  if (yych <= '&') {
                    state = 2;
                    continue;
                  }
                  if (yych <= "'") {
                    state = 7;
                    continue;
                  }
                  {
                    state = 8;
                    continue;
                  }
                }
              }
            } else {
              if (yych <= '-') {
                if (yych <= '*') {
                  if (yych <= ')') {
                    state = 10;
                    continue;
                  }
                  {
                    state = 12;
                    continue;
                  }
                } else {
                  if (yych <= '+') {
                    state = 14;
                    continue;
                  }
                  if (yych <= ',') {
                    state = 16;
                    continue;
                  }
                  {
                    state = 18;
                    continue;
                  }
                }
              } else {
                if (yych <= '/') {
                  if (yych <= '.') {
                    state = 20;
                    continue;
                  }
                  {
                    state = 21;
                    continue;
                  }
                } else {
                  if (yych <= '9') {
                    state = 23;
                    continue;
                  }
                  if (yych >= '<') {
                    state = 26;
                    continue;
                  }
                }
              }
            }
          } else {
            if (yych <= '\\') {
              if (yych <= 'F') {
                if (yych <= '>') {
                  if (yych <= '=') {
                    state = 28;
                    continue;
                  }
                  {
                    state = 30;
                    continue;
                  }
                } else {
                  if (yych <= '@') {
                    state = 2;
                    continue;
                  }
                  if (yych <= 'E') {
                    state = 32;
                    continue;
                  }
                  {
                    state = 35;
                    continue;
                  }
                }
              } else {
                if (yych <= 'T') {
                  if (yych <= 'S') {
                    state = 32;
                    continue;
                  }
                  {
                    state = 36;
                    continue;
                  }
                } else {
                  if (yych != '[') {
                    state = 32;
                    continue;
                  }
                }
              }
            } else {
              if (yych <= 'f') {
                if (yych <= '_') {
                  if (yych >= '_') {
                    state = 32;
                    continue;
                  }
                } else {
                  if (yych <= '`') {
                    state = 2;
                    continue;
                  }
                  if (yych <= 'e') {
                    state = 32;
                    continue;
                  }
                  {
                    state = 35;
                    continue;
                  }
                }
              } else {
                if (yych <= 't') {
                  if (yych <= 's') {
                    state = 32;
                    continue;
                  }
                  {
                    state = 36;
                    continue;
                  }
                } else {
                  if (yych <= 'z') {
                    state = 32;
                    continue;
                  }
                  if (yych >= String.fromCharCode(0x0080)) {
                    state = 32;
                    continue;
                  }
                }
              }
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
            state = 38;
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
            state = 42;
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
            state = 44;
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
            state = 45;
            continue;
          }
          if (yych <= '>') {
            state = 47;
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
            state = 49;
            continue;
          }
          {
            return Token.GT;
          }
        case 32:
          yych = this.charAt(++this.cursor);
        case 33:
          if (yych <= 'Z') {
            if (yych <= '9') {
              if (yych == '.') {
                state = 32;
                continue;
              }
              if (yych >= '0') {
                state = 32;
                continue;
              }
            } else {
              if (yych == '?') {
                state = 32;
                continue;
              }
              if (yych >= 'A') {
                state = 32;
                continue;
              }
            }
          } else {
            if (yych <= '_') {
              if (yych == '\\') {
                state = 32;
                continue;
              }
              if (yych >= '_') {
                state = 32;
                continue;
              }
            } else {
              if (yych <= '`') {
                state = 34;
                continue;
              }
              if (yych <= 'z') {
                state = 32;
                continue;
              }
              if (yych >= String.fromCharCode(0x0080)) {
                state = 32;
                continue;
              }
            }
          }
        case 34: {
          return this._name();
        }
        case 35:
          yych = this.charAt(++this.cursor);
          if (yych == 'A') {
            state = 51;
            continue;
          }
          if (yych == 'a') {
            state = 51;
            continue;
          }
          {
            state = 33;
            continue;
          }
        case 36:
          yych = this.charAt(++this.cursor);
          if (yych == 'R') {
            state = 52;
            continue;
          }
          if (yych == 'r') {
            state = 52;
            continue;
          }
          {
            state = 33;
            continue;
          }
        case 37:
          yych = this.charAt(++this.cursor);
        case 38:
          if (yych <= String.fromCharCode(0x0000)) {
            state = 39;
            continue;
          }
          if (yych == "'") {
            state = 40;
            continue;
          }
          {
            state = 37;
            continue;
          }
        case 39:
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
              state = 41;
              continue;
            }
          }
        case 40:
          yyaccept = 2;
          yych = this.charAt((marker = ++this.cursor));
          if (yych == "'") {
            state = 37;
            continue;
          }
        case 41: {
          return this._string();
        }
        case 42:
          yyaccept = 1;
          yych = this.charAt((marker = ++this.cursor));
          if (yych <= 'D') {
            if (yych <= '/') {
              state = 25;
              continue;
            }
            if (yych <= '9') {
              state = 42;
              continue;
            }
            {
              state = 25;
              continue;
            }
          } else {
            if (yych <= 'E') {
              state = 53;
              continue;
            }
            if (yych == 'e') {
              state = 53;
              continue;
            }
            {
              state = 25;
              continue;
            }
          }
        case 44:
          yych = this.charAt(++this.cursor);
          if (yych <= '/') {
            state = 39;
            continue;
          }
          if (yych <= '9') {
            state = 42;
            continue;
          }
          {
            state = 39;
            continue;
          }
        case 45:
          ++this.cursor;
          {
            return Token.LE;
          }
        case 47:
          ++this.cursor;
          {
            return Token.NE;
          }
        case 49:
          ++this.cursor;
          {
            return Token.GE;
          }
        case 51:
          yych = this.charAt(++this.cursor);
          if (yych == 'L') {
            state = 54;
            continue;
          }
          if (yych == 'l') {
            state = 54;
            continue;
          }
          {
            state = 33;
            continue;
          }
        case 52:
          yych = this.charAt(++this.cursor);
          if (yych == 'U') {
            state = 55;
            continue;
          }
          if (yych == 'u') {
            state = 55;
            continue;
          }
          {
            state = 33;
            continue;
          }
        case 53:
          yych = this.charAt(++this.cursor);
          if (yych <= ',') {
            if (yych == '+') {
              state = 56;
              continue;
            }
            {
              state = 39;
              continue;
            }
          } else {
            if (yych <= '-') {
              state = 56;
              continue;
            }
            if (yych <= '/') {
              state = 39;
              continue;
            }
            if (yych <= '9') {
              state = 57;
              continue;
            }
            {
              state = 39;
              continue;
            }
          }
        case 54:
          yych = this.charAt(++this.cursor);
          if (yych == 'S') {
            state = 59;
            continue;
          }
          if (yych == 's') {
            state = 59;
            continue;
          }
          {
            state = 33;
            continue;
          }
        case 55:
          yych = this.charAt(++this.cursor);
          if (yych == 'E') {
            state = 60;
            continue;
          }
          if (yych == 'e') {
            state = 60;
            continue;
          }
          {
            state = 33;
            continue;
          }
        case 56:
          yych = this.charAt(++this.cursor);
          if (yych <= '/') {
            state = 39;
            continue;
          }
          if (yych >= ':') {
            state = 39;
            continue;
          }
        case 57:
          yych = this.charAt(++this.cursor);
          if (yych <= '/') {
            state = 25;
            continue;
          }
          if (yych <= '9') {
            state = 57;
            continue;
          }
          {
            state = 25;
            continue;
          }
        case 59:
          yych = this.charAt(++this.cursor);
          if (yych == 'E') {
            state = 62;
            continue;
          }
          if (yych == 'e') {
            state = 62;
            continue;
          }
          {
            state = 33;
            continue;
          }
        case 60:
          yych = this.charAt(++this.cursor);
          if (yych <= 'Z') {
            if (yych <= '9') {
              if (yych == '.') {
                state = 32;
                continue;
              }
              if (yych >= '0') {
                state = 32;
                continue;
              }
            } else {
              if (yych == '?') {
                state = 32;
                continue;
              }
              if (yych >= 'A') {
                state = 32;
                continue;
              }
            }
          } else {
            if (yych <= '_') {
              if (yych == '\\') {
                state = 32;
                continue;
              }
              if (yych >= '_') {
                state = 32;
                continue;
              }
            } else {
              if (yych <= '`') {
                state = 61;
                continue;
              }
              if (yych <= 'z') {
                state = 32;
                continue;
              }
              if (yych >= String.fromCharCode(0x0080)) {
                state = 32;
                continue;
              }
            }
          }
        case 61: {
          return this._bool(true);
        }
        case 62:
          yych = this.charAt(++this.cursor);
          if (yych <= 'Z') {
            if (yych <= '9') {
              if (yych == '.') {
                state = 32;
                continue;
              }
              if (yych >= '0') {
                state = 32;
                continue;
              }
            } else {
              if (yych == '?') {
                state = 32;
                continue;
              }
              if (yych >= 'A') {
                state = 32;
                continue;
              }
            }
          } else {
            if (yych <= '_') {
              if (yych == '\\') {
                state = 32;
                continue;
              }
              if (yych >= '_') {
                state = 32;
                continue;
              }
            } else {
              if (yych <= '`') {
                state = 63;
                continue;
              }
              if (yych <= 'z') {
                state = 32;
                continue;
              }
              if (yych >= String.fromCharCode(0x0080)) {
                state = 32;
                continue;
              }
            }
          }
        case 63: {
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
