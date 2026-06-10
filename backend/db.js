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
      const currentDir = decodeURIComponent(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')));
      return path.join(currentDir, 'node_modules', 'sql.js', 'dist', file);
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

    CREATE TABLE IF NOT EXISTS alert_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url_id INTEGER NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 1,
      overall_threshold REAL NOT NULL DEFAULT 0.05,
      layout_threshold REAL NOT NULL DEFAULT 0.10,
      content_threshold REAL NOT NULL DEFAULT 0.05,
      style_threshold REAL NOT NULL DEFAULT 0.08,
      notify_in_app INTEGER NOT NULL DEFAULT 1,
      notify_email INTEGER NOT NULL DEFAULT 0,
      email_address TEXT,
      cooldown_minutes INTEGER NOT NULL DEFAULT 60,
      auto_learn INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (url_id) REFERENCES urls(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url_id INTEGER NOT NULL,
      screenshot_before_id INTEGER,
      screenshot_after_id INTEGER NOT NULL,
      overall_score REAL NOT NULL,
      layout_score REAL NOT NULL,
      content_score REAL NOT NULL,
      style_score REAL NOT NULL,
      change_types TEXT NOT NULL,
      diff_regions TEXT,
      is_false_positive INTEGER NOT NULL DEFAULT 0,
      notified INTEGER NOT NULL DEFAULT 0,
      notification_channels TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (url_id) REFERENCES urls(id) ON DELETE CASCADE,
      FOREIGN KEY (screenshot_before_id) REFERENCES screenshots(id) ON DELETE SET NULL,
      FOREIGN KEY (screenshot_after_id) REFERENCES screenshots(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_url_id ON alerts(url_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at);
    CREATE INDEX IF NOT EXISTS idx_alerts_false_positive ON alerts(is_false_positive);

    CREATE TABLE IF NOT EXISTS diff_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url_id INTEGER NOT NULL,
      screenshot_before_id INTEGER,
      screenshot_after_id INTEGER NOT NULL,
      overall_score REAL NOT NULL,
      layout_score REAL NOT NULL,
      content_score REAL NOT NULL,
      style_score REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (url_id) REFERENCES urls(id) ON DELETE CASCADE,
      FOREIGN KEY (screenshot_before_id) REFERENCES screenshots(id) ON DELETE SET NULL,
      FOREIGN KEY (screenshot_after_id) REFERENCES screenshots(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_diff_history_url_id ON diff_history(url_id);
    CREATE INDEX IF NOT EXISTS idx_diff_history_created_at ON diff_history(created_at);

    CREATE TABLE IF NOT EXISTS threshold_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url_id INTEGER NOT NULL UNIQUE,
      total_comparisons INTEGER NOT NULL DEFAULT 0,
      alert_count INTEGER NOT NULL DEFAULT 0,
      false_positive_count INTEGER NOT NULL DEFAULT 0,
      avg_overall_score REAL NOT NULL DEFAULT 0,
      avg_layout_score REAL NOT NULL DEFAULT 0,
      avg_content_score REAL NOT NULL DEFAULT 0,
      avg_style_score REAL NOT NULL DEFAULT 0,
      std_overall_score REAL NOT NULL DEFAULT 0,
      last_learned_at DATETIME,
      FOREIGN KEY (url_id) REFERENCES urls(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id INTEGER NOT NULL,
      channel TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_alert_id ON notifications(alert_id);
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
