#!/usr/bin/env bash

const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const Database = require('better-sqlite3');

function fatal(msg) {
  console.log(chalk.red(msg));
  process.exit(1);
}

function heapsnapshot() {
  const filename = process.argv.slice(2)[0];
  if (!filename) fatal('请提供 Heapsnapshot 文件')
  return filename;
}


function dbName(dumpName) {
  return `${path.parse(dumpName).name}.db`;
}

async function openDB(dumpName) {
  return new Database(dbName(dumpName));
}

async function restoreDump(dumpName) {
  const raw = await fs.promises.readFile(dumpName, "utf-8");
  return JSON.parse(raw);
}

async function initDB(db) {
  console.log(chalk.cyan('Initializing database...'));
  return db.exec(`
    CREATE TABLE IF NOT EXISTS node (
      id INTEGER PRIMARY KEY,
      name VARCHAR(50),
      type VARCHAR(50),
      self_size INTEGER,
      edge_count INTEGER,
      trace_node_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS edge (
      from_node INTEGER,
      to_node INTEGER,
      type VARCHAR(50),
      name_or_index VARCHAR(50)
    );
  `)
}

function node_value({heap, node, node_start, field}) {
  const meta = heap['snapshot']['meta'];
  const strings = heap['strings'];

  const node_fields = meta['node_fields'];
  const node_field_count = node_fields.length;
  const node_field_types = meta['node_types'];
  const node_field_values = heap['nodes'];

  node_start = node_start || node * node_field_count
  const value = node_field_values[node_start + field];
  const type = node_field_types[field];
  if (type === "string") return strings[value];
  if (type === "number") return value;
  if (Array.isArray(type)) return type[value];
  throw new Error("unsupported type: " + type)
}

function insertNodes(heap, db) {
  const meta = heap['snapshot']['meta'];
  const node_count = heap['snapshot']['node_count'];

  const node_fields = meta['node_fields'];
  const node_field_count = node_fields.length;

  const node_fields_str = node_fields.join(',');
  const node_field_slots = new Array(node_field_count).fill(0).map(() => '?').join(',')

  const sql = `INSERT INTO node (${node_fields_str}) VALUES (${node_field_slots})`;
  const insert = db.prepare(sql);
  const tx = db.transaction((rows) => {
    for (const row of rows) insert.run(...row);
  });

  const rows = []
  for (let i = 0; i < node_count; ++i) {
    const values = [];
    for (let j = 0; j < node_field_count; ++j) {
      values.push(node_value({heap, node: i, field: j}));
    }
    rows.push(values);
  }

  tx(rows);
}

function edge_value({heap, edge, field, resolvers}) {
  const meta = heap['snapshot']['meta'];
  const strings = heap['strings'];

  const edge_field_values = heap['edges'];
  const edge_field_types = meta['edge_types'];

  const value = edge_field_values[edge + field];
  const type = edge_field_types[field];
  if (type === "string" || type === "string_or_number") return strings[value];
  if (type === "number") return value;
  if (Array.isArray(type)) return type[value];
  else if (resolvers[type]) return resolvers[type](value);
  throw new Error("unsupported type: " + type)
}

async function insertEdges(heap, db) {
  const meta = heap['snapshot']['meta'];
  const node_count = heap['snapshot']['node_count'];

  const node_fields = meta['node_fields'];

  const edge_fields = meta["edge_fields"];
  const edge_field_count = edge_fields.length;

  const node_id_ofst = node_fields.indexOf('id');
  const edge_count_ofst = node_fields.indexOf('edge_count');

  const edge_fields_str = edge_fields.join(',');
  const edge_field_slots = new Array(edge_field_count).fill(0).map(() => '?').join(',')

  const sql = `INSERT INTO edge (from_node,${edge_fields_str}) VALUES (?,${edge_field_slots})`;
  const insert = db.prepare(sql);
  const tx = db.transaction((rows) => {
    for (const row of rows) insert.run(...row);
  });

  const rows = [];
  let edge = 0;
  for (let i = 0; i < node_count; ++i) {
    const node_id = node_value({heap, node: i, field: node_id_ofst});
    const node_edge_count = node_value({heap, node: i, field: edge_count_ofst});

    for (let j = 0; j < node_edge_count; ++j) {
      const values = [node_id];

      for (let k = 0; k < edge_field_count; ++k) {
        values.push(edge_value({
          heap,
          edge,
          field: k,
          resolvers: {
            node(to_node) {
              return node_value({heap, node_start: to_node, field: node_id_ofst})
            }
          }
        }))
      }
      rows.push(values);
      edge += edge_field_count;
    }
  }

  tx(rows);
}

function task(label, fn) {
  console.log(chalk.cyan(label));
  fn();
}

async function run() {
  const dump = heapsnapshot();

  const db = await openDB(dump);
  await initDB(db);

  const heap = await restoreDump(dump);
  task('Inserting nodes...', () => insertNodes(heap, db));
  task('Inserting edges...', () => insertEdges(heap, db));
}

run();
