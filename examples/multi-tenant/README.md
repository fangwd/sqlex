# Multi-tenant example

One API, four personas, following [Multi-tenancy](../../docs/multi-tenancy.md).
The entire authorisation model lives in `sqlex.config.mts` as three primitives
per resource — `authorize` (may this actor do this at all), `scope` (which
rows), `assign` (what the server stamps onto writes) — and the server only
authenticates.

| API key | Persona | May |
| --- | --- | --- |
| `key-root` | platform staff | everything, everywhere |
| `key-acme-owner` | shop owner | close/reopen Acme; manage its products and orders |
| `key-acme-admin` | shop admin | manage Acme's products and orders — not the shop itself |
| `key-alice`, `key-bob` | customers | browse every shop; see and place their own orders anywhere |

From this directory:

```sh
npm install
npm run migration:make -- initial
npm run migration:up
npm run openapi          # writes openapi.json
npm start                # serves http://localhost:3000/api
```

Things to try:

```sh
# The same table, three ways in: by shop, by customer, unrestricted.
curl -H 'x-api-key: key-acme-admin' localhost:3000/api/orders   # Acme's orders
curl -H 'x-api-key: key-alice'      localhost:3000/api/orders   # Alice's, across shops
curl -H 'x-api-key: key-root'       localhost:3000/api/orders   # all of them

# Only the owner closes the shop: the admin gets 403, another owner 404.
curl -X PATCH -H 'x-api-key: key-acme-owner' -H 'content-type: application/json' \
  localhost:3000/api/shops/1 -d '{"status":"closed"}'
curl -i -X PATCH -H 'x-api-key: key-acme-admin' -H 'content-type: application/json' \
  localhost:3000/api/shops/1 -d '{"status":"open"}'              # 403
curl -i -X PATCH -H 'x-api-key: key-bloom-owner' -H 'content-type: application/json' \
  localhost:3000/api/shops/1 -d '{"status":"open"}'              # 404

# A customer picks the shop; who they are comes from authentication.
curl -X POST -H 'x-api-key: key-bob' -H 'content-type: application/json' \
  localhost:3000/api/orders \
  -d '{"shop":2,"code":"bloom-2003","placedAt":"2026-08-11T10:00:00Z"}'

# Customers browse every catalogue but cannot touch one; staff see only theirs.
curl -H 'x-api-key: key-alice'      localhost:3000/api/products
curl -H 'x-api-key: key-acme-admin' localhost:3000/api/products
curl -i -X POST -H 'x-api-key: key-alice' -H 'content-type: application/json' \
  localhost:3000/api/products -d '{"name":"Hack","price":"1.00"}'   # 403

# Shop staff have no access to the customer list: an empty scope
# alternative list admits nothing.
curl -H 'x-api-key: key-acme-admin' localhost:3000/api/customers    # []
```
