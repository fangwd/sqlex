import { ForeignKeyField, isValue } from './schema';
import { encodeFilter } from './filter';
import { Connection } from './engine';

import { Table, Filter, toDocument } from './database';
import { Document, Value } from './types';

export function createNode(
  connection: Connection,
  table: Table,
  row: Document
): Promise<any> {
  const dialect = table.db.pool;
  const closure = table.closureTable;

  const closureTable = dialect.escapeId(closure.table.model.table.name);
  const ancestor = dialect.escapeId(closure.ancestor.column.name);
  const descendant = dialect.escapeId(closure.descendant.column.name);
  // Note: assuming keyValue is integer; need escape(value, field) otherwise
  const keyValue = parseInt(table.model.keyValue(row) + '');

  let depth: string, depth_1: string, depth_0: string;
  if (closure.depth) {
    depth = `, ${dialect.escapeId(closure.depth.column.name)}`;
    depth_1 = `${depth} + 1`;
    depth_0 = ', 0';
  } else {
    depth = depth_1 = depth_0 = '';
  }

  const value = table.model.valueOf(row, table.getParentField());
  const where = value ? `= ${parseInt(value + '')}` : 'is null';

  const sql =
    `insert into ${closureTable} (${ancestor}, ${descendant}${depth}) ` +
    `select ${ancestor}, ${keyValue}${depth_1} ` +
    `from ${closureTable} where ${descendant} ${where} ` +
    `union all select ${keyValue}, ${keyValue}${depth_0}`;

  return connection.query(sql);
}

export function moveSubtree(
  connection: Connection,
  table: Table,
  row: Document
) {
  const escapeId = s => table.db.pool.escapeId(s);
  const escape = s => table.db.pool.escape(s);

  const closure = table.closureTable;

  const closureTable = escapeId(closure.table.model.table.name);
  const ancestor = escapeId(closure.ancestor.column.name);
  const descendant = escapeId(closure.descendant.column.name);
  const pk = escape(table.model.keyValue(row) + '');

  const deleteQuery = `
delete from ${closureTable}
where ${descendant} in (select * from (select ${descendant}
                        from  ${closureTable}
                        where ${ancestor} = ${pk}) as t1)
    and ${ancestor} in (select * from (select ${ancestor}
                        from ${closureTable}
                        where ${descendant} = ${pk}
                        and ${ancestor} != ${descendant}) as t2)
`;

  let depth, depth_1;
  if (closure.depth) {
    const name = escapeId(closure.depth.column.name);
    depth = `, ${name}`;
    depth_1 = `, t1.${name} + t2.${name} + 1`;
  } else {
    depth = depth_1 = '';
  }

  const parentId = table.model.valueOf(row, table.getParentField());

  const insertQuery = `
insert into ${closureTable} (${ancestor}, ${descendant}${depth})
select t1.${ancestor}, t2.${descendant}${depth_1}
from ${closureTable} as t1 cross join ${closureTable} as t2
where t1.${descendant} = ${parentId} and t2.${ancestor} = ${pk}
`;

  return connection
    .query(deleteQuery)
    .then(() => connection.query(insertQuery));
}

export function deleteSubtree(
  connection: Connection,
  table: Table,
  filter: string
) {
  const escapeId = s => table.db.pool.escapeId(s);
  const escape = s => table.db.pool.escape(s);

  const closure = table.closureTable;

  const closureTable = escapeId(closure.table.model.table.name);
  const ancestor = escapeId(closure.ancestor.column.name);
  const descendant = escapeId(closure.descendant.column.name);

  let where;
  if (filter) {
    const pk = escapeId(table.model.keyField().name);
    const from = escapeId(table.model.table.name);
    const select = `select ${pk} from ${from} where ${filter}`;
    where = ` where ${ancestor} in (${select})`;
  } else {
    where = '';
  }

  const query = `
delete from ${closureTable} where ${descendant} in 
  (select * from (select ${descendant} from ${closureTable}${where}) as t)
`;

  return connection.query(query);
}

export function treeQuery(
  connection: Connection,
  table: Table,
  node: Value | Document,
  joinField: ForeignKeyField,
  filter?: Filter
): Promise<Document[]> {
  const dialect = table.db.pool;
  const t0 = dialect.escapeId(table.model.table.name);
  const t1 = dialect.escapeId(table.closureTable.table.model.table.name);
  const key = table.model.keyField();
  const value = isValue(node) ? node : table.model.keyValue(node as Document);
  const lhs = dialect.escapeId(key.column.name);
  const rhs = dialect.escapeId(joinField.column.name);
  const field =
    joinField === table.closureTable.descendant
      ? dialect.escapeId(table.closureTable.ancestor.column.name)
      : dialect.escapeId(table.closureTable.descendant.column.name);

  let sql =
    `select ${t0}.* from ${t0} join ${t1} t1 on ${t0}.${lhs}=t1.${rhs}` +
    ` where t1.${field}=${table.escapeValue(key, value as Value)}`;

  if (filter) {
    const additional = encodeFilter(filter, table.model, dialect);
    if (additional) {
      sql += ` and ${additional}`;
    }
  }

  return connection
    .query(sql)
    .then(rows => rows.map(row => toDocument(row, table.model)));
}
