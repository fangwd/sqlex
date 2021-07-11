import {
  Statement,
  Node,
  InfixNode,
  PrefixNode,
  NameNode,
  FunctionCallNode,
  ListNode,
  StarNode,
} from './ast';
import * as util from './util';
import Position from './position';
type int = number;
type byte = number;
const new_any = (n: number) => {
  const array: any[] = [];
  for (let i = 0; i < n; i++) {
    array.push(null);
  }
  return array;
};

export const YYACCEPT: int = 0;
const YYABORT: int = 1;
export const YYPUSH_MORE: int = 4;
const YYERROR: int = 2;
const YYERRLAB: int = 3;
const YYNEWSTATE: int = 4;
const YYDEFAULT: int = 5;
const YYREDUCE: int = 6;
const YYERRLAB1: int = 7;
const YYGETTOKEN: int = 9;
function yyPactValueIsDefault(yyvalue: int): boolean {
  return yyvalue == yypact_ninf_;
}
function yyTableValueIsError(yyvalue: int): boolean {
  return yyvalue == yytable_ninf_;
}
const yypact_ninf_: byte = -4;
const yytable_ninf_: byte = -1;
const yypact_: byte[] = yypact_init();
function yypact_init(): byte[] {
  return [
    44, 44, -4, 44, 44, 44, -4, -4, -4, -2, -4, 7, -4, 64, -4, -4, 86, -4, -4,
    125, 38, -4, -4, 44, 44, 44, 44, 44, 44, 44, 44, 44, 44, 44, 44, 44, -4, -3,
    -4, -4, 0, 33, -4, 46, 46, -4, 30, 30, 30, 30, 30, 30, 114, 100, 125, -4,
    -4, 44, 0,
  ];
}
const yydefact_: byte[] = yydefact_init();
function yydefact_init(): byte[] {
  return [
    0, 0, 26, 0, 0, 0, 27, 28, 29, 25, 30, 0, 2, 3, 7, 24, 0, 18, 19, 20, 0, 31,
    1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 6, 32, 34, 0, 10, 8, 9, 11,
    13, 17, 16, 14, 12, 15, 21, 22, 23, 4, 33, 0, 35,
  ];
}
const yypgoto_: byte[] = yypgoto_init();
function yypgoto_init(): byte[] {
  return [-4, -4, -4, -1, -4, -4, -4, -4];
}
const yydefgoto_: byte[] = yydefgoto_init();
function yydefgoto_init(): byte[] {
  return [0, 11, 12, 13, 14, 15, 21, 41];
}
const yytable_: byte[] = yytable_init();
function yytable_init(): byte[] {
  return [
    16, 20, 17, 18, 19, 23, 24, 22, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35,
    40, 55, 0, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 23, 24, 56,
    25, 26, 57, 1, 39, 2, 3, 0, 4, 1, 0, 2, 3, 23, 4, 0, 0, 26, 58, 5, 6, 7, 8,
    9, 10, 5, 6, 7, 8, 9, 10, 23, 24, 0, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34,
    35, 0, 0, 0, 0, 36, 0, 37, 38, 23, 24, 0, 25, 26, 27, 28, 29, 30, 31, 32,
    33, 34, 35, 23, 24, 0, 25, 26, 27, 28, 29, 30, 31, 32, 33, 0, 35, 23, 24, 0,
    25, 26, 27, 28, 29, 30, 31, 32, 23, 24, 35, 25, 26, 27, 28, 29, 30, 31, 32,
  ];
}
const yycheck_: byte[] = yycheck_init();
function yycheck_init(): byte[] {
  return [
    1, 3, 3, 4, 5, 5, 6, 0, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 23,
    -1, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 5, 6, 4, 8, 9, 7, 3,
    4, 5, 6, -1, 8, 3, -1, 5, 6, 5, 8, -1, -1, 9, 57, 19, 20, 21, 22, 23, 24,
    19, 20, 21, 22, 23, 24, 5, 6, -1, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
    -1, -1, -1, -1, 23, -1, 25, 4, 5, 6, -1, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    17, 18, 5, 6, -1, 8, 9, 10, 11, 12, 13, 14, 15, 16, -1, 18, 5, 6, -1, 8, 9,
    10, 11, 12, 13, 14, 15, 5, 6, 18, 8, 9, 10, 11, 12, 13, 14, 15,
  ];
}
const yystos_: byte[] = yystos_init();
function yystos_init(): byte[] {
  return [
    0, 3, 5, 6, 8, 19, 20, 21, 22, 23, 24, 28, 29, 30, 31, 32, 30, 30, 30, 30,
    3, 33, 0, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 23, 25, 4, 4, 30,
    34, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 23, 4, 7, 30,
  ];
}
const yyr1_: byte[] = yyr1_init();
function yyr1_init(): byte[] {
  return [
    0, 27, 28, 29, 29, 29, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 31, 31, 31, 31, 32, 33, 33, 34, 34,
  ];
}
const yyr2_: byte[] = yyr2_init();
function yyr2_init(): byte[] {
  return [
    0, 2, 1, 1, 3, 2, 3, 1, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 3, 3, 3, 1,
    1, 1, 1, 1, 1, 1, 2, 2, 3, 1, 3,
  ];
}
const yyrline_: byte[] = yyrline_init();
function yyrline_init(): byte[] {
  return [
    0, 65, 65, 68, 69, 70, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86,
    87, 88, 89, 90, 91, 92, 93, 94, 98, 99, 100, 101, 105, 109, 110, 114, 115,
  ];
}
function yytranslate_(t: int): SymbolKind {
  var code_max: int = 281;
  if (t <= 0) return SymbolKind.S_YYEOF;
  else if (t <= code_max) return SymbolKind.get(yytranslate_table_[t]);
  else return SymbolKind.S_YYUNDEF;
}
const yytranslate_table_: byte[] = yytranslate_table_init();
function yytranslate_table_init(): byte[] {
  return [
    0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    2, 2, 2, 2, 2, 2, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
    18, 19, 20, 21, 22, 23, 24, 25, 26,
  ];
}
const YYLAST_: int = 140;
const YYEMPTY_: int = -2;
const YYFINAL_: int = 22;
const YYNTOKENS_: int = 27;
function i18n(s: String): String {
  return s;
}
export class Parser {
  yylloc_set(rhs: YYStack, n: int): Location {
    if (0 < n)
      return new Location(rhs.locationAt(n - 1).begin, rhs.locationAt(0).end);
    else return new Location(rhs.locationAt(0).end);
  }
  yylexer: Lexer;
  statement: Statement;
  constructor(yylexer: Lexer, statement: Statement) {
    this.yylexer = yylexer;
    this.statement = statement;
  }
  yyDebugStream: util.PrintStream = util.printStream;
  getDebugStream(): util.PrintStream {
    return this.yyDebugStream;
  }
  setDebugStream(s: util.PrintStream): void {
    this.yyDebugStream = s;
  }
  yydebug: int = 0;
  getDebugLevel(): int {
    return this.yydebug;
  }
  setDebugLevel(level: int): void {
    this.yydebug = level;
  }
  yynerrs: int = 0;
  getNumberOfErrors(): int {
    return this.yynerrs;
  }
  yyerror(msg: String): void {
    this.yylexer.yyerror(null as any, msg);
  }
  yyerror_1(loc: Location, msg: String): void {
    this.yylexer.yyerror(loc, msg);
  }
  yyerror_2(pos: Position, msg: String): void {
    this.yylexer.yyerror(new Location(pos), msg);
  }
  yycdebug(s: String): void {
    if (0 < this.yydebug) this.yyDebugStream.println(s);
  }
  yyerrstatus_: int = 0;
  yychar: int = YYEMPTY_;
  yytoken: SymbolKind = null as any;
  yyn: int = 0;
  yylen: int = 0;
  yystate: int = 0;
  yystack: YYStack = new YYStack();
  label: int = YYNEWSTATE;
  yyerrloc: Location = null as any;
  yylloc: Location = new Location(null as any, null as any);
  yylval: Node = null as any;
  recovering(): boolean {
    return this.yyerrstatus_ == 0;
  }
  yyLRGotoState(yystate: int, yysym: int): int {
    var yyr: int = yypgoto_[yysym - YYNTOKENS_] + yystate;
    if (0 <= yyr && yyr <= YYLAST_ && yycheck_[yyr] == yystate)
      return yytable_[yyr];
    else return yydefgoto_[yysym - YYNTOKENS_];
  }
  yyaction(yyn: int, yystack: YYStack, yylen: int): int {
    var yyval: Node =
      0 < yylen ? this.yystack.valueAt(yylen - 1) : this.yystack.valueAt(0);
    var yyloc: Location = this.yylloc_set(yystack, yylen);
    this.yyReducePrint(yyn, yystack);
    switch (yyn) {
      case 2:
        if (yyn == 2) {
          this.statement.node = this.yystack.valueAt(0);
        }
        break;
      case 4:
        if (yyn == 4) {
          yyval = this.yystack.valueAt(2);
          yyval.alias = (this.yystack.valueAt(0) as NameNode).name;
        }
        break;
      case 5:
        if (yyn == 5) {
          yyval = this.yystack.valueAt(1);
          yyval.alias = (this.yystack.valueAt(0) as NameNode).name;
        }
        break;
      case 6:
        if (yyn == 6) {
          yyval = this.yystack.valueAt(1);
          yyval.brackets = true;
        }
        break;
      case 7:
        if (yyn == 7) {
          yyval = this.yystack.valueAt(0);
        }
        break;
      case 8:
        if (yyn == 8) {
          yyval = new InfixNode(
            this.yystack.valueAt(2),
            '+',
            this.yystack.valueAt(0)
          );
        }
        break;
      case 9:
        if (yyn == 9) {
          yyval = new InfixNode(
            this.yystack.valueAt(2),
            '-',
            this.yystack.valueAt(0)
          );
        }
        break;
      case 10:
        if (yyn == 10) {
          yyval = new InfixNode(
            this.yystack.valueAt(2),
            '*',
            this.yystack.valueAt(0)
          );
        }
        break;
      case 11:
        if (yyn == 11) {
          yyval = new InfixNode(
            this.yystack.valueAt(2),
            '/',
            this.yystack.valueAt(0)
          );
        }
        break;
      case 12:
        if (yyn == 12) {
          yyval = new InfixNode(
            this.yystack.valueAt(2),
            '<>',
            this.yystack.valueAt(0)
          );
        }
        break;
      case 13:
        if (yyn == 13) {
          yyval = new InfixNode(
            this.yystack.valueAt(2),
            '<',
            this.yystack.valueAt(0)
          );
        }
        break;
      case 14:
        if (yyn == 14) {
          yyval = new InfixNode(
            this.yystack.valueAt(2),
            '<=',
            this.yystack.valueAt(0)
          );
        }
        break;
      case 15:
        if (yyn == 15) {
          yyval = new InfixNode(
            this.yystack.valueAt(2),
            '>=',
            this.yystack.valueAt(0)
          );
        }
        break;
      case 16:
        if (yyn == 16) {
          yyval = new InfixNode(
            this.yystack.valueAt(2),
            '>',
            this.yystack.valueAt(0)
          );
        }
        break;
      case 17:
        if (yyn == 17) {
          yyval = new InfixNode(
            this.yystack.valueAt(2),
            '=',
            this.yystack.valueAt(0)
          );
        }
        break;
      case 18:
        if (yyn == 18) {
          yyval = new PrefixNode('+', this.yystack.valueAt(0));
        }
        break;
      case 19:
        if (yyn == 19) {
          yyval = new PrefixNode('-', this.yystack.valueAt(0));
        }
        break;
      case 20:
        if (yyn == 20) {
          yyval = new PrefixNode('not', this.yystack.valueAt(0));
        }
        break;
      case 21:
        if (yyn == 21) {
          yyval = new InfixNode(
            this.yystack.valueAt(2),
            'and',
            this.yystack.valueAt(0)
          );
        }
        break;
      case 22:
        if (yyn == 22) {
          yyval = new InfixNode(
            this.yystack.valueAt(2),
            'or',
            this.yystack.valueAt(0)
          );
        }
        break;
      case 23:
        if (yyn == 23) {
          yyval = new InfixNode(
            this.yystack.valueAt(2),
            'is',
            this.yystack.valueAt(0)
          );
        }
        break;
      case 24:
        if (yyn == 24) {
          yyval = this.yystack.valueAt(0);
        }
        break;
      case 25:
        if (yyn == 25) {
          yyval = this.yystack.valueAt(0);
        }
        break;
      case 26:
        if (yyn == 26) {
          yyval = new StarNode();
        }
        break;
      case 27:
        if (yyn == 27) {
          yyval = this.yystack.valueAt(0);
        }
        break;
      case 28:
        if (yyn == 28) {
          yyval = this.yystack.valueAt(0);
        }
        break;
      case 29:
        if (yyn == 29) {
          yyval = this.yystack.valueAt(0);
        }
        break;
      case 30:
        if (yyn == 30) {
          yyval = this.yystack.valueAt(0);
        }
        break;
      case 31:
        if (yyn == 31) {
          yyval = new FunctionCallNode(
            this.yystack.valueAt(1) as NameNode,
            this.yystack.valueAt(0) as ListNode
          );
        }
        break;
      case 32:
        if (yyn == 32) {
          yyval = new ListNode();
        }
        break;
      case 33:
        if (yyn == 33) {
          yyval = this.yystack.valueAt(1);
        }
        break;
      case 34:
        if (yyn == 34) {
          yyval = new ListNode(this.yystack.valueAt(0));
        }
        break;
      case 35:
        if (yyn == 35) {
          yyval = this.yystack.valueAt(2);
          (yyval as ListNode).push(this.yystack.valueAt(0));
        }
        break;
      default:
        break;
    }
    this.yySymbolPrint('-> $$ =', SymbolKind.get(yyr1_[yyn]), yyval, yyloc);
    this.yystack.pop_1(yylen);
    yylen = 0;
    var yystate: int = this.yyLRGotoState(this.yystack.stateAt(0), yyr1_[yyn]);
    this.yystack.push(yystate, yyval, yyloc);
    return YYNEWSTATE;
  }
  yySymbolPrint(
    s: String,
    yykind: SymbolKind,
    yyvalue: Node,
    yylocation: Location
  ): void {
    if (0 < this.yydebug) {
      this.yycdebug(
        s +
          (yykind.getCode() < YYNTOKENS_ ? ' token ' : ' nterm ') +
          yykind.getName() +
          ' (' +
          yylocation +
          ': ' +
          (yyvalue == (null as any) ? '(null)' : yyvalue.toString()) +
          ')'
      );
    }
  }
  push_parse(yylextoken: int, yylexval: Node, yylexloc: Location): int {
    var yyloc: Location;
    if (!this.push_parse_initialized) {
      this.push_parse_initialize();
      this.yycdebug('Starting parse');
      this.yyerrstatus_ = 0;
    } else this.label = YYGETTOKEN;
    var push_token_consumed: boolean = true;
    for (;;)
      switch (this.label) {
        case YYNEWSTATE:
          this.yycdebug('Entering state ' + this.yystate);
          if (0 < this.yydebug) this.yystack.print(this.yyDebugStream);
          if (this.yystate == YYFINAL_) {
            this.label = YYACCEPT;
            break;
          }
          this.yyn = yypact_[this.yystate];
          if (yyPactValueIsDefault(this.yyn)) {
            this.label = YYDEFAULT;
            break;
          }
        case YYGETTOKEN:
          if (this.yychar == YYEMPTY_) {
            if (!push_token_consumed) return YYPUSH_MORE;
            this.yycdebug('Reading a token');
            this.yychar = yylextoken;
            this.yylval = yylexval;
            this.yylloc = yylexloc;
            push_token_consumed = false;
          }
          this.yytoken = yytranslate_(this.yychar);
          this.yySymbolPrint(
            'Next token is',
            this.yytoken,
            this.yylval,
            this.yylloc
          );
          if (this.yytoken == SymbolKind.S_YYerror) {
            this.yychar = YYUNDEF;
            this.yytoken = SymbolKind.S_YYUNDEF;
            this.yyerrloc = this.yylloc;
            this.label = YYERRLAB1;
          } else {
            this.yyn += this.yytoken.getCode();
            if (
              this.yyn < 0 ||
              YYLAST_ < this.yyn ||
              yycheck_[this.yyn] != this.yytoken.getCode()
            )
              this.label = YYDEFAULT;
            else if ((this.yyn = yytable_[this.yyn]) <= 0) {
              if (yyTableValueIsError(this.yyn)) this.label = YYERRLAB;
              else {
                this.yyn = -this.yyn;
                this.label = YYREDUCE;
              }
            } else {
              this.yySymbolPrint(
                'Shifting',
                this.yytoken,
                this.yylval,
                this.yylloc
              );
              this.yychar = YYEMPTY_;
              if (this.yyerrstatus_ > 0) --this.yyerrstatus_;
              this.yystate = this.yyn;
              this.yystack.push(this.yystate, this.yylval, this.yylloc);
              this.label = YYNEWSTATE;
            }
          }
          break;
        case YYDEFAULT:
          this.yyn = yydefact_[this.yystate];
          if (this.yyn == 0) this.label = YYERRLAB;
          else this.label = YYREDUCE;
          break;
        case YYREDUCE:
          this.yylen = yyr2_[this.yyn];
          this.label = this.yyaction(this.yyn, this.yystack, this.yylen);
          this.yystate = this.yystack.stateAt(0);
          break;
        case YYERRLAB:
          if (this.yyerrstatus_ == 0) {
            ++this.yynerrs;
            if (this.yychar == YYEMPTY_) this.yytoken = null as any;
            this.yyreportSyntaxError(
              new Context(this.yystack, this.yytoken, this.yylloc)
            );
          }
          this.yyerrloc = this.yylloc;
          if (this.yyerrstatus_ == 3) {
            if (this.yychar <= YYEOF) {
              if (this.yychar == YYEOF) {
                this.label = YYABORT;
                break;
              }
            } else this.yychar = YYEMPTY_;
          }
          this.label = YYERRLAB1;
          break;
        case YYERROR:
          this.yyerrloc = this.yystack.locationAt(this.yylen - 1);
          this.yystack.pop_1(this.yylen);
          this.yylen = 0;
          this.yystate = this.yystack.stateAt(0);
          this.label = YYERRLAB1;
          break;
        case YYERRLAB1:
          this.yyerrstatus_ = 3;
          for (;;) {
            this.yyn = yypact_[this.yystate];
            if (!yyPactValueIsDefault(this.yyn)) {
              this.yyn += SymbolKind.S_YYerror.getCode();
              if (
                0 <= this.yyn &&
                this.yyn <= YYLAST_ &&
                yycheck_[this.yyn] == SymbolKind.S_YYerror.getCode()
              ) {
                this.yyn = yytable_[this.yyn];
                if (0 < this.yyn) break;
              }
            }
            if (this.yystack.height == 0) {
              this.label = YYABORT;
              break;
            }
            this.yyerrloc = this.yystack.locationAt(0);
            this.yystack.pop();
            this.yystate = this.yystack.stateAt(0);
            if (0 < this.yydebug) this.yystack.print(this.yyDebugStream);
          }
          if (this.label == YYABORT) break;
          this.yystack.push(0, null as any, this.yylloc);
          this.yystack.push(0, null as any, this.yyerrloc);
          yyloc = this.yylloc_set(this.yystack, 2);
          this.yystack.pop_1(2);
          this.yySymbolPrint(
            'Shifting',
            SymbolKind.get(yystos_[this.yyn]),
            this.yylval,
            yyloc
          );
          this.yystate = this.yyn;
          this.yystack.push(this.yyn, this.yylval, yyloc);
          this.label = YYNEWSTATE;
          break;
        case YYACCEPT:
          this.push_parse_initialized = false;
          return YYACCEPT;
        case YYABORT:
          this.push_parse_initialized = false;
          return YYABORT;
      }
  }
  push_parse_initialized: boolean = false;
  push_parse_initialize(): void {
    this.yychar = YYEMPTY_;
    this.yytoken = null as any;
    this.yyn = 0;
    this.yylen = 0;
    this.yystate = 0;
    this.yystack = new YYStack();
    this.label = YYNEWSTATE;
    this.yynerrs = 0;
    this.yyerrloc = null as any;
    this.yylloc = new Location(null as any, null as any);
    this.yylval = null as any;
    this.yystack.push(this.yystate, this.yylval, this.yylloc);
    this.push_parse_initialized = true;
  }
  push_parse_1(yylextoken: int, yylexval: Node, yylexpos: Position): int {
    return this.push_parse(yylextoken, yylexval, new Location(yylexpos));
  }
  yyreportSyntaxError(yyctx: Context): void {
    this.yylexer.reportSyntaxError(yyctx);
  }
  yyReducePrint(yyrule: int, yystack: YYStack): void {
    if (this.yydebug == 0) return;
    var yylno: int = yyrline_[yyrule];
    var yynrhs: int = yyr2_[yyrule];
    this.yycdebug(
      'Reducing stack by rule ' + (yyrule - 1) + ' (line ' + yylno + '):'
    );
    for (let yyi: int = 0; yyi < yynrhs; yyi++)
      this.yySymbolPrint(
        '   $' + (yyi + 1) + ' =',
        SymbolKind.get(yystos_[this.yystack.stateAt(yynrhs - (yyi + 1))]),
        this.yystack.valueAt(yynrhs - (yyi + 1)),
        this.yystack.locationAt(yynrhs - (yyi + 1))
      );
  }
}
export class Location {
  constructor(...args: any[]) {
    if (
      args.length === 1 &&
      (args[0] instanceof Position || args[0] === null)
    ) {
      this.constructor_0(args[0] as Position);
    } else if (
      args.length === 2 &&
      (args[0] instanceof Position || args[0] === null) &&
      (args[1] instanceof Position || args[1] === null)
    ) {
      this.constructor_1(args[0] as Position, args[1] as Position);
    } else throw Error('Unknown type(s)');
  }
  begin!: Position;
  end!: Position;
  constructor_0(loc: Position) {
    this.begin = this.end = loc;
  }
  constructor_1(begin: Position, end: Position) {
    this.begin = begin;
    this.end = end;
  }
  toString(): String {
    if (this.begin.equals(this.end)) return this.begin.toString();
    else return this.begin.toString() + '-' + this.end.toString();
  }
}
class SymbolKind {
  static S_YYEOF: SymbolKind = new SymbolKind(0);
  static S_YYerror: SymbolKind = new SymbolKind(1);
  static S_YYUNDEF: SymbolKind = new SymbolKind(2);
  static S_LPAREN: SymbolKind = new SymbolKind(3);
  static S_RPAREN: SymbolKind = new SymbolKind(4);
  static S_MUL: SymbolKind = new SymbolKind(5);
  static S_PLUS: SymbolKind = new SymbolKind(6);
  static S_COMMA: SymbolKind = new SymbolKind(7);
  static S_MINUS: SymbolKind = new SymbolKind(8);
  static S_DIV: SymbolKind = new SymbolKind(9);
  static S_LT: SymbolKind = new SymbolKind(10);
  static S_EQ: SymbolKind = new SymbolKind(11);
  static S_GT: SymbolKind = new SymbolKind(12);
  static S_LE: SymbolKind = new SymbolKind(13);
  static S_NE: SymbolKind = new SymbolKind(14);
  static S_GE: SymbolKind = new SymbolKind(15);
  static S_AND: SymbolKind = new SymbolKind(16);
  static S_OR: SymbolKind = new SymbolKind(17);
  static S_IS: SymbolKind = new SymbolKind(18);
  static S_NOT: SymbolKind = new SymbolKind(19);
  static S_LOGICAL: SymbolKind = new SymbolKind(20);
  static S_NUMBER: SymbolKind = new SymbolKind(21);
  static S_STRING: SymbolKind = new SymbolKind(22);
  static S_NAME: SymbolKind = new SymbolKind(23);
  static S_NULL: SymbolKind = new SymbolKind(24);
  static S_AS: SymbolKind = new SymbolKind(25);
  static S_NEG: SymbolKind = new SymbolKind(26);
  static S_YYACCEPT: SymbolKind = new SymbolKind(27);
  static S_start: SymbolKind = new SymbolKind(28);
  static S_statement: SymbolKind = new SymbolKind(29);
  static S_expression: SymbolKind = new SymbolKind(30);
  static S_constant: SymbolKind = new SymbolKind(31);
  static S_function_call: SymbolKind = new SymbolKind(32);
  static S_argument_list: SymbolKind = new SymbolKind(33);
  static S_non_empty_argument_list: SymbolKind = new SymbolKind(34);
  yycode_: int;
  constructor(n: int) {
    this.yycode_ = n;
  }
  static values_: SymbolKind[] = [
    SymbolKind.S_YYEOF,
    SymbolKind.S_YYerror,
    SymbolKind.S_YYUNDEF,
    SymbolKind.S_LPAREN,
    SymbolKind.S_RPAREN,
    SymbolKind.S_MUL,
    SymbolKind.S_PLUS,
    SymbolKind.S_COMMA,
    SymbolKind.S_MINUS,
    SymbolKind.S_DIV,
    SymbolKind.S_LT,
    SymbolKind.S_EQ,
    SymbolKind.S_GT,
    SymbolKind.S_LE,
    SymbolKind.S_NE,
    SymbolKind.S_GE,
    SymbolKind.S_AND,
    SymbolKind.S_OR,
    SymbolKind.S_IS,
    SymbolKind.S_NOT,
    SymbolKind.S_LOGICAL,
    SymbolKind.S_NUMBER,
    SymbolKind.S_STRING,
    SymbolKind.S_NAME,
    SymbolKind.S_NULL,
    SymbolKind.S_AS,
    SymbolKind.S_NEG,
    SymbolKind.S_YYACCEPT,
    SymbolKind.S_start,
    SymbolKind.S_statement,
    SymbolKind.S_expression,
    SymbolKind.S_constant,
    SymbolKind.S_function_call,
    SymbolKind.S_argument_list,
    SymbolKind.S_non_empty_argument_list,
  ];
  static get(code: int): SymbolKind {
    return SymbolKind.values_[code];
  }
  getCode(): int {
    return this.yycode_;
  }
  static yynames_: String[] = SymbolKind.yynames_init();
  static yynames_init(): String[] {
    return [
      i18n('end of file'),
      i18n('error'),
      i18n('invalid token'),
      '(',
      ')',
      '*',
      '+',
      ',',
      '-',
      '/',
      '<',
      '=',
      '>',
      '<=',
      '<>',
      '>=',
      'and',
      'or',
      'is',
      'not',
      i18n('logical constant'),
      i18n('numeric constant'),
      i18n('string constant'),
      i18n('name'),
      i18n('null'),
      'AS',
      'NEG',
      '$accept',
      'start',
      'statement',
      'expression',
      'constant',
      'function_call',
      'argument_list',
      'non_empty_argument_list',
      null as any,
    ];
  }
  getName(): String {
    return SymbolKind.yynames_[this.yycode_];
  }
}
export const YYEOF: int = 0;
export const YYerror: int = 256;
export const YYUNDEF: int = 257;
export const LPAREN: int = 258;
export const RPAREN: int = 259;
export const MUL: int = 260;
export const PLUS: int = 261;
export const COMMA: int = 262;
export const MINUS: int = 263;
export const DIV: int = 264;
export const LT: int = 265;
export const EQ: int = 266;
export const GT: int = 267;
export const LE: int = 268;
export const NE: int = 269;
export const GE: int = 270;
export const AND: int = 271;
export const OR: int = 272;
export const IS: int = 273;
export const NOT: int = 274;
export const LOGICAL: int = 275;
export const NUMBER: int = 276;
export const STRING: int = 277;
export const NAME: int = 278;
export const NULL: int = 279;
export const AS: int = 280;
export const NEG: int = 281;
export const EOF: int = YYEOF;
export interface Lexer {
  yyerror(loc: Location, msg: String): void;
  reportSyntaxError(ctx: Context): void;
}
class YYStack {
  stateStack: int[] = new_any(16);
  locStack: Location[] = new_any(16);
  valueStack: Node[] = new_any(16);
  size: int = 16;
  height: int = -1;
  push(state: int, value: Node, loc: Location): void {
    this.height++;
    if (this.size == this.height) {
      var newStateStack: int[] = new_any(this.size * 2);
      util.arraycopy(this.stateStack, 0, newStateStack, 0, this.height);
      this.stateStack = newStateStack;
      var newLocStack: Location[] = new_any(this.size * 2);
      util.arraycopy(this.locStack, 0, newLocStack, 0, this.height);
      this.locStack = newLocStack;
      var newValueStack: Node[] = new_any(this.size * 2);
      util.arraycopy(this.valueStack, 0, newValueStack, 0, this.height);
      this.valueStack = newValueStack;
      this.size *= 2;
    }
    this.stateStack[this.height] = state;
    this.locStack[this.height] = loc;
    this.valueStack[this.height] = value;
  }
  pop(): void {
    this.pop_1(1);
  }
  pop_1(num: int): void {
    if (0 < num) {
      util.fill(
        this.valueStack,
        this.height - num + 1,
        this.height + 1,
        null as any
      );
      util.fill(
        this.locStack,
        this.height - num + 1,
        this.height + 1,
        null as any
      );
    }
    this.height -= num;
  }
  stateAt(i: int): int {
    return this.stateStack[this.height - i];
  }
  locationAt(i: int): Location {
    return this.locStack[this.height - i];
  }
  valueAt(i: int): Node {
    return this.valueStack[this.height - i];
  }
  print(out: util.PrintStream): void {
    out.print('Stack now');
    for (let i: int = 0; i <= this.height; i++) {
      out.print(' ');
      out.print(this.stateStack[i]);
    }
    out.println();
  }
}
const NTOKENS: int = YYNTOKENS_;
export class Context {
  constructor(stack: YYStack, token: SymbolKind, loc: Location) {
    this.yystack = stack;
    this.yytoken = token;
    this.yylocation = loc;
  }
  yystack: YYStack;
  getToken(): SymbolKind {
    return this.yytoken;
  }
  yytoken: SymbolKind;
  getLocation(): Location {
    return this.yylocation;
  }
  yylocation: Location;
  getExpectedTokens(yyarg: SymbolKind[], yyargn: int): int {
    return this.getExpectedTokens_1(yyarg, 0, yyargn);
  }
  getExpectedTokens_1(yyarg: SymbolKind[], yyoffset: int, yyargn: int): int {
    var yycount: int = yyoffset;
    var yyn: int = yypact_[this.yystack.stateAt(0)];
    if (!yyPactValueIsDefault(yyn)) {
      var yyxbegin: int = yyn < 0 ? -yyn : 0;
      var yychecklim: int = YYLAST_ - yyn + 1;
      var yyxend: int = yychecklim < NTOKENS ? yychecklim : NTOKENS;
      for (let yyx: int = yyxbegin; yyx < yyxend; ++yyx)
        if (
          yycheck_[yyx + yyn] == yyx &&
          yyx != SymbolKind.S_YYerror.getCode() &&
          !yyTableValueIsError(yytable_[yyx + yyn])
        ) {
          if (yyarg == (null as any)) yycount += 1;
          else if (yycount == yyargn) return 0;
          else yyarg[yycount++] = SymbolKind.get(yyx);
        }
    }
    if (yyarg != (null as any) && yycount == yyoffset && yyoffset < yyargn)
      yyarg[yycount] = null as any;
    return yycount - yyoffset;
  }
}
