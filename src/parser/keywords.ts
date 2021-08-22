export type Dialect = 'sqlite' | 'mysql' | 'postgres' | 'mssql' | 'oracle';

export const dialectMap = {
  sqlite: 1,
  mysql: 2,
  postgres: 4,
  mssql: 8,
  oracle: 16,
};

export const keywordMap: { [key: string]: number } = {
  ABORT: 1, // sqlite
  ACCESS: 16, // oracle
  ACCESSIBLE: 2, // mysql
  ACTION: 1, // sqlite
  ADD: 27, // mysql, oracle, mssql, sqlite
  AFTER: 1, // sqlite
  ALL: 31, // mysql, oracle, postgres, mssql, sqlite
  ALTER: 27, // mysql, oracle, mssql, sqlite
  ALWAYS: 1, // sqlite
  ANALYSE: 4, // postgres
  ANALYZE: 7, // mysql, postgres, sqlite
  AND: 31, // mysql, oracle, postgres, mssql, sqlite
  ANY: 28, // oracle, postgres, mssql
  ARRAY: 4, // postgres
  AS: 31, // mysql, oracle, postgres, mssql, sqlite
  ASC: 31, // mysql, oracle, postgres, mssql, sqlite
  ASENSITIVE: 2, // mysql
  ASYMMETRIC: 4, // postgres
  ATTACH: 1, // sqlite
  AUDIT: 16, // oracle
  AUTHORIZATION: 12, // postgres, mssql
  AUTOINCREMENT: 1, // sqlite
  BACKUP: 8, // mssql
  BEFORE: 3, // mysql, sqlite
  BEGIN: 9, // mssql, sqlite
  BETWEEN: 27, // mysql, oracle, mssql, sqlite
  BIGINT: 2, // mysql
  BINARY: 6, // mysql, postgres
  BLOB: 2, // mysql
  BOTH: 6, // mysql, postgres
  BREAK: 8, // mssql
  BROWSE: 8, // mssql
  BULK: 8, // mssql
  BY: 27, // mysql, oracle, mssql, sqlite
  CALL: 2, // mysql
  CASCADE: 11, // mysql, mssql, sqlite
  CASE: 15, // mysql, postgres, mssql, sqlite
  CAST: 5, // postgres, sqlite
  CHANGE: 2, // mysql
  CHAR: 18, // mysql, oracle
  CHARACTER: 2, // mysql
  CHECK: 31, // mysql, oracle, postgres, mssql, sqlite
  CHECKPOINT: 8, // mssql
  CLOSE: 8, // mssql
  CLUSTER: 16, // oracle
  CLUSTERED: 8, // mssql
  COALESCE: 8, // mssql
  COLLATE: 15, // mysql, postgres, mssql, sqlite
  COLLATION: 4, // postgres
  COLUMN: 31, // mysql, oracle, postgres, mssql, sqlite
  COLUMN_VALUE: 16, // oracle
  COMMENT: 16, // oracle
  COMMIT: 9, // mssql, sqlite
  COMPRESS: 16, // oracle
  COMPUTE: 8, // mssql
  CONCURRENTLY: 4, // postgres
  CONDITION: 2, // mysql
  CONFLICT: 1, // sqlite
  CONNECT: 16, // oracle
  CONSTRAINT: 15, // mysql, postgres, mssql, sqlite
  CONTAINS: 8, // mssql
  CONTAINSTABLE: 8, // mssql
  CONTINUE: 10, // mysql, mssql
  CONVERT: 10, // mysql, mssql
  CREATE: 31, // mysql, oracle, postgres, mssql, sqlite
  CROSS: 15, // mysql, postgres, mssql, sqlite
  CUBE: 2, // mysql
  CUME_DIST: 2, // mysql
  CURRENT: 25, // oracle, mssql, sqlite
  CURRENT_CATALOG: 4, // postgres
  CURRENT_DATE: 15, // mysql, postgres, mssql, sqlite
  CURRENT_ROLE: 4, // postgres
  CURRENT_SCHEMA: 4, // postgres
  CURRENT_TIME: 15, // mysql, postgres, mssql, sqlite
  CURRENT_TIMESTAMP: 15, // mysql, postgres, mssql, sqlite
  CURRENT_USER: 14, // mysql, postgres, mssql
  CURSOR: 10, // mysql, mssql
  DATABASE: 11, // mysql, mssql, sqlite
  DATABASES: 2, // mysql
  DATE: 16, // oracle
  DAY_HOUR: 2, // mysql
  DAY_MICROSECOND: 2, // mysql
  DAY_MINUTE: 2, // mysql
  DAY_SECOND: 2, // mysql
  DBCC: 8, // mssql
  DEALLOCATE: 8, // mssql
  DEC: 2, // mysql
  DECIMAL: 18, // mysql, oracle
  DECLARE: 10, // mysql, mssql
  DEFAULT: 31, // mysql, oracle, postgres, mssql, sqlite
  DEFERRABLE: 5, // postgres, sqlite
  DEFERRED: 1, // sqlite
  DELAYED: 2, // mysql
  DELETE: 27, // mysql, oracle, mssql, sqlite
  DENSE_RANK: 2, // mysql
  DENY: 8, // mssql
  DESC: 31, // mysql, oracle, postgres, mssql, sqlite
  DESCRIBE: 2, // mysql
  DETACH: 1, // sqlite
  DETERMINISTIC: 2, // mysql
  DISK: 8, // mssql
  DISTINCT: 31, // mysql, oracle, postgres, mssql, sqlite
  DISTINCTROW: 2, // mysql
  DISTRIBUTED: 8, // mssql
  DIV: 2, // mysql
  DO: 5, // postgres, sqlite
  DOUBLE: 10, // mysql, mssql
  DROP: 27, // mysql, oracle, mssql, sqlite
  DUAL: 2, // mysql
  DUMP: 8, // mssql
  EACH: 3, // mysql, sqlite
  ELSE: 31, // mysql, oracle, postgres, mssql, sqlite
  ELSEIF: 2, // mysql
  EMPTY: 2, // mysql
  ENCLOSED: 2, // mysql
  END: 13, // postgres, mssql, sqlite
  ERRLVL: 8, // mssql
  ESCAPE: 9, // mssql, sqlite
  ESCAPED: 2, // mysql
  EXCEPT: 15, // mysql, postgres, mssql, sqlite
  EXCLUDE: 1, // sqlite
  EXCLUSIVE: 17, // oracle, sqlite
  EXEC: 8, // mssql
  EXECUTE: 8, // mssql
  EXISTS: 27, // mysql, oracle, mssql, sqlite
  EXIT: 10, // mysql, mssql
  EXPLAIN: 3, // mysql, sqlite
  EXTERNAL: 8, // mssql
  FAIL: 1, // sqlite
  FALSE: 6, // mysql, postgres
  FETCH: 14, // mysql, postgres, mssql
  FILE: 24, // oracle, mssql
  FILLFACTOR: 8, // mssql
  FILTER: 1, // sqlite
  FIRST: 1, // sqlite
  FIRST_VALUE: 2, // mysql
  FLOAT: 18, // mysql, oracle
  FLOAT4: 2, // mysql
  FLOAT8: 2, // mysql
  FOLLOWING: 1, // sqlite
  FOR: 31, // mysql, oracle, postgres, mssql, sqlite
  FORCE: 2, // mysql
  FOREIGN: 15, // mysql, postgres, mssql, sqlite
  FREETEXT: 8, // mssql
  FREETEXTTABLE: 8, // mssql
  FREEZE: 4, // postgres
  FROM: 31, // mysql, oracle, postgres, mssql, sqlite
  FULL: 13, // postgres, mssql, sqlite
  FULLTEXT: 2, // mysql
  FUNCTION: 10, // mysql, mssql
  GENERATED: 3, // mysql, sqlite
  GET: 2, // mysql
  GLOB: 1, // sqlite
  GOTO: 8, // mssql
  GRANT: 30, // mysql, oracle, postgres, mssql
  GROUP: 31, // mysql, oracle, postgres, mssql, sqlite
  GROUPING: 2, // mysql
  GROUPS: 3, // mysql, sqlite
  HAVING: 31, // mysql, oracle, postgres, mssql, sqlite
  HIGH_PRIORITY: 2, // mysql
  HOLDLOCK: 8, // mssql
  HOUR_MICROSECOND: 2, // mysql
  HOUR_MINUTE: 2, // mysql
  HOUR_SECOND: 2, // mysql
  IDENTIFIED: 16, // oracle
  IDENTITY: 8, // mssql
  IDENTITYCOL: 8, // mssql
  IDENTITY_INSERT: 8, // mssql
  IF: 11, // mysql, mssql, sqlite
  IGNORE: 3, // mysql, sqlite
  ILIKE: 4, // postgres
  IMMEDIATE: 17, // oracle, sqlite
  IN: 31, // mysql, oracle, postgres, mssql, sqlite
  INCREMENT: 16, // oracle
  INDEX: 27, // mysql, oracle, mssql, sqlite
  INDEXED: 1, // sqlite
  INFILE: 2, // mysql
  INITIAL: 16, // oracle
  INITIALLY: 5, // postgres, sqlite
  INNER: 15, // mysql, postgres, mssql, sqlite
  INOUT: 2, // mysql
  INSENSITIVE: 2, // mysql
  INSERT: 27, // mysql, oracle, mssql, sqlite
  INSTEAD: 1, // sqlite
  INT: 2, // mysql
  INT1: 2, // mysql
  INT2: 2, // mysql
  INT3: 2, // mysql
  INT4: 2, // mysql
  INT8: 2, // mysql
  INTEGER: 18, // mysql, oracle
  INTERSECT: 29, // oracle, postgres, mssql, sqlite
  INTERVAL: 2, // mysql
  INTO: 31, // mysql, oracle, postgres, mssql, sqlite
  IO_AFTER_GTIDS: 2, // mysql
  IO_BEFORE_GTIDS: 2, // mysql
  IS: 31, // mysql, oracle, postgres, mssql, sqlite
  ISNULL: 5, // postgres, sqlite
  ITERATE: 2, // mysql
  JOIN: 15, // mysql, postgres, mssql, sqlite
  JSON_TABLE: 2, // mysql
  KEY: 11, // mysql, mssql, sqlite
  KEYS: 2, // mysql
  KILL: 10, // mysql, mssql
  LAG: 2, // mysql
  LAST: 1, // sqlite
  LAST_VALUE: 2, // mysql
  LATERAL: 6, // mysql, postgres
  LEAD: 2, // mysql
  LEADING: 6, // mysql, postgres
  LEAVE: 2, // mysql
  LEFT: 15, // mysql, postgres, mssql, sqlite
  LEVEL: 16, // oracle
  LIKE: 31, // mysql, oracle, postgres, mssql, sqlite
  LIMIT: 7, // mysql, postgres, sqlite
  LINEAR: 2, // mysql
  LINENO: 8, // mssql
  LINES: 2, // mysql
  LOAD: 10, // mysql, mssql
  LOCALTIME: 6, // mysql, postgres
  LOCALTIMESTAMP: 6, // mysql, postgres
  LOCK: 18, // mysql, oracle
  LONG: 18, // mysql, oracle
  LONGBLOB: 2, // mysql
  LONGTEXT: 2, // mysql
  LOOP: 2, // mysql
  LOW_PRIORITY: 2, // mysql
  MASTER_BIND: 2, // mysql
  MASTER_SSL_VERIFY_SERVER_CERT: 2, // mysql
  MATCH: 3, // mysql, sqlite
  MATERIALIZED: 1, // sqlite
  MAXEXTENTS: 16, // oracle
  MAXVALUE: 2, // mysql
  MEDIUMBLOB: 2, // mysql
  MEDIUMINT: 2, // mysql
  MEDIUMTEXT: 2, // mysql
  MERGE: 8, // mssql
  MIDDLEINT: 2, // mysql
  MINUS: 16, // oracle
  MINUTE_MICROSECOND: 2, // mysql
  MINUTE_SECOND: 2, // mysql
  MLSLABEL: 16, // oracle
  MOD: 2, // mysql
  MODE: 16, // oracle
  MODIFIES: 2, // mysql
  MODIFY: 16, // oracle
  NATIONAL: 8, // mssql
  NATURAL: 7, // mysql, postgres, sqlite
  NESTED_TABLE_ID: 16, // oracle
  NO: 1, // sqlite
  NOAUDIT: 16, // oracle
  NOCHECK: 8, // mssql
  NOCOMPRESS: 16, // oracle
  NONCLUSTERED: 8, // mssql
  NOT: 31, // mysql, oracle, postgres, mssql, sqlite
  NOTHING: 1, // sqlite
  NOTNULL: 5, // postgres, sqlite
  NOWAIT: 16, // oracle
  NO_WRITE_TO_BINLOG: 2, // mysql
  NTH_VALUE: 2, // mysql
  NTILE: 2, // mysql
  NULL: 31, // mysql, oracle, postgres, mssql, sqlite
  NULLIF: 8, // mssql
  NULLS: 1, // sqlite
  NUMBER: 16, // oracle
  NUMERIC: 2, // mysql
  OF: 27, // mysql, oracle, mssql, sqlite
  OFF: 8, // mssql
  OFFLINE: 16, // oracle
  OFFSET: 5, // postgres, sqlite
  OFFSETS: 8, // mssql
  ON: 31, // mysql, oracle, postgres, mssql, sqlite
  ONLINE: 16, // oracle
  ONLY: 4, // postgres
  OPEN: 8, // mssql
  OPENDATASOURCE: 8, // mssql
  OPENQUERY: 8, // mssql
  OPENROWSET: 8, // mssql
  OPENXML: 8, // mssql
  OPTIMIZE: 2, // mysql
  OPTIMIZER_COSTS: 2, // mysql
  OPTION: 26, // mysql, oracle, mssql
  OPTIONALLY: 2, // mysql
  OR: 31, // mysql, oracle, postgres, mssql, sqlite
  ORDER: 31, // mysql, oracle, postgres, mssql, sqlite
  OTHERS: 1, // sqlite
  OUT: 2, // mysql
  OUTER: 15, // mysql, postgres, mssql, sqlite
  OUTFILE: 2, // mysql
  OVER: 11, // mysql, mssql, sqlite
  OVERLAPS: 4, // postgres
  PARTITION: 3, // mysql, sqlite
  PCTFREE: 16, // oracle
  PERCENT: 8, // mssql
  PERCENT_RANK: 2, // mysql
  PIVOT: 8, // mssql
  PLACING: 4, // postgres
  PLAN: 9, // mssql, sqlite
  PRAGMA: 1, // sqlite
  PRECEDING: 1, // sqlite
  PRECISION: 10, // mysql, mssql
  PRIMARY: 15, // mysql, postgres, mssql, sqlite
  PRINT: 8, // mssql
  PRIOR: 16, // oracle
  PROC: 8, // mssql
  PROCEDURE: 10, // mysql, mssql
  PUBLIC: 24, // oracle, mssql
  PURGE: 2, // mysql
  QUERY: 1, // sqlite
  RAISE: 1, // sqlite
  RAISERROR: 8, // mssql
  RANGE: 3, // mysql, sqlite
  RANK: 2, // mysql
  RAW: 16, // oracle
  READ: 10, // mysql, mssql
  READS: 2, // mysql
  READTEXT: 8, // mssql
  READ_WRITE: 2, // mysql
  REAL: 2, // mysql
  RECONFIGURE: 8, // mssql
  RECURSIVE: 3, // mysql, sqlite
  REFERENCES: 15, // mysql, postgres, mssql, sqlite
  REGEXP: 3, // mysql, sqlite
  REINDEX: 1, // sqlite
  RELEASE: 3, // mysql, sqlite
  RENAME: 19, // mysql, oracle, sqlite
  REPEAT: 2, // mysql
  REPLACE: 3, // mysql, sqlite
  REPLICATION: 8, // mssql
  REQUIRE: 2, // mysql
  RESIGNAL: 2, // mysql
  RESOURCE: 16, // oracle
  RESTORE: 8, // mssql
  RESTRICT: 11, // mysql, mssql, sqlite
  RETURN: 10, // mysql, mssql
  RETURNING: 5, // postgres, sqlite
  REVERT: 8, // mssql
  REVOKE: 26, // mysql, oracle, mssql
  RIGHT: 15, // mysql, postgres, mssql, sqlite
  RLIKE: 2, // mysql
  ROLLBACK: 9, // mssql, sqlite
  ROW: 19, // mysql, oracle, sqlite
  ROWCOUNT: 8, // mssql
  ROWGUIDCOL: 8, // mssql
  ROWID: 16, // oracle
  ROWNUM: 16, // oracle
  ROWS: 19, // mysql, oracle, sqlite
  ROW_NUMBER: 2, // mysql
  RULE: 8, // mssql
  SAVE: 8, // mssql
  SAVEPOINT: 1, // sqlite
  SCHEMA: 10, // mysql, mssql
  SCHEMAS: 2, // mysql
  SECOND_MICROSECOND: 2, // mysql
  SECURITYAUDIT: 8, // mssql
  SELECT: 31, // mysql, oracle, postgres, mssql, sqlite
  SEMANTICKEYPHRASETABLE: 8, // mssql
  SEMANTICSIMILARITYDETAILSTABLE: 8, // mssql
  SEMANTICSIMILARITYTABLE: 8, // mssql
  SENSITIVE: 2, // mysql
  SEPARATOR: 2, // mysql
  SESSION: 16, // oracle
  SESSION_USER: 12, // postgres, mssql
  SET: 27, // mysql, oracle, mssql, sqlite
  SETUSER: 8, // mssql
  SHARE: 16, // oracle
  SHOW: 2, // mysql
  SHUTDOWN: 8, // mssql
  SIGNAL: 2, // mysql
  SIMILAR: 4, // postgres
  SIZE: 16, // oracle
  SMALLINT: 18, // mysql, oracle
  SOME: 12, // postgres, mssql
  SPATIAL: 2, // mysql
  SPECIFIC: 2, // mysql
  SQL: 2, // mysql
  SQLEXCEPTION: 2, // mysql
  SQLSTATE: 2, // mysql
  SQLWARNING: 2, // mysql
  SQL_BIG_RESULT: 2, // mysql
  SQL_CALC_FOUND_ROWS: 2, // mysql
  SQL_SMALL_RESULT: 2, // mysql
  SSL: 2, // mysql
  START: 16, // oracle
  STARTING: 2, // mysql
  STATISTICS: 8, // mssql
  STORED: 2, // mysql
  STRAIGHT_JOIN: 2, // mysql
  SUCCESSFUL: 16, // oracle
  SYMMETRIC: 4, // postgres
  SYNONYM: 16, // oracle
  SYSDATE: 16, // oracle
  SYSTEM: 2, // mysql
  SYSTEM_USER: 8, // mssql
  TABLE: 31, // mysql, oracle, postgres, mssql, sqlite
  TABLESAMPLE: 12, // postgres, mssql
  TEMP: 1, // sqlite
  TEMPORARY: 1, // sqlite
  TERMINATED: 2, // mysql
  TEXTSIZE: 8, // mssql
  THEN: 31, // mysql, oracle, postgres, mssql, sqlite
  TIES: 1, // sqlite
  TINYBLOB: 2, // mysql
  TINYINT: 2, // mysql
  TINYTEXT: 2, // mysql
  TO: 31, // mysql, oracle, postgres, mssql, sqlite
  TOP: 8, // mssql
  TRAILING: 6, // mysql, postgres
  TRAN: 8, // mssql
  TRANSACTION: 9, // mssql, sqlite
  TRIGGER: 27, // mysql, oracle, mssql, sqlite
  TRUE: 6, // mysql, postgres
  TRUNCATE: 8, // mssql
  TRY_CONVERT: 8, // mssql
  TSEQUAL: 8, // mssql
  UID: 16, // oracle
  UNBOUNDED: 1, // sqlite
  UNDO: 2, // mysql
  UNION: 31, // mysql, oracle, postgres, mssql, sqlite
  UNIQUE: 31, // mysql, oracle, postgres, mssql, sqlite
  UNLOCK: 2, // mysql
  UNPIVOT: 8, // mssql
  UNSIGNED: 2, // mysql
  UPDATE: 27, // mysql, oracle, mssql, sqlite
  UPDATETEXT: 8, // mssql
  USAGE: 2, // mysql
  USE: 10, // mysql, mssql
  USER: 28, // oracle, postgres, mssql
  USING: 7, // mysql, postgres, sqlite
  UTC_DATE: 2, // mysql
  UTC_TIME: 2, // mysql
  UTC_TIMESTAMP: 2, // mysql
  VACUUM: 1, // sqlite
  VALIDATE: 16, // oracle
  VALUES: 27, // mysql, oracle, mssql, sqlite
  VARBINARY: 2, // mysql
  VARCHAR: 18, // mysql, oracle
  VARCHAR2: 16, // oracle
  VARCHARACTER: 2, // mysql
  VARIADIC: 4, // postgres
  VARYING: 10, // mysql, mssql
  VERBOSE: 4, // postgres
  VIEW: 25, // oracle, mssql, sqlite
  VIRTUAL: 3, // mysql, sqlite
  WAITFOR: 8, // mssql
  WHEN: 15, // mysql, postgres, mssql, sqlite
  WHENEVER: 16, // oracle
  WHERE: 31, // mysql, oracle, postgres, mssql, sqlite
  WHILE: 10, // mysql, mssql
  WINDOW: 7, // mysql, postgres, sqlite
  WITH: 31, // mysql, oracle, postgres, mssql, sqlite
  WITHIN_GROUP: 8, // mssql
  WITHOUT: 1, // sqlite
  WRITE: 2, // mysql
  WRITETEXT: 8, // mssql
  XOR: 2, // mysql
  YEAR_MONTH: 2, // mysql
  ZEROFILL: 2, // mysql
};

export function isReserved(keyword: string, dialect?: Dialect) {
  const flags = keywordMap[keyword];
  return flags ? !dialect || (flags & dialectMap[dialect]) !== 0 : false;
}
