#!/usr/bin/env node
const fs = require('fs');

const {
  Database,
  printSchema,
  exportSchemaJava,
  printSchemaTypeScript,
  XstreamSerialiser,
  selectTree,
  getReferencingFields,
  setModelName,
} = require('../dist');

const getopt = require('../lib/getopt');

const options = getopt([
  ['  ', '--dialect'],
  ['-h', '--host'],
  ['-P', '--port'],
  ['-u', '--user'],
  ['-p', '--password'],
  ['  ', '--json', true],
  ['  ', '--export', true],
  ['  ', '--java', true],
  ['  ', '--typescript', true],
  ['  ', '--path'],
  ['  ', '--package'],
  ['  ', '--select'],
  ['  ', '--xstream', true],
  ['  ', '--xml', true],
  ['  ', '--types'],
  ['  ', '--references'],
  ['  ', '--rename'],
  ['  ', '--config'],
  ['  ', '--fixForeignKeys'],
  ['  ', '--fixNextVal'],
  ['  ', '--schema'],
  ['  ', '--zap', true],
  ['  ', '--exclude'],
]);

(async function() {
  const dialect = options.dialect || 'mysql';
  const host = options.host || 'localhost';
  const port = options.port || (options.dialect === 'postgres' ? '5432' : '3306');
  const user = options.user || 'root';
  const password = options.password || process.env.DATABASE_PASSWORD;
  const database = options.argv[0];
  const db = new Database({
    dialect,
    connection: {
      host,
      port: parseInt(port),
      user,
      password,
      database,
      timezone: 'Z'
    },
  });

  if (options.config) {
    const config = JSON.parse(fs.readFileSync(options.config).toString());
    await db.buildSchema(config);
  } else {
    await db.buildSchema({name: options.schema});
  }

  const schema = db.schema;

  if (options.export) {
    if (options.types) {
      options.types = options.types.split(/[,\s]+/);
    }
    if (options.java) {
      exportSchemaJava(schema, options);
    } else if (options.typescript) {
      print(printSchemaTypeScript(schema));
    } else {
      print(printSchema(schema));
    }
  } else if (options.select) {
    const [name, value] = options.select.split(':');
    const table = db.table(name);
    const pk = table.model.keyField().name;
    const filter = { [pk]: value };
    if (options.xstream || options.xml) {
      const result = await selectTree(table, filter);
      const serialiser = new XstreamSerialiser(result);
      const types = options.types ? options.types.split(/[,\s]+/) : [];
      print(serialiser.serialise(table.model, types));
    } else {
      const result = await table.selectTree(filter);
      print(result);
    }
  } else if (options.references) {
    const model = schema.model(options.references);
    const fields = getReferencingFields(model);
    for (const field of fields) {
      println(field.displayName());
    }
  } else if (options.rename) {
    const config = JSON.parse(fs.readFileSync(options.config).toString());
    setModelName(
      config,
      schema.model(options.rename),
      options.argv[options.argv.length - 1]
    );
    fs.writeFileSync(options.config, JSON.stringify(config, null, 4));
  } else if (options.fixForeignKeys) {
    const rule = options.fixForeignKeys.toLowerCase();
    const conn = await db.pool.getConnection();
    const rows = await conn.query(`
      select table_name, constraint_name, referenced_table_name, delete_rule
      from information_schema.referential_constraints
      where constraint_schema='${db.name}'
    `);
    for (const row of rows) {
      if (row.delete_rule.toLowerCase() !== rule) {
        const constraint = db
          .table(row.table_name)
          .model.table.constraints.find(
            constraint => constraint.name === row.constraint_name
          );
        await conn.query(`
          alter table \`${row.table_name}\`
          drop foreign key \`${row.constraint_name}\``);
        const fields = constraint.columns.map(name => `\`${name}\``).join(',');
        const pk = constraint.references.columns
          .map(name => `\`${name}\``)
          .join(',');
        await conn.query(`
          alter table \`${row.table_name}\`
          add constraint \`${row.constraint_name}\` foreign key(${fields})
          references \`${row.referenced_table_name}\`(${pk}) on delete ${rule}
        `);
      } else {
        println(`OK ${row.table_name} ${row.constraint_name}`);
      }
    }
  } else if (options.fixNextVal) {
    const conn = await db.pool.getConnection();
    const schemaName = conn.escapeId(options.schema);
    for (const table of db.tableList) {
      const column = table.keyColumn();
      if (column.autoIncrement) {
        const tableName = conn.escapeId(table.name);
        const rows = await conn.query(`select pg_get_serial_sequence('${schemaName}.${tableName}', '${column.name}')`);
        const seqName = rows[0].pg_get_serial_sequence;
        const keyName = conn.escapeId(column.name)
        let nextVal = +options.fixNextVal;
        if (nextVal <= 0) {
          nextVal = `(SELECT MAX(${keyName}) FROM ${schemaName}.${tableName})`;
        }
        console.log(`SELECT setval('${seqName}', ${nextVal});`);
        await conn.query(`SELECT setval('${seqName}', ${nextVal})`);
      }
    }
    conn.release();
  } else if (options.zap) {
    const excludes = (options.exclude || '').split(/[, ]+/)
    await db.zap(excludes);
  }
  else {
    print(schema.database, null, 4);
  }
  db.end();
})();

function print(o) {
  const s = typeof o === 'string' ? o : JSON.stringify(o);
  process.stdout.write(s);
}

function println(o) {
  print(o);
  print('\n');
}
