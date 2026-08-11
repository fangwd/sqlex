# REST API example

A read-only HTTP API and its OpenAPI document over a SQLite database, following
[REST API](../../docs/api.md).

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
curl 'localhost:3000/api/products'
curl 'localhost:3000/api/products?price_le=2.30&sort=-price&total=true'
curl 'localhost:3000/api/products?include=category&fields=id,name'
curl 'localhost:3000/api/categories?include=products'

curl -i 'localhost:3000/api/products?costPrice=1'   # 400: not filterable
curl -i 'localhost:3000/api/products/999'           # 404
curl -i -X DELETE 'localhost:3000/api/products'     # 405
```

`cost_price` is a real column that the policy excludes from both reads and
writes, so it appears in neither the responses, the request bodies, nor
`openapi.json`. `Category` is exposed with no `filter` and no write operations, so none of its
columns are filterable and it serves reads only — the defaults grant nothing.

The generated `openapi.json` and the local `shop.db` do not belong in source
control; the generated migration does.
