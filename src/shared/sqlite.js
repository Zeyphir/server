import initSqlJs from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let sqlPromise;

async function getSql() {
  if (!sqlPromise) {
    const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
    sqlPromise = initSqlJs({
      locateFile: () => wasmPath
    });
  }
  return sqlPromise;
}

export async function openSqliteDatabase(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const SQL = await getSql();
  const bytes = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  return new PersistedSqliteDatabase(new SQL.Database(bytes), filePath);
}

class PersistedSqliteDatabase {
  constructor(database, filePath) {
    this.database = database;
    this.filePath = filePath;
    this.transactionDepth = 0;
  }

  exec(sql) {
    this.database.exec(sql);
    this.save();
  }

  pragma(sql) {
    try {
      this.database.exec(`PRAGMA ${sql}`);
      this.save();
    } catch {
      // ignoré (sql.js ne gère pas tout comme SQLite natif)
    }
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  transaction(fn) {
    return (...args) => {
      const isOuter = this.transactionDepth === 0;
      const savepoint = `sp_${this.transactionDepth}`;

      this.transactionDepth++;

      try {
        // START TRANSACTION
        if (isOuter) {
          this.database.exec('BEGIN');
          console.log('[sqlite] BEGIN');
        } else {
          this.database.exec(`SAVEPOINT ${savepoint}`);
          console.log('[sqlite] SAVEPOINT', savepoint);
        }

        const result = fn(...args);

        // COMMIT
        if (isOuter) {
          this.database.exec('COMMIT');
          console.log('[sqlite] COMMIT');
        } else {
          this.database.exec(`RELEASE ${savepoint}`);
          console.log('[sqlite] RELEASE', savepoint);
        }

        return result;
      } catch (error) {
        // ROLLBACK sécurisé
        try {
          if (isOuter) {
            this.database.exec('ROLLBACK');
            console.warn('[sqlite] ROLLBACK');
          } else {
            this.database.exec(`ROLLBACK TO ${savepoint}`);
            console.warn('[sqlite] ROLLBACK TO', savepoint);
          }
        } catch (e) {
          console.warn('[sqlite] rollback ignoré:', e.message);
        }

        throw error;
      } finally {
        this.transactionDepth--;

        // sauvegarde uniquement hors transaction
        if (this.transactionDepth === 0) {
          this.save();
        }
      }
    };
  }

  save() {
    if (this.transactionDepth > 0) return;
    fs.writeFileSync(this.filePath, Buffer.from(this.database.export()));
  }
}

class Statement {
  constructor(owner, sql) {
    this.owner = owner;
    this.sql = sql;
  }

  run(...params) {
    const stmt = this.owner.database.prepare(this.sql);
    try {
      stmt.run(normalizeParams(params));
      this.owner.save();
      return { changes: this.owner.database.getRowsModified() };
    } finally {
      stmt.free();
    }
  }

  get(...params) {
    const stmt = this.owner.database.prepare(this.sql);
    try {
      stmt.bind(normalizeParams(params));
      if (!stmt.step()) return undefined;
      return stmt.getAsObject();
    } finally {
      stmt.free();
    }
  }

  all(...params) {
    const stmt = this.owner.database.prepare(this.sql);
    const rows = [];
    try {
      stmt.bind(normalizeParams(params));
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }
}

function normalizeParams(params) {
  if (params.length === 0) return [];
  if (params.length > 1) return params;

  const value = params[0];

  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return [value];
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => [
      [`@${key}`, item],
      [`:${key}`, item],
      [`$${key}`, item]
    ])
  );
} 