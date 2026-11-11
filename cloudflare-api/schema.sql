-- NovaCompute D1 schema
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  company TEXT DEFAULT '',
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  balance REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT DEFAULT 'Default',
  key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used TEXT,
  status TEXT DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_keys_key ON api_keys(key);

CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  status TEXT DEFAULT 'ok',
  cost REAL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_usage_user_ts ON usage_events(user_id, ts);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  description TEXT DEFAULT '',
  method TEXT DEFAULT '',
  amount REAL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tx_user_ts ON transactions(user_id, ts);
