import { defineMigration } from 'sqlex';

export default defineMigration({
  "id": "20260811111008_initial",
  "up": [
    {
      "kind": "createTable",
      "table": {
        "name": "category",
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
            "comment": "Shown in navigation.",
            "size": 60
          }
        ],
        "constraints": [
          {
            "name": "category_pkey",
            "columns": [
              "id"
            ],
            "primaryKey": true
          },
          {
            "name": "category_name_key",
            "columns": [
              "name"
            ],
            "unique": true
          }
        ],
        "comment": "A leaf of the catalogue tree.",
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
            "name": "category_id",
            "type": "integer",
            "nullable": false,
            "autoIncrement": false
          },
          {
            "name": "sku",
            "type": "varchar",
            "nullable": false,
            "comment": "Stock keeping unit.",
            "size": 20
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
            "comment": "Retail price in AUD.",
            "precision": 10,
            "scale": 2
          },
          {
            "name": "cost_price",
            "type": "decimal",
            "nullable": true,
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
            "name": "product_category_id_fkey",
            "columns": [
              "category_id"
            ],
            "references": {
              "table": "category",
              "columns": [
                "id"
              ]
            }
          },
          {
            "name": "product_sku_key",
            "columns": [
              "sku"
            ],
            "unique": true
          }
        ],
        "comment": "A sellable product.",
        "indexes": []
      }
    }
  ],
  "down": [
    {
      "kind": "dropTable",
      "table": "product"
    },
    {
      "kind": "dropTable",
      "table": "category"
    }
  ],
  "schema": {
    "name": "",
    "tables": [
      {
        "name": "category",
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
            "comment": "Shown in navigation.",
            "size": 60
          }
        ],
        "constraints": [
          {
            "name": "category_pkey",
            "columns": [
              "id"
            ],
            "primaryKey": true
          },
          {
            "name": "category_name_key",
            "columns": [
              "name"
            ],
            "unique": true
          }
        ],
        "comment": "A leaf of the catalogue tree.",
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
            "name": "category_id",
            "type": "integer",
            "nullable": false,
            "autoIncrement": false
          },
          {
            "name": "sku",
            "type": "varchar",
            "nullable": false,
            "comment": "Stock keeping unit.",
            "size": 20
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
            "comment": "Retail price in AUD.",
            "precision": 10,
            "scale": 2
          },
          {
            "name": "cost_price",
            "type": "decimal",
            "nullable": true,
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
            "name": "product_category_id_fkey",
            "columns": [
              "category_id"
            ],
            "references": {
              "table": "category",
              "columns": [
                "id"
              ]
            }
          },
          {
            "name": "product_sku_key",
            "columns": [
              "sku"
            ],
            "unique": true
          }
        ],
        "comment": "A sellable product.",
        "indexes": []
      }
    ]
  }
});
