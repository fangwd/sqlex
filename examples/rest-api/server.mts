import { createServer } from 'node:http';
import { Database } from 'sqlex';
import { createApi } from 'sqlex/api';
import config, { connection } from './sqlex.config.mts';

const db = new Database(connection);

// The schema comes from the record definitions, so the API knows the comments
// and the decimal scales on every engine, sqlite included. Over a database that
// has no record definitions, call `await db.buildSchema()` here instead.
db.bind(config.models);

const categories = db.table('category');
const products = db.table('product');

// Seed once; sku and name are unique, so a repeat resolves the existing row.
const fruit = await categories.create({ name: 'Fruit' });
const category = fruit.id as number;
for (const [sku, name, price, costPrice] of [
  ['sku-1', 'Apple', '1.50', '0.80'],
  ['sku-2', 'Banana', '2.25', '1.10'],
  ['sku-3', 'Cherry', '9.99', '6.00'],
] as const) {
  await products.create({ sku, name, price, costPrice, category });
}

const api = createApi(db, config.api, { onError: error => console.error(error) });
for (const warning of api.plan.warnings) console.warn(`warning: ${warning}`);

// A hand-rolled node:http bridge, to keep this example dependency-free. A real
// deployment is better off with an adapter such as @whatwg-node/server, or a
// runtime whose server speaks Request and Response already.
const server = createServer(async (incoming, outgoing) => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) for (const entry of value) headers.append(key, entry);
  }

  const method = incoming.method ?? 'GET';
  let body: string | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk as Buffer);
    if (chunks.length) body = Buffer.concat(chunks).toString('utf8');
  }

  const request = new Request(`http://${incoming.headers.host}${incoming.url}`, {
    method,
    headers,
    body,
  });
  const response = await api.handle(request, {});
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(3000, () => {
  console.log('http://localhost:3000/api/products');
  console.log('http://localhost:3000/api/products?price_le=2.30&include=category&total=true');
});
