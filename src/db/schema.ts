export const schemaSql = `
CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  title TEXT NOT NULL,
  culprit TEXT,
  status TEXT NOT NULL DEFAULT 'unresolved',
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  service TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'production',
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  stacktrace TEXT,
  tags TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_issue ON events(issue_id, created_at);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_issues_status_last_seen ON issues(status, last_seen_at);

CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
  message,
  stacktrace,
  content='events',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
  INSERT INTO events_fts(rowid, message, stacktrace) VALUES (new.rowid, new.message, new.stacktrace);
END;

CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
  INSERT INTO events_fts(events_fts, rowid, message, stacktrace) VALUES ('delete', old.rowid, old.message, old.stacktrace);
END;
`;
