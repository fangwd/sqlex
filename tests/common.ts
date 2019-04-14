import { readFileSync } from 'fs';
import { join } from 'path';

export function getExampleData() {
  const fileName = join(__dirname, 'data', 'schema.json');
  return JSON.parse(readFileSync(fileName).toString());
}
