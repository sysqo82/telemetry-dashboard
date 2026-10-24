import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { schemaSql } from './schema.js';

export type Db = Database.Database;

export function openDb(dbPath: string): Db {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('temp_store = MEMORY');
  db.pragma('cache_size = -64000');
  db.exec(schemaSql);
  return db;
}
