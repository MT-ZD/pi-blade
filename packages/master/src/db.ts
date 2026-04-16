import { Database } from "bun:sqlite";

const DB_PATH = process.env.PI_BLADE_DB || "./pi-blade.db";

let db: Database;

export function getDb(): Database {
  if (!db) {
    db = new Database(DB_PATH, { create: true });
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    migrate(db);
  }
  return db;
}

function migrate(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS blades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      hostname TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'online',
      registered_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT 'main',
      poll_interval INTEGER NOT NULL DEFAULT 60,
      is_monorepo INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      name TEXT UNIQUE NOT NULL,
      path TEXT NOT NULL DEFAULT '.',
      dockerfile_path TEXT NOT NULL DEFAULT 'Dockerfile',
      active_environment TEXT NOT NULL DEFAULT 'production'
    );

    CREATE TABLE IF NOT EXISTS project_environments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      environment TEXT NOT NULL,
      UNIQUE(project_id, environment)
    );

    CREATE TABLE IF NOT EXISTS project_env_vars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_env_id INTEGER NOT NULL REFERENCES project_environments(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_blades (
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      blade_id INTEGER NOT NULL REFERENCES blades(id) ON DELETE CASCADE,
      port INTEGER NOT NULL,
      PRIMARY KEY (project_id, blade_id)
    );

    CREATE TABLE IF NOT EXISTS deploys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      image_tag TEXT NOT NULL,
      commit_sha TEXT,
      blade_id INTEGER NOT NULL REFERENCES blades(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      log TEXT
    );

    CREATE TABLE IF NOT EXISTS routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS upstreams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
      blade_id INTEGER NOT NULL REFERENCES blades(id) ON DELETE CASCADE,
      port INTEGER NOT NULL,
      weight INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      blade_id INTEGER REFERENCES blades(id) ON DELETE SET NULL,
      message TEXT NOT NULL,
      discord_sent INTEGER NOT NULL DEFAULT 0,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS metrics_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blade_id INTEGER NOT NULL REFERENCES blades(id) ON DELETE CASCADE,
      cpu_percent REAL NOT NULL,
      memory_percent REAL NOT NULL,
      disk_percent REAL NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_metrics_history_blade_time
      ON metrics_history (blade_id, timestamp);
  `);

  try {
    db.exec("ALTER TABLE repos ADD COLUMN ssh_key TEXT");
  } catch (_) {}

  try {
    db.exec("ALTER TABLE projects ADD COLUMN active_environment TEXT NOT NULL DEFAULT 'production'");
  } catch (_) {}
}
