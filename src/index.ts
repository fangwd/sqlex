import { Document } from './types';

export {
  Database,
  Table,
  Filter,
  SelectOptions,
  toDocument,
} from './database';

export {
  Dialect,
  ConnectionInfo,
  createConnection,
  createConnectionPool,
  Connection,
  ConnectionPool,
  Row,
  getInformationSchema
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
  NULL,
  SOME,
  NONE
} from './filter';

export { toArray } from './misc';
export { selectTree } from './select';
export { Record, RecordProxy } from './record';
export { printSchema, exportSchemaJava, printSchemaTypeScript } from './print';
export { JsonSerialiser, XstreamSerialiser } from './serialiser';
export { decodeSurrogateKey, getDefaultSurrogateKeyFields, surrogateKeyToFields } from './loader';
export { setMockStringPrefix } from './mock';

export type PlainDataObject = Document;
