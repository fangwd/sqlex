import { Connection } from ".";

export function lower(row: { [key: string]: any }) {
  const result = {};
  for (const key in row) {
    result[key.toLowerCase()] = row[key];
  }
  return result;
}

export function queryInformationSchema(connection: Connection, query: string) {
  return connection._query(query).then(rows => rows.map(row => lower(row)));
}
