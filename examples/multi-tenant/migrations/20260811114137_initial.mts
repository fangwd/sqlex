import { defineMigration } from 'sqlex';

export default defineMigration({
  "id": "20260811114137_initial",
  "up": [
    {
      "kind": "createTable",
      "table": {
        "name": "shop",
        "columns": [
          {
            "name": "id",
            "type": "integer",
            "nullable": false,
            "autoIncrement": true
          },
          {
            "name": "name",
            "type": "varchar",
            "nullable": false,
            "size": 60
          },
          {
            "name": "status",
            "type": "enum",
            "nullable": false,
            "default": "open",
            "userDefinedType": {
              "type": "enum",
              "name": "status_enum",
              "values": [
                "open",
                "closed"
              ]
            }
          }
        ],
        "constraints": [
          {
            "name": "shop_pkey",
            "columns": [
              "id"
            ],
            "primaryKey": true
          },
          {
            "name": "shop_name_key",
            "columns": [
              "name"
            ],
            "unique": true
          }
        ],
        "comment": "A tenant: one storefront on the platform.",
        "indexes": []
      }
    },
    {
      "kind": "createTable",
      "table": {
        "name": "customer",
        "columns": [
          {
            "name": "id",
            "type": "integer",
            "nullable": false,
            "autoIncrement": true
          },
          {
            "name": "name",
            "type": "varchar",
            "nullable": false,
            "size": 60
          }
        ],
        "constraints": [
          {
            "name": "customer_pkey",
            "columns": [
              "id"
            ],
            "primaryKey": true
          },
          {
            "name": "customer_name_key",
            "columns": [
              "name"
            ],
            "unique": true
          }
        ],
        "comment": "A shopper; places orders at any shop.",
        "indexes": []
      }
    },
    {
      "kind": "createTable",
      "table": {
        "name": "product",
        "columns": [
          {
            "name": "id",
            "type": "integer",
            "nullable": false,
            "autoIncrement": true
          },
          {
            "name": "shop_id",
            "type": "integer",
            "nullable": false,
            "autoIncrement": false
          },
          {
            "name": "name",
            "type": "varchar",
            "nullable": false,
            "size": 120
          },
          {
            "name": "price",
            "type": "decimal",
            "nullable": false,
            "comment": "Retail price.",
            "precision": 10,
            "scale": 2
          }
        ],
        "constraints": [
          {
            "name": "product_pkey",
            "columns": [
              "id"
            ],
            "primaryKey": true
          },
          {
            "name": "product_shop_id_fkey",
            "columns": [
              "shop_id"
            ],
            "references": {
              "table": "shop",
              "columns": [
                "id"
              ]
            }
          },
          {
            "name": "product_shop_id_name_key",
            "columns": [
              "shop_id",
              "name"
            ],
            "unique": true
          }
        ],
        "comment": "A product in one shop's catalogue.",
        "indexes": []
      }
    },
    {
      "kind": "createTable",
      "table": {
        "name": "shop_order",
        "columns": [
          {
            "name": "id",
            "type": "integer",
            "nullable": false,
            "autoIncrement": true
          },
          {
            "name": "shop_id",
            "type": "integer",
            "nullable": false,
            "autoIncrement": false
          },
          {
            "name": "customer_id",
            "type": "integer",
            "nullable": false,
            "autoIncrement": false
          },
          {
            "name": "code",
            "type": "varchar",
            "nullable": false,
            "size": 30
          },
          {
            "name": "placed_at",
            "type": "datetime",
            "nullable": false
          },
          {
            "name": "status",
            "type": "enum",
            "nullable": false,
            "default": "open",
            "userDefinedType": {
              "type": "enum",
              "name": "status_enum",
              "values": [
                "open",
                "shipped",
                "cancelled"
              ]
            }
          }
        ],
        "constraints": [
          {
            "name": "shop_order_pkey",
            "columns": [
              "id"
            ],
            "primaryKey": true
          },
          {
            "name": "shop_order_shop_id_fkey",
            "columns": [
              "shop_id"
            ],
            "references": {
              "table": "shop",
              "columns": [
                "id"
              ]
            }
          },
          {
            "name": "shop_order_customer_id_fkey",
            "columns": [
              "customer_id"
            ],
            "references": {
              "table": "customer",
              "columns": [
                "id"
              ]
            }
          },
          {
            "name": "shop_order_code_key",
            "columns": [
              "code"
            ],
            "unique": true
          }
        ],
        "comment": "An order a customer placed with one shop.",
        "indexes": []
      }
    },
    {
      "kind": "createTable",
      "table": {
        "name": "shop_order_item",
        "columns": [
          {
            "name": "id",
            "type": "integer",
            "nullable": false,
            "autoIncrement": true
          },
          {
            "name": "order_id",
            "type": "integer",
            "nullable": false,
            "autoIncrement": false
          },
          {
            "name": "product_id",
            "type": "integer",
            "nullable": false,
            "autoIncrement": false
          },
          {
            "name": "quantity",
            "type": "integer",
            "nullable": false
          }
        ],
        "constraints": [
          {
            "name": "shop_order_item_pkey",
            "columns": [
              "id"
            ],
            "primaryKey": true
          },
          {
            "name": "shop_order_item_order_id_fkey",
            "columns": [
              "order_id"
            ],
            "references": {
              "table": "shop_order",
              "columns": [
                "id"
              ]
            },
            "onDelete": "cascade"
          },
          {
            "name": "shop_order_item_product_id_fkey",
            "columns": [
              "product_id"
            ],
            "references": {
              "table": "product",
              "columns": [
                "id"
              ]
            }
          }
        ],
        "comment": "A line of an order; its tenant is the order's shop.",
        "indexes": []
      }
    }
  ],
  "down": [
    {
      "kind": "dropTable",
      "table": "shop_order_item"
    },
    {
      "kind": "dropTable",
      "table": "shop_order"
    },
    {
      "kind": "dropTable",
      "table": "product"
    },
    {
      "kind": "dropTable",
      "table": "customer"
    },
    {
      "kind": "dropTable",
      "table": "shop"
    }
  ],
  "schema": {
    "name": "",
    "tables": [
      {
        "name": "shop",
        "columns": [
          {
            "name": "id",
            "type": "integer",
            "nullable": false,
            "autoIncrement": true
          },
          {
            "name": "name",
            "type": "varchar",
            "nullable": false,
            "size": 60
          },
          {
            "name": "status",
            "type": "enum",
            "nullable": false,
            "default": "open",
            "userDefinedType": {
              "type": "enum",
              "name": "status_enum",
              "values": [
                "open",
                "closed"
              ]
            }
          }
        ],
        "constraints": [
          {
            "name": "shop_pkey",
            "columns": [
              "id"
            ],
            "primaryKey": true
          },
          {
            "name": "shop_name_key",
            "columns": [
              "name"
            ],
            "unique": true
          }
        ],
        "comment": "A tenant: one storefront on the platform.",
        "indexes": []
      },
      {
        "name": "customer",
        "columns": [
          {
            "name": "id",
            "type": "integer",
            "nullable": false,
            "autoIncrement": true
          },
          {
            "name": "name",
            "type": "varchar",
            "nullable": false,
            "size": 60
          }
        ],
        "constraints": [
          {
            "name": "customer_pkey",
            "columns": [
              "id"
            ],
            "primaryKey": true
          },
          {
            "name": "customer_name_key",
            "columns": [
              "name"
            ],
            "unique": true
          }
        ],
        "comment": "A shopper; places orders at any shop.",
        "indexes": []
      },
      {
        "name": "product",
        "columns": [
          {
            "name": "id",
            "type": "integer",
            "nullable": false,
            "autoIncrement": true
          },
          {
            "name": "shop_id",
            "type": "integer",
            "nullable": false,
            "autoIncrement": false
          },
          {
            "name": "name",
            "type": "varchar",
            "nullable": false,
            "size": 120
          },
          {
            "name": "price",
            "type": "decimal",
            "nullable": false,
            "comment": "Retail price.",
            "precision": 10,
            "scale": 2
          }
        ],
        "constraints": [
          {
            "name": "product_pkey",
            "columns": [
              "id"
            ],
            "primaryKey": true
          },
          {
            "name": "product_shop_id_fkey",
            "columns": [
              "shop_id"
            ],
            "references": {
              "table": "shop",
              "columns": [
                "id"
              ]
            }
          },
          {
            "name": "product_shop_id_name_key",
            "columns": [
              "shop_id",
              "name"
            ],
            "unique": true
          }
        ],
        "comment": "A product in one shop's catalogue.",
        "indexes": []
      },
      {
        "name": "shop_order",
        "columns": [
          {
            "name": "id",
            "type": "integer",
            "nullable": false,
            "autoIncrement": true
          },
          {
            "name": "shop_id",
            "type": "integer",
            "nullable": false,
            "autoIncrement": false
          },
          {
            "name": "customer_id",
            "type": "integer",
            "nullable": false,
            "autoIncrement": false
          },
          {
            "name": "code",
            "type": "varchar",
            "nullable": false,
            "size": 30
          },
          {
            "name": "placed_at",
            "type": "datetime",
            "nullable": false
          },
          {
            "name": "status",
            "type": "enum",
            "nullable": false,
            "default": "open",
            "userDefinedType": {
              "type": "enum",
              "name": "status_enum",
              "values": [
                "open",
                "shipped",
                "cancelled"
              ]
            }
          }
        ],
        "constraints": [
          {
            "name": "shop_order_pkey",
            "columns": [
              "id"
            ],
            "primaryKey": true
          },
          {
            "name": "shop_order_shop_id_fkey",
            "columns": [
              "shop_id"
            ],
            "references": {
              "table": "shop",
              "columns": [
                "id"
              ]
            }
          },
          {
            "name": "shop_order_customer_id_fkey",
            "columns": [
              "customer_id"
            ],
            "references": {
              "table": "customer",
              "columns": [
                "id"
              ]
            }
          },
          {
            "name": "shop_order_code_key",
            "columns": [
              "code"
            ],
            "unique": true
          }
        ],
        "comment": "An order a customer placed with one shop.",
        "indexes": []
      },
      {
        "name": "shop_order_item",
        "columns": [
          {
            "name": "id",
            "type": "integer",
            "nullable": false,
            "autoIncrement": true
          },
          {
            "name": "order_id",
            "type": "integer",
            "nullable": false,
            "autoIncrement": false
          },
          {
            "name": "product_id",
            "type": "integer",
            "nullable": false,
            "autoIncrement": false
          },
          {
            "name": "quantity",
            "type": "integer",
            "nullable": false
          }
        ],
        "constraints": [
          {
            "name": "shop_order_item_pkey",
            "columns": [
              "id"
            ],
            "primaryKey": true
          },
          {
            "name": "shop_order_item_order_id_fkey",
            "columns": [
              "order_id"
            ],
            "references": {
              "table": "shop_order",
              "columns": [
                "id"
              ]
            },
            "onDelete": "cascade"
          },
          {
            "name": "shop_order_item_product_id_fkey",
            "columns": [
              "product_id"
            ],
            "references": {
              "table": "product",
              "columns": [
                "id"
              ]
            }
          }
        ],
        "comment": "A line of an order; its tenant is the order's shop.",
        "indexes": []
      }
    ]
  }
});
