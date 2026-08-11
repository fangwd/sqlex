# REST API

`sqlex/api` puts an HTTP API over a database you already have, and generates the
OpenAPI 3.1 document that describes it. You declare which models
are exposed and what may be done with them; a compiled policy drives both the
handler and the document, so the two cannot disagree.

Nothing is exposed until you say so — reads are served for a resource you name,
and writes only once you ask for them — and the request handler is a plain
`(Request, context) => Response` function, so there is no server and no
framework to adopt.

```js
const { Database } = require('sqlex');
const { createApi } = require('sqlex/api');

const db = new Database({ dialect: 'postgres', connection: { database: 'shop' } });
await db.buildSchema();

const api = createApi(db, {
  basePath: '/api',
  resources: {
    Product: {
      filter: { fields: ['name', 'price'], operators: ['eq', 'ge', 'le', 'like'] },
      sort: { fields: ['name', 'price'], default: ['name'] },
      include: { relations: ['categories'] },
    },
    Category: {},
  },
});

const response = await api.handle(new Request('http://localhost/api/products?price_le=10'), {});
```

`createApi` needs a schema. Over an existing database, `buildSchema()`
introspects it, as above. An application built on [ORM records](./orm.md)
already has one — `bind()` derives it from the definitions, so nothing is read
from the database:

```js
const db = new Database(connection);
const models = db.bind({ Product, Category });
const api = createApi(db, config);
```

Either way, `createApi` returns three things:

| Member | Purpose |
| ---------------------- | ------------------------------------------------ |
| `handle(request, ctx)` | Serves a request |
| `openapi(options?)`    | The OpenAPI 3.1 document for what `handle` serves |
| `plan`                 | The compiled policy, including any warnings |

## Serving it

