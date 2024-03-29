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
            case ':': {
              state = 27;
              continue;
            }
            case '<': {
              state = 28;
              continue;
            }
            case '=': {
              state = 30;
              continue;
            }
            case '>': {
              state = 32;
              continue;
            }
            case 'A':
            case 'a': {
              state = 34;
              continue;
            }
            case 'F':
            case 'f': {
              state = 38;
              continue;
            }
            case 'I':
            case 'i': {
              state = 39;
              continue;
            }
            case 'N':
            case 'n': {
              state = 40;
              continue;
            }
            case 'O':
            case 'o': {
              state = 41;
              continue;
            }
            case 'T':
            case 't': {
              state = 42;
              continue;
            }
            case '`': {
              state = 43;
              continue;
            }
            default: {
              state = 36;
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
            state = 44;
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
            state = 48;
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
            state = 51;
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
            state = 53;
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
          if (yych == ':') {
            state = 54;
            continue;
          }
          {
            state = 3;
            continue;
          }
        case 28:
          yych = this.charAt(++this.cursor);
          if (yych <= '<') {
            state = 29;
            continue;
          }
          if (yych <= '=') {
            state = 56;
            continue;
          }
          if (yych <= '>') {
            state = 58;
            continue;
          }
        case 29: {
          return Token.LT;
        }
        case 30:
          ++this.cursor;
          {
            return Token.EQ;
          }
        case 32:
          yych = this.charAt(++this.cursor);
          if (yych == '=') {
            state = 60;
            continue;
          }
          {
            return Token.GT;
          }
        case 34:
          yych = this.charAt(++this.cursor);
          if (yych <= 'R') {
            if (yych <= '*') {
              if (yych <= ')') {
                state = 63;
                continue;
              }
            } else {
              if (yych == 'N') {
                state = 64;
                continue;
              }
              {
                state = 63;
                continue;
              }
            }
          } else {
            if (yych <= 'n') {
              if (yych <= 'S') {
                state = 65;
                continue;
              }
              if (yych <= 'm') {
                state = 63;
                continue;
              }
              {
                state = 64;
                continue;
              }
            } else {
              if (yych == 's') {
                state = 65;
                continue;
              }
              {
                state = 63;
                continue;
              }
            }
          }
        case 35: {
          return this._name();
        }
        case 36:
          yych = this.charAt(++this.cursor);
          if (yych <= 'Z') {
            if (yych <= '9') {
              if (yych == '.') {
                state = 62;
                continue;
              }
              if (yych <= '/') {
                state = 35;
                continue;
              }
              {
                state = 36;
                continue;
              }
            } else {
              if (yych == '?') {
                state = 36;
                continue;
              }
              if (yych <= '@') {
                state = 35;
                continue;
              }
              {
                state = 36;
                continue;
              }
            }
          } else {
            if (yych <= '_') {
              if (yych == '\\') {
                state = 36;
                continue;
              }
              if (yych <= '^') {
                state = 35;
                continue;
              }
              {
                state = 36;
                continue;
              }
            } else {
              if (yych <= '`') {
                state = 35;
                continue;
              }
              if (yych <= 'z') {
                state = 36;
                continue;
              }
              if (yych <= String.fromCharCode(0x007f)) {
                state = 35;
                continue;
              }
              {
                state = 36;
                continue;
              }
            }
          }
        case 38:
          yych = this.charAt(++this.cursor);
          if (yych <= '@') {
            if (yych == '*') {
              state = 35;
              continue;
            }
            {
              state = 63;
              continue;
            }
          } else {
            if (yych <= 'A') {
              state = 67;
              continue;
            }
            if (yych == 'a') {
              state = 67;
              continue;
            }
            {
              state = 63;
              continue;
            }
          }
        case 39:
          yych = this.charAt(++this.cursor);
          if (yych <= 'R') {
            if (yych == '*') {
              state = 35;
              continue;
            }
            {
              state = 63;
              continue;
            }
          } else {
            if (yych <= 'S') {
              state = 68;
              continue;
            }
            if (yych == 's') {
              state = 68;
              continue;
            }
            {
              state = 63;
              continue;
            }
          }
        case 40:
          yych = this.charAt(++this.cursor);
          if (yych <= 'T') {
            if (yych <= '*') {
              if (yych <= ')') {
                state = 63;
                continue;
              }
              {
                state = 35;
                continue;
              }
            } else {
              if (yych == 'O') {
                state = 70;
                continue;
              }
              {
                state = 63;
                continue;
              }
            }
          } else {
            if (yych <= 'o') {
              if (yych <= 'U') {
                state = 71;
                continue;
              }
              if (yych <= 'n') {
                state = 63;
                continue;
              }
              {
                state = 70;
                continue;
              }
            } else {
              if (yych == 'u') {
                state = 71;
                continue;
              }
              {
                state = 63;
                continue;
              }
            }
          }
        case 41:
          yych = this.charAt(++this.cursor);
          if (yych <= 'Q') {
            if (yych == '*') {
              state = 35;
              continue;
            }
            {
              state = 63;
              continue;
            }
          } else {
            if (yych <= 'R') {
              state = 72;
              continue;
            }
            if (yych == 'r') {
              state = 72;
              continue;
            }
            {
              state = 63;
              continue;
            }
          }
        case 42:
          yych = this.charAt(++this.cursor);
          if (yych <= 'Q') {
            if (yych == '*') {
              state = 35;
              continue;
            }
            {
              state = 63;
              continue;
            }
          } else {
            if (yych <= 'R') {
              state = 74;
              continue;
            }
            if (yych == 'r') {
              state = 74;
              continue;
            }
            {
              state = 63;
              continue;
            }
          }
        case 43:
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
            state = 75;
            continue;
          }
        case 44:
          yych = this.charAt(++this.cursor);
          if (yych <= String.fromCharCode(0x0000)) {
            state = 46;
            continue;
          }
          if (yych == '"') {
            state = 77;
            continue;
          }
          {
            state = 44;
            continue;
          }
        case 46:
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
              state = 50;
              continue;
            }
          }
        case 47:
          yych = this.charAt(++this.cursor);
        case 48:
          if (yych <= String.fromCharCode(0x0000)) {
            state = 46;
            continue;
          }
          if (yych != "'") {
            state = 47;
            continue;
          }
          yyaccept = 2;
          yych = this.charAt((marker = ++this.cursor));
          if (yych == "'") {
            state = 47;
            continue;
          }
        case 50: {
          return this._string();
        }
        case 51:
          yyaccept = 1;
          yych = this.charAt((marker = ++this.cursor));
          if (yych <= 'D') {
            if (yych <= '/') {
              state = 26;
              continue;
            }
            if (yych <= '9') {
              state = 51;
              continue;
            }
            {
              state = 26;
              continue;
            }
          } else {
            if (yych <= 'E') {
              state = 79;
              continue;
            }
            if (yych == 'e') {
              state = 79;
              continue;
            }
            {
              state = 26;
              continue;
            }
          }
        case 53:
          yych = this.charAt(++this.cursor);
          if (yych <= '/') {
            state = 46;
            continue;
          }
          if (yych <= '9') {
            state = 51;
            continue;
          }
          {
            state = 46;
            continue;
          }
        case 54:
          ++this.cursor;
          {
            return Token.PSQL_CAST;
          }
        case 56:
          ++this.cursor;
          {
            return Token.LE;
          }
        case 58:
          ++this.cursor;
          {
            return Token.NE;
          }
        case 60:
          ++this.cursor;
          {
            return Token.GE;
          }
        case 62:
          yych = this.charAt(++this.cursor);
        case 63:
          if (yych <= '@') {
            if (yych <= '.') {
              if (yych == '*') {
                state = 80;
                continue;
              }
              if (yych <= '-') {
                state = 35;
                continue;
              }
              {
                state = 62;
                continue;
              }
            } else {
              if (yych <= '9') {
                if (yych <= '/') {
                  state = 35;
                  continue;
                }
                {
                  state = 36;
                  continue;
                }
              } else {
                if (yych == '?') {
                  state = 36;
                  continue;
                }
                {
                  state = 35;
                  continue;
                }
              }
            }
          } else {
            if (yych <= '^') {
              if (yych == '[') {
                state = 35;
                continue;
              }
              if (yych <= '\\') {
                state = 36;
                continue;
              }
              {
                state = 35;
                continue;
              }
            } else {
              if (yych <= '`') {
                if (yych <= '_') {
                  state = 36;
                  continue;
                }
                {
                  state = 35;
                  continue;
                }
              } else {
                if (yych <= 'z') {
                  state = 36;
                  continue;
                }
                if (yych <= String.fromCharCode(0x007f)) {
                  state = 35;
                  continue;
                }
                {
                  state = 36;
                  continue;
                }
              }
            }
          }
        case 64:
          yych = this.charAt(++this.cursor);
          if (yych <= 'C') {
            if (yych == '*') {
              state = 35;
              continue;
            }
            {
              state = 63;
              continue;
            }
          } else {
            if (yych <= 'D') {
              state = 82;
              continue;
            }
            if (yych == 'd') {
              state = 82;
              continue;
            }
            {
              state = 63;
              continue;
            }
          }
        case 65:
          yych = this.charAt(++this.cursor);
          if (yych <= 'Z') {
            if (yych <= '9') {
              if (yych == '.') {
                state = 62;
                continue;
              }
              if (yych >= '0') {
                state = 36;
                continue;
              }
            } else {
              if (yych == '?') {
                state = 36;
                continue;
              }
              if (yych >= 'A') {
                state = 36;
                continue;
              }
            }
          } else {
            if (yych <= '_') {
              if (yych == '\\') {
                state = 36;
                continue;
              }
              if (yych >= '_') {
                state = 36;
                continue;
              }
            } else {
              if (yych <= '`') {
                state = 66;
                continue;
              }
              if (yych <= 'z') {
                state = 36;
                continue;
              }
              if (yych >= String.fromCharCode(0x0080)) {
                state = 36;
                continue;
              }
            }
          }
        case 66: {
          return Token.AS;
        }
        case 67:
          yych = this.charAt(++this.cursor);
          if (yych <= 'K') {
            if (yych == '*') {
              state = 35;
              continue;
            }
            {
              state = 63;
              continue;
            }
          } else {
            if (yych <= 'L') {
              state = 84;
              continue;
            }
            if (yych == 'l') {
              state = 84;
              continue;
            }
            {
              state = 63;
              continue;
            }
          }
        case 68:
          yych = this.charAt(++this.cursor);
          if (yych <= 'Z') {
            if (yych <= '9') {
              if (yych == '.') {
                state = 62;
                continue;
              }
              if (yych >= '0') {
                state = 36;
                continue;
              }
            } else {
              if (yych == '?') {
                state = 36;
                continue;
              }
              if (yych >= 'A') {
                state = 36;
                continue;
              }
            }
          } else {
            if (yych <= '_') {
              if (yych == '\\') {
                state = 36;
                continue;
              }
              if (yych >= '_') {
                state = 36;
                continue;
              }
            } else {
              if (yych <= '`') {
                state = 69;
                continue;
              }
              if (yych <= 'z') {
                state = 36;
                continue;
              }
              if (yych >= String.fromCharCode(0x0080)) {
                state = 36;
                continue;
              }
            }
          }
        case 69: {
          return Token.IS;
        }
        case 70:
          yych = this.charAt(++this.cursor);
          if (yych <= 'S') {
            if (yych == '*') {
              state = 35;
              continue;
            }
            {
              state = 63;
              continue;
            }
          } else {
            if (yych <= 'T') {
              state = 85;
              continue;
            }
            if (yych == 't') {
              state = 85;
              continue;
            }
            {
              state = 63;
              continue;
            }
          }
        case 71:
          yych = this.charAt(++this.cursor);
          if (yych <= 'K') {
            if (yych == '*') {
              state = 35;
              continue;
            }
            {
              state = 63;
              continue;
            }
          } else {
            if (yych <= 'L') {
              state = 87;
              continue;
            }
            if (yych == 'l') {
              state = 87;
              continue;
            }
            {
              state = 63;
              continue;
            }
          }
        case 72:
          yych = this.charAt(++this.cursor);
          if (yych <= 'Z') {
            if (yych <= '9') {
              if (yych == '.') {
                state = 62;
                continue;
              }
              if (yych >= '0') {
                state = 36;
                continue;
              }
            } else {
              if (yych == '?') {
                state = 36;
                continue;
              }
              if (yych >= 'A') {
                state = 36;
                continue;
              }
            }
          } else {
            if (yych <= '_') {
              if (yych == '\\') {
                state = 36;
                continue;
              }
              if (yych >= '_') {
                state = 36;
                continue;
              }
            } else {
              if (yych <= '`') {
                state = 73;
                continue;
              }
              if (yych <= 'z') {
                state = 36;
                continue;
              }
              if (yych >= String.fromCharCode(0x0080)) {
                state = 36;
                continue;
              }
            }
          }
        case 73: {
          return Token.OR;
        }
        case 74:
          yych = this.charAt(++this.cursor);
          if (yych <= 'T') {
            if (yych == '*') {
              state = 35;
              continue;
            }
            {
              state = 63;
              continue;
            }
          } else {
            if (yych <= 'U') {
              state = 88;
              continue;
            }
            if (yych == 'u') {
              state = 88;
              continue;
            }
            {
              state = 63;
              continue;
            }
          }
        case 75:
          yych = this.charAt(++this.cursor);
          if (yych <= String.fromCharCode(0x0000)) {
            state = 46;
            continue;
          }
          if (yych == '`') {
            state = 89;
            continue;
          }
          {
            state = 75;
            continue;
          }
        case 77:
          ++this.cursor;
          {
            return this._name();
          }
        case 79:
          yych = this.charAt(++this.cursor);
          if (yych <= ',') {
            if (yych == '+') {
              state = 91;
              continue;
            }
            {
              state = 46;
              continue;
            }
          } else {
            if (yych <= '-') {
              state = 91;
              continue;
            }
            if (yych <= '/') {
              state = 46;
              continue;
            }
            if (yych <= '9') {
              state = 92;
              continue;
            }
            {
              state = 46;
              continue;
            }
          }
        case 80:
          ++this.cursor;
          {
            return this._name();
          }
        case 82:
          yych = this.charAt(++this.cursor);
          if (yych <= 'Z') {
            if (yych <= '9') {
              if (yych == '.') {
                state = 62;
                continue;
              }
              if (yych >= '0') {
                state = 36;
                continue;
              }
            } else {
              if (yych == '?') {
                state = 36;
                continue;
              }
              if (yych >= 'A') {
                state = 36;
                continue;
              }
            }
          } else {
            if (yych <= '_') {
              if (yych == '\\') {
                state = 36;
                continue;
              }
              if (yych >= '_') {
                state = 36;
                continue;
              }
            } else {
              if (yych <= '`') {
                state = 83;
                continue;
              }
              if (yych <= 'z') {
                state = 36;
                continue;
              }
              if (yych >= String.fromCharCode(0x0080)) {
                state = 36;
                continue;
              }
            }
          }
        case 83: {
          return Token.AND;
        }
        case 84:
          yych = this.charAt(++this.cursor);
          if (yych <= 'R') {
            if (yych == '*') {
              state = 35;
              continue;
            }
            {
              state = 63;
              continue;
            }
          } else {
            if (yych <= 'S') {
              state = 94;
              continue;
            }
            if (yych == 's') {
              state = 94;
              continue;
            }
            {
              state = 63;
              continue;
            }
          }
        case 85:
          yych = this.charAt(++this.cursor);
          if (yych <= 'Z') {
            if (yych <= '9') {
              if (yych == '.') {
                state = 62;
                continue;
              }
              if (yych >= '0') {
                state = 36;
                continue;
              }
            } else {
              if (yych == '?') {
                state = 36;
                continue;
              }
              if (yych >= 'A') {
                state = 36;
                continue;
              }
            }
          } else {
            if (yych <= '_') {
              if (yych == '\\') {
                state = 36;
                continue;
              }
              if (yych >= '_') {
                state = 36;
                continue;
              }
            } else {
              if (yych <= '`') {
                state = 86;
                continue;
              }
              if (yych <= 'z') {
                state = 36;
                continue;
              }
              if (yych >= String.fromCharCode(0x0080)) {
                state = 36;
                continue;
              }
            }
          }
        case 86: {
          return Token.NOT;
        }
        case 87:
          yych = this.charAt(++this.cursor);
          if (yych <= 'K') {
            if (yych == '*') {
              state = 35;
              continue;
            }
            {
              state = 63;
              continue;
            }
          } else {
            if (yych <= 'L') {
              state = 95;
              continue;
            }
            if (yych == 'l') {
              state = 95;
              continue;
            }
            {
              state = 63;
              continue;
            }
          }
        case 88:
          yych = this.charAt(++this.cursor);
          if (yych <= 'D') {
            if (yych == '*') {
              state = 35;
              continue;
            }
            {
              state = 63;
              continue;
            }
          } else {
            if (yych <= 'E') {
              state = 97;
              continue;
            }
            if (yych == 'e') {
              state = 97;
              continue;
            }
            {
              state = 63;
              continue;
            }
          }
        case 89:
          ++this.cursor;
          {
            return this._name();
          }
        case 91:
          yych = this.charAt(++this.cursor);
          if (yych <= '/') {
            state = 46;
            continue;
          }
          if (yych >= ':') {
            state = 46;
            continue;
          }
        case 92:
          yych = this.charAt(++this.cursor);
          if (yych <= '/') {
            state = 26;
            continue;
          }
          if (yych <= '9') {
            state = 92;
            continue;
          }
          {
            state = 26;
            continue;
          }
        case 94:
          yych = this.charAt(++this.cursor);
          if (yych <= 'D') {
            if (yych == '*') {
              state = 35;
              continue;
            }
            {
              state = 63;
              continue;
            }
          } else {
            if (yych <= 'E') {
              state = 99;
              continue;
            }
            if (yych == 'e') {
              state = 99;
              continue;
            }
            {
              state = 63;
              continue;
            }
          }
        case 95:
          yych = this.charAt(++this.cursor);
          if (yych <= 'Z') {
            if (yych <= '9') {
              if (yych == '.') {
                state = 62;
                continue;
              }
              if (yych >= '0') {
                state = 36;
                continue;
              }
            } else {
              if (yych == '?') {
                state = 36;
                continue;
              }
              if (yych >= 'A') {
                state = 36;
                continue;
              }
            }
          } else {
            if (yych <= '_') {
              if (yych == '\\') {
                state = 36;
                continue;
              }
              if (yych >= '_') {
                state = 36;
                continue;
              }
            } else {
              if (yych <= '`') {
                state = 96;
                continue;
              }
              if (yych <= 'z') {
                state = 36;
                continue;
              }
              if (yych >= String.fromCharCode(0x0080)) {
                state = 36;
                continue;
              }
            }
          }
        case 96: {
          return this._null();
        }
        case 97:
          yych = this.charAt(++this.cursor);
          if (yych <= 'Z') {
            if (yych <= '9') {
              if (yych == '.') {
                state = 62;
                continue;
              }
              if (yych >= '0') {
                state = 36;
                continue;
              }
            } else {
              if (yych == '?') {
                state = 36;
                continue;
              }
              if (yych >= 'A') {
                state = 36;
                continue;
              }
            }
          } else {
            if (yych <= '_') {
              if (yych == '\\') {
                state = 36;
                continue;
              }
              if (yych >= '_') {
                state = 36;
                continue;
              }
            } else {
              if (yych <= '`') {
                state = 98;
                continue;
              }
              if (yych <= 'z') {
                state = 36;
                continue;
              }
              if (yych >= String.fromCharCode(0x0080)) {
                state = 36;
                continue;
              }
            }
          }
        case 98: {
          return this._bool(true);
        }
        case 99:
          yych = this.charAt(++this.cursor);
          if (yych <= 'Z') {
            if (yych <= '9') {
              if (yych == '.') {
                state = 62;
                continue;
              }
              if (yych >= '0') {
                state = 36;
                continue;
              }
            } else {
              if (yych == '?') {
                state = 36;
                continue;
              }
              if (yych >= 'A') {
                state = 36;
                continue;
              }
            }
          } else {
            if (yych <= '_') {
              if (yych == '\\') {
                state = 36;
                continue;
              }
              if (yych >= '_') {
                state = 36;
                continue;
              }
            } else {
              if (yych <= '`') {
                state = 100;
                continue;
              }
              if (yych <= 'z') {
                state = 36;
                continue;
              }
              if (yych >= String.fromCharCode(0x0080)) {
                state = 36;
                continue;
              }
            }
          }
        case 100: {
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

  private _null() {
    this.value = new ast.NullValueNode();
    return Token.NULL;
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
