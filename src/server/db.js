import fs from 'node:fs';
import path from 'node:path';
import { openSqliteDatabase } from '../shared/sqlite.js';

const dataDir = path.resolve(process.cwd(), 'server-data');
fs.mkdirSync(dataDir, { recursive: true });

export const serverDb = await openSqliteDatabase(path.join(dataDir, 'auth.sqlite'));
serverDb.pragma('journal_mode = WAL');
serverDb.pragma('foreign_keys = ON');

serverDb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    unique_id TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 0,
    friend_code TEXT UNIQUE,
    public_key TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS verification_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS friends (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, friend_id)
  );
`);

export function publicUser(row, online = false) {
  if (!row) return null;
  return {
    id: row.id,
    uniqueId: row.unique_id,
    emailVerified: Boolean(row.email_verified),
    friendCode: row.friend_code,
    publicKey: row.public_key,
    online
  };
}