The handler takes a [`Request`](https://developer.mozilla.org/docs/Web/API/Request)
and returns a `Response`, both Node globals, so wiring it up is a few lines:

```js
// node:http
const { createServer } = require('node:http');
const { createServerAdapter } = require('@whatwg-node/server');
createServer(createServerAdapter(request => api.handle(request, {}))).listen(3000);

// express 5
app.use('/api', (req, res) => api.handle(toWebRequest(req), { user: req.user }).then(send(res)));

// Bun, Deno, Cloudflare Workers, Hono, Elysia
export default { fetch: request => api.handle(request, {}) };
```

The second argument is your context: whatever your authentication produced. It
is passed to [`scope`](#row-level-access-with-scope) untouched and is never
inspected by the API layer.

## Routes

Each resource gets a collection and an item route under `basePath`, carrying the
methods its `operations` allow:

```
GET    /api/products        list
POST   /api/products        create
GET    /api/products/42     fetch one
PATCH  /api/products/42     change some columns
DELETE /api/products/42     delete
```

`operations` defaults to `['list', 'get']`, so a resource is read-only until a
write is named.

The path segment defaults to the kebab-case plural of the model name
(`OrderItem` → `/order-items`); set `path` to choose your own. A model with a
composite primary key is addressed with comma-separated values in one segment,
`/api/enrolments/7,12`, in the order the key is declared. A model with no
primary key has no item route.

Responses are wrapped so pagination has somewhere to live:

```json
{
  "data": [{ "id": 1, "name": "Apple", "price": 5 }],
  "meta": { "limit": 50, "offset": 0 }
}
```

An item response is the same shape with a single `data` object.

## Reading

| Parameter | Meaning |
| --------- | ---------------------------------------------------------------- |
| `fields`  | Columns to return, comma separated |
| `include` | Relations to embed, comma separated, dotted for nesting |
| `sort`    | Sort columns, comma separated, `-` prefix for descending |
| `limit`   | Page size, clamped to `page.maxLimit` |
| `offset`  | Rows to skip |
| `total`   | `true` to count the whole match into `meta.total` |

```
GET /api/orders?include=user,orderItems.product&sort=-dateCreated&limit=20&total=true
```

Counting is opt-in because an unconditional `COUNT(*)` on every list request is
a cost nobody asked for. A `limit` above the maximum is clamped rather than
rejected, so a client asking for everything gets a page instead of an error.

### Cursor pagination

When a full page comes back, its `meta.next` is an opaque cursor naming the next
one:

```
GET /api/products?sort=-price&limit=20
GET /api/products?sort=-price&limit=20&cursor=<meta.next>
```

Unlike an offset, a cursor is not disturbed by rows inserted or deleted while
paging, and the database seeks to it instead of counting rows past. The listing
is held to a total order — the sort plus the primary key as a tiebreaker — so
equal values cannot lose or repeat rows across a boundary.

A cursor is tied to the sort it was minted under, and replaces `offset`; using
it with another sort, or alongside `offset`, is a `400`. `meta.next` is absent
on the last page, on a model with no primary key, and under a sort that crosses
a relation, whose values a page row does not carry.

Because a cursor encodes the value of every column it orders by, it is also
withheld — `meta.next` absent, pagination falling back to `offset` — when a
sort column is not in the resource's `read` fields. Otherwise the excluded
value would be readable in the otherwise-opaque cursor. Sorting by a hidden
column is still allowed; only the cursor is. For the same reason, do not sort
by a column that `afterRead` redacts: the redaction hides the value in the
response, but a cursor over that column still carries the true value, and no
compile-time check can see a runtime transform. Sort by a column you are
willing to expose the ordering of.

## Aggregates

A resource that exposes the `aggregate` operation answers
`GET /{path}/aggregate`, computing over the rows its filters and scope admit:

```
GET /api/products/aggregate                          → [{ "count": 8 }]
GET /api/products/aggregate?status=1&sum=price       → [{ "sum": { "price": 87 } }]
GET /api/order-items/aggregate?groupBy=product&sum=quantity&count=true
```

Grouping yields one entry per group, ordered by the grouped columns:

```json
{
  "data": [
    { "group": { "status": 0 }, "count": 1 },
    { "group": { "status": 1 }, "count": 7, "sum": { "price": 87 } }
  ],
  "meta": { "limit": 50, "offset": 0 }
}
```

| Parameter | Meaning |
| --------- | ------------------------------------------------------------- |
| `groupBy` | Columns to group by, comma separated, from `aggregate.groupBy` |
| `count`   | Count the rows of each group; on when nothing else is asked for |
| `sum` `avg` | Numeric columns from `aggregate.fields` |
| `min` `max` | Any orderable column from `aggregate.fields` |

Like everything else, aggregates grant nothing by default: exposing the
operation alone allows counting, and `aggregate.groupBy` / `aggregate.fields`
name what more is allowed. A group key is the column's value (a foreign key
groups by its key), `count`, `sum` and `avg` come back as numbers, and `min` /
`max` keep the column's own shape. The route sits where an item URL would, so a
resource whose primary key is a string gets a compile warning that the row whose
key is literally `aggregate` would be shadowed.

An unexpanded foreign key comes back carrying only its key, `{"user": {"id": 3}}`;
naming it in `include` replaces that with the whole row, subject to the target
resource's own policy. A relation that was not requested is absent entirely.

## Filtering

A filterable column becomes one parameter per operator. Equality has no suffix:

```
GET /api/products?name=Apple&price_ge=5&price_lt=20&sku_in=a,b,c&status_null=false
```

| Operator | Suffix | Notes |
| ---------- | ---------- | ------------------------------------------- |
| equals | none | |
| not equal | `_ne` | |
| comparisons | `_lt` `_le` `_ge` `_gt` | numbers and dates |
| in a list | `_in` `_notIn` | comma separated, at least one value |
| pattern | `_like` `_ilike` | `%` and `_` are wildcards; opt in explicitly |
| nullness | `_null` | `true` or `false` |

Only the operators the policy allows exist. `like` and `ilike` are **not**
allowed by default: a leading-wildcard pattern on an unindexed column is a table
scan, so it has to be asked for.

Filters may cross a foreign key when the policy lists the path:

```
GET /api/order-items?order.user.email=alice@example.com
```

Every value is checked against its column before the query is built, so a
malformed request is a `400` rather than a failed query. Anything the policy did
not permit — an unknown parameter, an operator that was not allowed, an
unsortable column, an unreadable field, an over-deep `include` — is also a `400`,
and all of the offending parameters are reported at once:

```json
{
  "title": "Invalid request",
  "status": 400,
  "detail": "2 parameters were rejected",
  "errors": [
    { "parameter": "colour", "detail": "'colour' is not a filterable parameter" },
    { "parameter": "limit", "detail": "expected a whole number, got 'lots'" }
  ]
}
```

Errors are [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `problem+json`. A
missing row is a `404`; a write method is a `405`. Anything unexpected is a bare
`500` with no detail, because a database error message can describe your schema —
pass `onError` to log it:

```js
createApi(db, config, { onError: error => logger.error(error) });
```

## Writing

A body is `application/json`, and only the columns the write policy allows may
appear:

```sh
curl -X POST /api/products -H 'content-type: application/json' \
  -d '{"sku": "sku-9", "name": "Plum", "price": "3.50", "category": 2}'
```

`201` carries the created row and its URL:

```
HTTP/1.1 201 Created
location: /api/products/9
```

```json
{ "data": { "id": 9, "sku": "sku-9", "name": "Plum", "price": "3.50", "category": { "id": 2 } } }
```

`PATCH` changes only the columns named and returns the updated row; `DELETE`
answers `204` with no body. A write reads its row back through the read policy,
so a hidden column is absent from the response and a decimal or date comes back
in the same shape a `GET` would give.

**A relation is set by its key value**, never by a nested object:

```json
{ "category": 2 }        // sets the foreign key
{ "category": null }     // clears it, if the column is nullable
{ "category": { ... } }  // 400
```

sqlex itself would read that last form as an instruction to create, connect or
update the related row. Nested writes are not supported, so the object form is
rejected before it can reach sqlex rather than being performed unauthorised.

A client-supplied reference must also point at a row the target resource's
`scope` admits for this request; one that does not is refused with the same
`422` a dangling reference gets. Values set by `assign`, and references to
unscoped or unexposed targets, are not checked.

A required column is one that is `NOT NULL` with no default and is not
generated; a create must supply every one of them. Statuses:

| Status | Meaning |
| ------ | ------------------------------------------------------------------ |
| `400`  | The body is not valid: an unknown column, a wrong type, a missing required column |
| `404`  | No such row, or it lies outside the scope |
| `409`  | The write would duplicate a unique value |
| `415`  | The body was not `application/json` |
| `422`  | A referenced row is missing or still referenced; a required column was refused; the change would leave the scope |

The driver's own message is never passed on, since it names columns and
constraints a client may know nothing about.

### Writes and `scope`

A write runs inside a transaction together with the check that follows it. An
update or delete only touches rows the scope admits, so a row outside it is a
`404` and is left alone. A change that would move a row *out* of the scope — a
`tenantId` pointed somewhere else — is a `422`, and the transaction is rolled
back. A create that would land outside the scope is refused the same way, so
nothing is left behind.

## Configuration

```ts
createApi(db, {
  basePath: '/api',
  defaults: { page: { defaultLimit: 25, maxLimit: 100 } },
  resources: {
    Product: {
      path: 'catalogue',
      operations: ['list', 'get', 'create', 'update', 'delete'],
      read: { fields: '*', exclude: ['costPrice'] },
      write: { fields: '*', exclude: ['costPrice'] },
      filter: { fields: ['name', 'price'], operators: ['eq', 'ge', 'le'] },
      sort: { fields: ['name'], default: ['name'] },
      include: { relations: ['categories'], maxDepth: 2, limit: 50 },
      page: { defaultLimit: 20, maxLimit: 100 },
      scope: context => ({ tenant: context.tenantId }),
    },
  },
});
```

| Key | Default | Controls |
| ------------ | ---------------- | ------------------------------------------- |
| `path` | kebab-case plural | The route segment |
| `operations` | `['list','get']` | Which routes and methods exist |
| `read` | every column | Columns in responses and in `fields` |
| `write` | every settable column | Columns a client may set |
| `filter` | **nothing** | Filterable columns and their operators |
| `sort` | **nothing** | Sortable columns, and the default order |
| `include` | **nothing** | Embeddable relations, depth and row cap |
| `aggregate` | count only | Groupable and aggregable columns |
| `page` | 50 / 200 | Default and maximum page size |
| `scope` | none | A filter ANDed into every read |
| `assign` | none | Values the server sets on writes |
| `authorize` | none | Per-request operation gate |
| `beforeWrite` | none | Value-level rules and transforms |
| `afterRead` | none | Response transforms and redaction |

`defaults` sets `operators`, `includeMaxDepth`, `includeLimit` and `page` for
every resource; each is overridable per resource.

`read` and `write` are independent: a column can be writable but never returned,
which is what a password column wants. A generated column is never writable.

Three of these default to nothing rather than to everything readable. Exposing a
column should not silently make it a query dimension: an unindexed column that
anything can filter or sort by is a denial-of-service waiting to happen, and
each filterable column is one more way to probe rows you cannot read.

### Deny by default, and loudly

A model absent from `resources` does not exist as far as the API is concerned.
Beyond that, a configuration that cannot mean what it says is rejected when it is
compiled, not when a request arrives:

- an unknown model, column, relation or operator name — including a typo, which
  would otherwise leave a table wide open;
- a relation whose target is not itself an exposed resource, so field-level
  policy stays in force through embedded rows;
- expanding a foreign key that `read` hides;
- a `sort.default` that is not sortable, or a filter on a column that has no
  usable operator;
- a filter named like a reserved parameter (`limit`, `total`, …), which the
  request layer would swallow;
- a collection `include` on a table with no single-column primary key, which
  cannot be grouped;
- an item route on a table with no primary key;
- a `write` policy with no write operation to use it, or one that withholds a
  column a create cannot do without;
- an `aggregate` policy with no aggregate operation, or one naming a column no
  function applies to.

Every problem in the configuration is reported together:

```
ApiConfigError: Invalid API configuration:
  - Prodcut: unknown model or table
  - User: read 'emial' is not a column of User
```

Softer problems land in `api.plan.warnings` instead — hiding a primary key from
reads, for instance, which leaves a client unable to construct an item URL.

### Row-level access with `scope`

`scope` returns a filter that is ANDed into every read of that resource:

```js
scope: context => ({ tenant: context.tenantId }),
```

It is combined as `and: [scope, requestFilter]` rather than merged, so a request
filter containing `or` cannot widen the result past it. An item outside the
scope is a `404`, not a `403`, so the API does not confirm that the row exists.

The scope follows the rows wherever they are reached. An embedded collection is
filtered by its own resource's scope, and an expanded foreign key whose target
is scoped is withheld — reduced back to the bare `{id}` reference — when the row
behind it is not admitted. Reaching rows through another resource never shows
more than reading them directly would.

`assign` is the write-side counterpart: values the server sets on every create
and update, applied after validation and on top of the body, so a tenant column
comes from the request's identity rather than the client's say-so:

```js
assign: context => ({ tenant: context.tenantId }),
```

### Value-level rules and response transforms

Two hooks cover what the declarative policy cannot say:

```js
// After validation and assign; for update and delete, inside the transaction
// with the current row in hand. `body` is what the client sent, `data` what
// would be written (with assign applied). Throw an ApiError to refuse; return
// a document to replace the data.
beforeWrite: (context, { operation, data, body, row }) => {
  if (context.role === 'customer' && body.status !== undefined) {
    if (body.status !== 'cancelled') throw ApiError.unprocessable('customers may only cancel');
    if (row.status !== 'open') throw ApiError.unprocessable('only an open order can be cancelled');
  }
},

// After serialisation, wherever a row of this resource is served: lists,
// items, embedded relations and write responses. Change values, not shape —
// the document still describes the response.
afterRead: (context, row) => {
  if (context.role !== 'admin') row.email = row.email.replace(/^[^@]+/, '***');
},
```

A `beforeWrite` refusal thrown inside an update or delete rolls the transaction
back; anything thrown that is not an `ApiError` is a bare `500` handed to
`onError`. An `afterRead` redaction cannot be reached around through an
`include`, because each resource's hook follows its rows into embeds.

See [Multi-tenancy](./multi-tenancy.md) for the complete pattern.

## Documentation from comments

Column and table comments become the documentation in the generated document: a
table comment describes the resource's schema and its tag, and a column comment
describes the property in row schemas and request bodies. A technical note the
generator adds itself (a decimal's serialisation, an inexact bigint) stays
after the comment rather than being displaced. `description` on a resource
overrides its table comment.

With ORM records, comments come from the definitions and work on every engine:

```js
class Product extends defineRecord({
  table: 'product',
  comment: 'A physical product in the catalogue.',
  fields: {
    id: field.id(),
    price: field.decimal({ precision: 10, scale: 2, comment: 'Unit price in AUD.' }),
  },
}) {}
```

Over an introspected schema, comments are read from the database on MySQL and
PostgreSQL — where migrations generated from these definitions also store them —
so a well-commented existing database documents itself. SQLite has no comment
storage, so a reflected SQLite schema carries none; use record definitions (or
`description`) there.

## Generating the document

`api.openapi()` returns the document as an object:

```js
const document = api.openapi({ title: 'Shop', version: '1.2.0' });
```

`securitySchemes` declares how callers authenticate; declaring any adds the
scheme to the document, a document-wide requirement (overridable with
`security`), and a `401` response to every operation:

```js
api.openapi({
  title: 'Shop',
  securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' } },
});
```

Or emit it from the command line, which is the form to feed to client codegen
and to diff in CI:

```sh
sqlex openapi                      # to stdout
sqlex openapi --out openapi.json
sqlex openapi --config api.config.mjs
```

The CLI reads the same `sqlex.config.*` file as
[migrations](./migrations.md), and needs an `api` key:

```js
export default {
  connection: { dialect: 'sqlite3', connection: { database: 'app.db' } },
  api: { resources: { Product: {} } },
  openapi: { title: 'Shop', version: '1.2.0' },
};
```

Because the document is generated from the same compiled policy the handler
uses, it cannot describe a column the handler withholds. Hidden columns and
unexposed models appear nowhere in it.

## Column types on the wire

Schemas are generated from what the drivers actually return, which is not always
what the column type suggests:

| Column | Wire type | Why |
| --------------- | ---------------------------- | ----------------------------------- |
| `decimal`, `numeric` | string | mysql and postgres return strings to keep precision; sqlite's number is converted to match |
| `bigint` | integer, `format: int64` | every driver returns a JS number, so values past 2^53 are already inexact |
| `date` | string, `format: date` | the value is a `Date` at midnight, which plain JSON would render in UTC and move the calendar day |
| `datetime`, `timestamp` | string, `format: date-time` | |
| `time` | string, no format | each engine returns a different shape, so no format is claimed and the column cannot be filtered |
| `json`, `jsonb` | any | filtering into a document is not supported yet |
| vector | array of numbers | |
| `boolean` | boolean on postgres, integer on mysql and sqlite | neither reports a boolean marker for `tinyint`/`integer`, so the document describes what is stored |

No property in a row schema is marked required: a request can narrow the columns
with `fields`, and relations appear only when included. Request bodies are the
other way round — `<Model>Create` marks every column a create cannot do without
as required, `<Model>Update` marks none — and both refuse properties they do not
name.

A `time` column can be neither filtered nor written. The engines disagree on
what they store and return for one, and sqlex builds a value for it from a full
timestamp, so both would be guesses. Ordering by one is fine.
