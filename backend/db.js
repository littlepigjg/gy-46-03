import initSqlJs from 'sql.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, 'data.db');

let dbInstance = null;

function wrapStatement(stmt, db) {
  return {
    run(...params) {
      stmt.bind(params);
      while (stmt.step()) {}
      const lastId = db.exec('SELECT last_insert_rowid() AS id')[0]?.values[0][0];
      const changes = db.exec('SELECT changes() AS c')[0]?.values[0][0];
      stmt.reset();
      stmt.free();
      return { lastInsertRowid: lastId, changes: changes };
    },
    get(...params) {
      stmt.bind(params);
      let result = null;
      if (stmt.step()) {
        result = stmt.getAsObject();
      }
      stmt.reset();
      stmt.free();
      return result;
    },
    all(...params) {
      stmt.bind(params);
      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.reset();
      stmt.free();
      return results;
    }
  };
}

async function initDb() {
  const SQL = await initSqlJs({
    locateFile: (file) => {
      const modPath = path.dirname(new URL(import.meta.resolve('sql.js')).pathname.replace(/^\/([A-Z]:)/, '$1'));
      return path.join(modPath, file);
    }
  });

  let db;
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS urls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'daily',
      status TEXT NOT NULL DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_screenshot_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS screenshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url_id INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (url_id) REFERENCES urls(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_screenshots_url_id ON screenshots(url_id);
    CREATE INDEX IF NOT EXISTS idx_screenshots_created_at ON screenshots(created_at);
  `);

  const wrappedDb = {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return wrapStatement(stmt, db);
    },
    exec(sql) {
      db.exec(sql);
    },
    pragma() {},
    save() {
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(DB_PATH, buffer);
    }
  };

  const origPrepare = wrappedDb.prepare;
  wrappedDb.prepare = function(sql) {
    const wrapped = origPrepare.call(this, sql);
    const origRun = wrapped.run;
    wrapped.run = function(...args) {
      const ret = origRun.call(this, ...args);
      wrappedDb.save();
      return ret;
    };
    return wrapped;
  };

  return wrappedDb;
}

export default async function getDb() {
  if (!dbInstance) {
    dbInstance = await initDb();
  }
  return dbInstance;
}
