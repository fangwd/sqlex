import { Document } from './types';

export type {
  AnyDocument,
  AnyTableSpec,
  Document,
  DocumentValue,
  FilterShape,
  JsonValue,
  LooseTableSpec,
  MutationOptions,
  ParentMutation,
  RelatedMutation,
  ScalarValue,
  SelectFields,
  TableCreate,
  TableFilter,
  TableInsert,
  TableMap,
  TableRow,
  TableSpec,
  Identifiable,
  TableUpdate,
  Value,
  VectorValue,
} from './types';

export {
  Database,
  Table,
  toDocument,
} from './database';
export type { Filter, SelectOptions } from './database';

export {
  createConnection,
  createConnectionPool,
  Connection,
  ConnectionPool,
  getInformationSchema
} from './engine';
export type {
  ConnectionInfo,
  ConnectionSettings,
  Dialect,
  Row,
} from './engine';

export {
  QueryBuilder,
  encodeFilter,
  AND,
  OR,
  NOT,
  LT,
  LE,
  GE,
  GT,
  NE,
  IN,
  LIKE,
  ILIKE,
  NULL,
  SOME,
  NONE,
} from './filter';

export type { JsonFilterOptions, JsonOperatorSyntax } from './filter';

export { toArray } from './misc';
export { selectTree } from './select';
export { Record, RecordSet } from './record';
export {
  bindRecords,
  defineRecord,
  field,
  getSqlDefault,
  Manager,
  MultipleRecordsError,
  QuerySet,
  schemaFromRecords,
  sqlDefault,
} from './orm';
export {
  defineMigration,
  diffMigrationSchemas,
  invertOperations,
  makeMigration,
  migrationChecksum,
  migrationSchemaFromRecords,
  MigrationCompiler,
  MigrationRunner,
  operation,
  printMigration,
} from './migration';
export type {
  BaselineOptions,
  MigrateOptions,
  Migration,
  MigrationColumn,
  MigrationConstraint,
  MigrationDiff,
  MigrationIndex,
  MigrationOperation,
  MigrationResult,
  MigrationSchema,
  MigrationStatus,
  MigrationTable,
} from './migration';
export type {
  BoundModel,
  BoundModels,
  DecimalFieldOptions,
  EnumFieldOptions,
  FieldOptions,
  FieldDefinitions,
  ForeignKeyDefinition,
  ForeignKeyOptions,
  InferRecordCreate,
  InferRecordFields,
  InferRecordUpdate,
  RecordClass,
  RecordClassMap,
  RecordDefinition,
  ReferentialAction,
  ScalarFieldDefinition,
  ScalarFieldKind,
  SqlDefault,
  StringFieldOptions,
  VectorFieldOptions,
} from './orm';
export { printSchema, exportSchemaJava, printSchemaTypeMap } from './print';
export { JsonSerialiser, XstreamSerialiser } from './serialiser';
export { decodeSurrogateKey, getDefaultSurrogateKeyFields, surrogateKeyToFields } from './loader';
export { setMockStringPrefix } from './mock';

export { datetimeToString, dateToString, timeToString, isPlainObject, pluralise, pluck } from './utils';
export { Schema, Model } from './schema';

export type PlainDataObject = Document;

export const VERSION = require('../package.json').version;
