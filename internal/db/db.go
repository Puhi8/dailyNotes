package db

import (
	"context"
	"database/sql"
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

const singleUserID int64 = 1

var DB *sql.DB

//go:embed schema.sql
var embeddedSchemaSQL string

type DayRow struct {
	DayID    int64
	Date     string
	NoteText sql.NullString
	DataJSON sql.NullString
}

type UserAuthRow struct {
	UserID int64
	JWT    sql.NullString
}

type AccomplishmentsRow struct {
	AccomplishmentID int64
	Name             string
	Type             sql.NullString
	Active           sql.NullBool
}

func InitDatabase(dbPath string) error {
	if info, err := os.Stat(dbPath); err == nil && info.IsDir() {
		dbPath = filepath.Join(dbPath, "daily_notes.db")
	}
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create db dir %s: %w", dir, err)
	}
	var err error
	DB, err = sql.Open("sqlite", dbPath)
	if err != nil {
		return fmt.Errorf("open sqlite db %s: %w", dbPath, err)
	}
	// Keep SQLite access serialized to avoid lock contention.
	DB.SetMaxOpenConns(1)
	DB.SetMaxIdleConns(1)
	DB.SetConnMaxLifetime(0)

	if err := DB.PingContext(context.Background()); err != nil {
		return fmt.Errorf("ping sqlite db %s: %w", dbPath, err)
	}
	if err := applySQLiteRuntimePragmas(); err != nil {
		return fmt.Errorf("configure sqlite pragmas: %w", err)
	}
	schemaBytes, err := readSchemaFile()
	if err != nil {
		return fmt.Errorf("read schema.sql: %w", err)
	}
	if _, err := DB.ExecContext(context.Background(), string(schemaBytes)); err != nil {
		return fmt.Errorf("init sqlite schema: %w", err)
	}
	if err := ensureDaysDataColumn(); err != nil {
		return fmt.Errorf("ensure data_json column: %w", err)
	}
	if err := ensureAccomplishmentsActiveColumn(); err != nil {
		return fmt.Errorf("ensure accomplishments active column: %w", err)
	}
	if err := migrateLegacyMultiUserSchema(); err != nil {
		return fmt.Errorf("migrate legacy multi-user schema: %w", err)
	}
	if err := ensureAppStateRow(); err != nil {
		return fmt.Errorf("ensure app_state row: %w", err)
	}
	if err := ensureSingleUserIndexes(); err != nil {
		return fmt.Errorf("ensure single-user indexes: %w", err)
	}
	return nil
}

func applySQLiteRuntimePragmas() error {
	ctx := context.Background()
	statements := []string{
		`PRAGMA journal_mode = WAL;`,
		`PRAGMA busy_timeout = 5000;`,
		`PRAGMA foreign_keys = ON;`,
	}
	for _, statement := range statements {
		if _, err := DB.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("%s: %w", statement, err)
		}
	}
	return nil
}

func ensureDaysDataColumn() error {
	_, err := DB.Exec(`ALTER TABLE days ADD COLUMN data_json TEXT;`)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
			return nil
		}
		return err
	}
	return nil
}

func ensureAccomplishmentsActiveColumn() error {
	_, err := DB.Exec(`ALTER TABLE accomplishments ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE;`)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
			return nil
		}
		return err
	}
	return nil
}

func ensureSingleUserIndexes() error {
	if _, err := DB.Exec(`CREATE INDEX IF NOT EXISTS idx_days_date ON days (date);`); err != nil {
		return err
	}
	if _, err := DB.Exec(`CREATE INDEX IF NOT EXISTS idx_dayacc_day ON day_accomplishments (day_id);`); err != nil {
		return err
	}
	if _, err := DB.Exec(`CREATE INDEX IF NOT EXISTS idx_dayacc_acc ON day_accomplishments (accomplishment_id);`); err != nil {
		return err
	}
	return nil
}

