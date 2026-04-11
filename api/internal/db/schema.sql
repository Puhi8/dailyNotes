PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS app_state (
   id INTEGER PRIMARY KEY CHECK (id = 1),
   jwt TEXT,
   note_template TEXT
);
CREATE TABLE IF NOT EXISTS days (
   day_id INTEGER PRIMARY KEY AUTOINCREMENT,
   date DATE NOT NULL,
   note_text TEXT,
   data_json TEXT,
   UNIQUE (date)
);
CREATE TABLE IF NOT EXISTS accomplishments (
   accomplishment_id INTEGER PRIMARY KEY AUTOINCREMENT,
   name TEXT NOT NULL,
   type VARCHAR(20),
   active BOOLEAN NOT NULL DEFAULT TRUE,
   UNIQUE (name COLLATE NOCASE)
);
CREATE TABLE IF NOT EXISTS day_accomplishments (
   day_id INTEGER NOT NULL,
   accomplishment_id INTEGER NOT NULL,
   UNIQUE (day_id, accomplishment_id),
   FOREIGN KEY (day_id) REFERENCES days (day_id) ON DELETE CASCADE,
   FOREIGN KEY (accomplishment_id) REFERENCES accomplishments (accomplishment_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_days_date ON days (date);
CREATE INDEX IF NOT EXISTS idx_dayacc_day ON day_accomplishments (day_id);
CREATE INDEX IF NOT EXISTS idx_dayacc_acc ON day_accomplishments (accomplishment_id);
