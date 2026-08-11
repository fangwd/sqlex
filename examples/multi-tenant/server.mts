import { createServer } from 'node:http';
import { Database } from 'sqlex';
import { createApi, problemResponse } from 'sqlex/api';
import config, { connection, type Context } from './sqlex.config.mts';

const db = new Database(connection);
const models = db.bind(config.models);

// Seed two shops and two customers so isolation is observable.
const [acme] = await models.Shop.getOrCreate({ name: 'Acme' });
const [bloom] = await models.Shop.getOrCreate({ name: 'Bloom' });
const [alice] = await models.Customer.getOrCreate({ name: 'Alice' });
const [bob] = await models.Customer.getOrCreate({ name: 'Bob' });
for (const [shop, name, price] of [
  [acme, 'Anvil', 49.0],
  [acme, 'Rocket skates', 99.5],
  [bloom, 'Tulip bundle', 12.0],
] as const) {
  await models.Product.getOrCreate({ shop, name }, { price });
}
if ((await models.Order.filter({}).count()) === 0) {
  const anvil = await models.Product.filter({ name: 'Anvil' }).first();
  const tulips = await models.Product.filter({ name: 'Tulip bundle' }).first();
  if (!anvil || !tulips) throw Error('seed failed');
  // Alice shops at both stores; Bob only at Bloom.
  const one = await models.Order.create({
    shop: acme, customer: alice, code: 'acme-1001', placedAt: new Date(),
  });
  await models.OrderItem.create({ order: one, product: anvil, quantity: 2 });
  const two = await models.Order.create({
    shop: bloom, customer: alice, code: 'bloom-2001', placedAt: new Date(),
  });
  await models.OrderItem.create({ order: two, product: tulips, quantity: 1 });
  await models.Order.create({
    shop: bloom, customer: bob, code: 'bloom-2002', placedAt: new Date(),
  });
}

const api = createApi<Context>(db, config.api, { onError: error => console.error(error) });

// Authentication: an API key names who is asking and what they are. In a real
// platform this is your session or JWT middleware; the API only ever sees the
// context it produces.
const actors = new Map<string, Context>([
  ['key-root', { role: 'super' }],
  ['key-acme-owner', { role: 'owner', shopId: acme.id }],
  ['key-acme-admin', { role: 'admin', shopId: acme.id }],
  ['key-bloom-owner', { role: 'owner', shopId: bloom.id }],
  ['key-alice', { role: 'customer', customerId: alice.id }],
  ['key-bob', { role: 'customer', customerId: bob.id }],
]);

const server = createServer(async (incoming, outgoing) => {
  const respond = async (response: Response) => {
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  };

  const context = actors.get(String(incoming.headers['x-api-key'] ?? ''));
  if (!context) {
    return respond(
      problemResponse({ title: 'Unauthorized', status: 401, detail: 'Send x-api-key' })
    );
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (typeof value === 'string') headers.set(key, value);
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
  await respond(await api.handle(request, context));
});

server.listen(3000, () => {
  console.log('curl -H "x-api-key: key-alice"      localhost:3000/api/orders');
  console.log('curl -H "x-api-key: key-acme-admin" localhost:3000/api/orders');
  console.log('curl -H "x-api-key: key-root"       localhost:3000/api/orders');
});