func migrateLegacyMultiUserSchema() error {
	usersExists, err := tableExists("users")
	if err != nil {
		return err
	}
	daysHasUserID, err := columnExists("days", "user_id")
	if err != nil {
		return err
	}
	accomplishmentsHasUserID, err := columnExists("accomplishments", "user_id")
	if err != nil {
		return err
	}
	if !usersExists && !daysHasUserID && !accomplishmentsHasUserID {
		return nil
	}

	if _, err := DB.Exec(`PRAGMA foreign_keys = OFF;`); err != nil {
		return err
	}
	tx, err := DB.Begin()
	if err != nil {
		_, _ = DB.Exec(`PRAGMA foreign_keys = ON;`)
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
		_, _ = DB.Exec(`PRAGMA foreign_keys = ON;`)
	}()

	if _, err := tx.Exec(`
		CREATE TABLE IF NOT EXISTS app_state (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			jwt TEXT,
			note_template TEXT
		);
	`); err != nil {
		return err
	}

	legacyJWT := ""
	legacyTemplate := ""
	if err := tx.QueryRow(`SELECT jwt, note_template FROM app_state WHERE id = 1`).Scan(&legacyJWT, &legacyTemplate); err != nil && err != sql.ErrNoRows {
		return err
	}
	if usersExists {
		var jwt sql.NullString
		var template sql.NullString
		err := tx.QueryRow(`SELECT jwt, note_template FROM users ORDER BY user_id LIMIT 1`).Scan(&jwt, &template)
		if err != nil && err != sql.ErrNoRows {
			return err
		}
		if err == nil {
			if jwt.Valid {
				legacyJWT = jwt.String
			}
			if template.Valid {
				legacyTemplate = template.String
			}
		}
	}

	if _, err := tx.Exec(`
		INSERT INTO app_state (id, jwt, note_template)
		VALUES (1, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			jwt = excluded.jwt,
			note_template = excluded.note_template;
	`, legacyJWT, legacyTemplate); err != nil {
		return err
	}

	if daysHasUserID || accomplishmentsHasUserID {
		if _, err := tx.Exec(`DROP TABLE IF EXISTS day_accomplishments;`); err != nil {
			return err
		}
	}

	if daysHasUserID {
		if _, err := tx.Exec(`ALTER TABLE days RENAME TO days_legacy;`); err != nil {
			return err
		}
		if _, err := tx.Exec(`
			CREATE TABLE days (
				day_id INTEGER PRIMARY KEY AUTOINCREMENT,
				date DATE NOT NULL,
				note_text TEXT,
				data_json TEXT,
				UNIQUE (date)
			);
		`); err != nil {
			return err
		}
		if _, err := tx.Exec(`
			INSERT INTO days (date, note_text, data_json)
			SELECT d.date, d.note_text, d.data_json
			FROM days_legacy d
			JOIN (
				SELECT date, MIN(day_id) AS keep_day_id
				FROM days_legacy
				WHERE date IS NOT NULL AND TRIM(date) <> ''
				GROUP BY date
			) chosen ON chosen.keep_day_id = d.day_id
			ORDER BY d.date;
		`); err != nil {
			return err
		}
		if _, err := tx.Exec(`DROP TABLE days_legacy;`); err != nil {
			return err
		}
	}

	if accomplishmentsHasUserID {
		if _, err := tx.Exec(`ALTER TABLE accomplishments RENAME TO accomplishments_legacy;`); err != nil {
			return err
		}
		if _, err := tx.Exec(`
			CREATE TABLE accomplishments (
				accomplishment_id INTEGER PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL,
				type VARCHAR(20),
				active BOOLEAN NOT NULL DEFAULT TRUE,
				UNIQUE (name COLLATE NOCASE)
			);
		`); err != nil {
			return err
		}
		if _, err := tx.Exec(`
			INSERT INTO accomplishments (name, type, active)
			SELECT TRIM(a.name), TRIM(COALESCE(a.type, '')), COALESCE(a.active, TRUE)
			FROM accomplishments_legacy a
			JOIN (
				SELECT MIN(accomplishment_id) AS keep_id
				FROM accomplishments_legacy
				WHERE TRIM(name) <> ''
				GROUP BY lower(TRIM(name))
			) chosen ON chosen.keep_id = a.accomplishment_id
			ORDER BY lower(TRIM(a.name));
		`); err != nil {
			return err
		}
		if _, err := tx.Exec(`DROP TABLE accomplishments_legacy;`); err != nil {
			return err
		}
	}

	if usersExists {
		if _, err := tx.Exec(`DROP TABLE users;`); err != nil {
			return err
		}
	}

	if _, err := tx.Exec(`
		CREATE TABLE IF NOT EXISTS day_accomplishments (
			day_id INTEGER NOT NULL,
			accomplishment_id INTEGER NOT NULL,
			UNIQUE (day_id, accomplishment_id),
			FOREIGN KEY (day_id) REFERENCES days (day_id) ON DELETE CASCADE,
			FOREIGN KEY (accomplishment_id) REFERENCES accomplishments (accomplishment_id) ON DELETE CASCADE
		);
	`); err != nil {
		return err
	}
	if _, err := tx.Exec(`CREATE INDEX IF NOT EXISTS idx_days_date ON days (date);`); err != nil {
		return err
	}
	if _, err := tx.Exec(`CREATE INDEX IF NOT EXISTS idx_dayacc_day ON day_accomplishments (day_id);`); err != nil {
		return err
	}
	if _, err := tx.Exec(`CREATE INDEX IF NOT EXISTS idx_dayacc_acc ON day_accomplishments (accomplishment_id);`); err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return err
	}
	committed = true
	return nil
}

