import { Connection } from ".";

export function lower<T extends object = { [key: string]: unknown }>(row: {
  [key: string]: unknown;
}): T {
  const result: { [key: string]: unknown } = {};
  for (const key in row) {
    result[key.toLowerCase()] = row[key];
  }
  return result as T;
}

export function queryInformationSchema<T extends object = { [key: string]: unknown }>(
  connection: Connection,
  query: string
): Promise<T[]> {
  return connection
    ._query(query)
    .then((rows: { [key: string]: unknown }[]) => rows.map(row => lower<T>(row)));
}