func tableExists(tableName string) (bool, error) {
	var count int
	err := DB.QueryRow(`SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = ?;`, tableName).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func quoteIdentifier(identifier string) string {
	return `"` + strings.ReplaceAll(identifier, `"`, `""`) + `"`
}

func columnExists(tableName string, columnName string) (bool, error) {
	exists, err := tableExists(tableName)
	if err != nil {
		return false, err
	}
	if !exists {
		return false, nil
	}
	rows, err := DB.Query(fmt.Sprintf(`PRAGMA table_info(%s);`, quoteIdentifier(tableName)))
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var (
			cid        int
			name       string
			typeName   string
			notNull    int
			defaultVal sql.NullString
			pk         int
		)
		if err := rows.Scan(&cid, &name, &typeName, &notNull, &defaultVal, &pk); err != nil {
			return false, err
		}
		if strings.EqualFold(strings.TrimSpace(name), strings.TrimSpace(columnName)) {
			return true, nil
		}
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	return false, nil
}

func ensureAppStateRow() error {
	_, err := DB.Exec(`
		INSERT INTO app_state (id, jwt, note_template)
		VALUES (1, '', '')
		ON CONFLICT(id) DO NOTHING;
	`)
	return err
}

func EnsureAppState() error {
	return ensureAppStateRow()
}

func readSchemaFile() ([]byte, error) {
	if strings.TrimSpace(embeddedSchemaSQL) != "" {
		return []byte(embeddedSchemaSQL), nil
	}
	return nil, fmt.Errorf("embedded schema.sql is empty")
}

func GetUserAuthByID(_ int64) (UserAuthRow, error) {
	var row UserAuthRow
	err := DB.QueryRow(`SELECT jwt FROM app_state WHERE id = 1;`).Scan(&row.JWT)
	if err != nil {
		return UserAuthRow{}, err
	}
	row.UserID = singleUserID
	return row, nil
}

func GetAllUserAuth() ([]UserAuthRow, error) {
	row, err := GetUserAuthByID(singleUserID)
	if err != nil {
		if err == sql.ErrNoRows {
			return []UserAuthRow{}, nil
		}
		return nil, err
	}
	return []UserAuthRow{row}, nil
}

func UpdateUserJWT(_ int64, jwt string) error {
	if err := ensureAppStateRow(); err != nil {
		return err
	}
	_, err := DB.Exec(`UPDATE app_state SET jwt = ? WHERE id = 1;`, jwt)
	return err
}

func GetUserNoteTemplate(_ int64) (string, error) {
	var template sql.NullString
	err := DB.QueryRow(`SELECT note_template FROM app_state WHERE id = 1;`).Scan(&template)
	if err != nil {
		return "", err
	}
	if template.Valid {
		return template.String, nil
	}
	return "", nil
}

func GetAllAccomplishments(_ int64) ([]AccomplishmentsRow, error) {
	rows, err := DB.Query(`
		SELECT accomplishment_id, name, type, active
		FROM accomplishments
		ORDER BY name;
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results := make([]AccomplishmentsRow, 0)
	for rows.Next() {
		var row AccomplishmentsRow
		if err := rows.Scan(&row.AccomplishmentID, &row.Name, &row.Type, &row.Active); err != nil {
			return nil, err
		}
		results = append(results, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return results, nil
}

func GetDaysForUser(_ int64) ([]DayRow, error) {
	rows, err := DB.Query(`
		SELECT day_id, date, note_text, data_json
		FROM days
		ORDER BY date DESC;
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results := make([]DayRow, 0)
	for rows.Next() {
		var row DayRow
		if err := rows.Scan(&row.DayID, &row.Date, &row.NoteText, &row.DataJSON); err != nil {
			return nil, err
		}
		results = append(results, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return results, nil
}
