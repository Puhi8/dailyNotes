package main

import (
	"dailyNotes/internal/db"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type overallTasksFile struct {
	Days            map[string]map[string]any `json:"days"`
	Accomplishments []overallAccomplishment   `json:"accomplishments"`
}

type overallAccomplishment struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type legacyDay struct {
	Date string
	Note string
	Data map[string]any
}

var dayDirPattern = regexp.MustCompile(`^\d{2}-\d{2}-\d{2}$`)

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: go run ./cmd/migrate_legacy <legacy-data-dir> <new-db-path>")
		os.Exit(1)
	}

	legacyDataDir := strings.TrimSpace(os.Args[1])
	if legacyDataDir == "" {
		fmt.Fprintln(os.Stderr, "error: legacy-data-dir is required")
		os.Exit(1)
	}

	dbPath := strings.TrimSpace(os.Args[2])
	if dbPath == "" {
		fmt.Fprintln(os.Stderr, "error: new-db-path is required")
		os.Exit(1)
	}

	if err := db.InitDatabase(dbPath); err != nil {
		fmt.Fprintf(os.Stderr, "error: init db: %v\n", err)
		os.Exit(1)
	}

	legacyData, err := loadLegacyData(legacyDataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: load legacy data: %v\n", err)
		os.Exit(1)
	}

	if err := importLegacyData(legacyData); err != nil {
		fmt.Fprintf(os.Stderr, "error: import legacy data: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Migration complete.\n")
	fmt.Printf("Imported %d day entries.\n", len(legacyData.days))
	fmt.Printf("Imported/updated %d accomplishments.\n", len(legacyData.accomplishments))
}

type legacyImportData struct {
	days            []legacyDay
	accomplishments []overallAccomplishment
}

func loadLegacyData(dataDir string) (legacyImportData, error) {
	overallPath := filepath.Join(dataDir, "overallTasks.json")
	overall, err := readOverallTasks(overallPath)
	if err != nil {
		return legacyImportData{}, err
	}

	daysByDate := make(map[string]*legacyDay, len(overall.Days))
	for date, rawData := range overall.Days {
		normDate := normalizeDateLabel(date)
		if normDate == "" {
			continue
		}
		daysByDate[normDate] = &legacyDay{
			Date: normDate,
			Data: normalizeDayData(rawData),
		}
	}

	dirEntries, err := os.ReadDir(dataDir)
	if err != nil {
		return legacyImportData{}, err
	}
	for _, entry := range dirEntries {
		if !entry.IsDir() {
			continue
		}
		dirName := strings.TrimSpace(entry.Name())
		if !dayDirPattern.MatchString(dirName) {
			continue
		}
		normDate := normalizeDateLabel(dirName)
		if normDate == "" {
			continue
		}

		day := daysByDate[normDate]
		if day == nil {
			day = &legacyDay{
				Date: normDate,
				Data: map[string]any{},
			}
			daysByDate[normDate] = day
		}

		dayDirPath := filepath.Join(dataDir, dirName)
		dailyDataPath := filepath.Join(dayDirPath, "dailyAccomplishment.json")
		dailyData, readErr := readJSONMapIfExists(dailyDataPath)
		if readErr != nil {
			return legacyImportData{}, fmt.Errorf("read %s: %w", dailyDataPath, readErr)
		}
		for key, value := range dailyData {
			trimmedKey := strings.TrimSpace(key)
			if trimmedKey == "" {
				continue
			}
			day.Data[trimmedKey] = value
		}

		notePath := filepath.Join(dayDirPath, dirName+".md")
		note, noteErr := readTextIfExists(notePath)
		if noteErr != nil {
			return legacyImportData{}, fmt.Errorf("read %s: %w", notePath, noteErr)
		}
		if note != "" {
			day.Note = note
		}
	}

	days := make([]legacyDay, 0, len(daysByDate))
	for _, day := range daysByDate {
		if day == nil {
			continue
		}
		if day.Data == nil {
			day.Data = map[string]any{}
		}
		days = append(days, *day)
	}
	sort.Slice(days, func(i, j int) bool {
		return days[i].Date < days[j].Date
	})

	accomplishments := dedupeAccomplishments(overall.Accomplishments)
	return legacyImportData{
		days:            days,
		accomplishments: accomplishments,
	}, nil
}

func readOverallTasks(path string) (overallTasksFile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return overallTasksFile{
				Days:            map[string]map[string]any{},
				Accomplishments: []overallAccomplishment{},
			}, nil
		}
		return overallTasksFile{}, err
	}
	var parsed overallTasksFile
	if err := json.Unmarshal(data, &parsed); err != nil {
		return overallTasksFile{}, err
	}
	if parsed.Days == nil {
		parsed.Days = map[string]map[string]any{}
	}
	if parsed.Accomplishments == nil {
		parsed.Accomplishments = []overallAccomplishment{}
	}
	return parsed, nil
}

func readJSONMapIfExists(path string) (map[string]any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return map[string]any{}, nil
		}
		return nil, err
	}
	var parsed map[string]any
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil, err
	}
	if parsed == nil {
		return map[string]any{}, nil
	}
	return normalizeDayData(parsed), nil
}

func readTextIfExists(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", nil
		}
		return "", err
	}
	return strings.TrimRight(string(data), "\r\n"), nil
}

func normalizeDateLabel(date string) string {
	trimmed := strings.TrimSpace(date)
	if dayDirPattern.MatchString(trimmed) {
		return trimmed
	}
	return ""
}

func normalizeDayData(raw map[string]any) map[string]any {
	result := make(map[string]any)
	for key, value := range raw {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" {
			continue
		}
		switch typed := value.(type) {
		case nil:
			result[trimmedKey] = nil
		case bool:
			result[trimmedKey] = typed
		case string:
			result[trimmedKey] = typed
		case float64:
			result[trimmedKey] = typed
		default:
			// Keep unsupported values as string for safer import.
			result[trimmedKey] = fmt.Sprintf("%v", typed)
		}
	}
	return result
}

func dedupeAccomplishments(items []overallAccomplishment) []overallAccomplishment {
	seen := make(map[string]struct{}, len(items))
	result := make([]overallAccomplishment, 0, len(items))
	for _, item := range items {
		name := strings.TrimSpace(item.Text)
		if name == "" {
			continue
		}
		itemType := strings.TrimSpace(item.Type)
		key := strings.ToLower(name)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, overallAccomplishment{
			Text: name,
			Type: itemType,
		})
	}
	return result
}

func importLegacyData(payload legacyImportData) error {
	tx, err := db.DB.Begin()
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	for _, item := range payload.accomplishments {
		if item.Text == "" {
			continue
		}
		_, err := tx.Exec(`
			INSERT INTO accomplishments (name, type, active)
			SELECT ?, ?, TRUE
			WHERE NOT EXISTS (
				SELECT 1 FROM accomplishments
				WHERE lower(name) = lower(?)
			);
		`, item.Text, item.Type, item.Text)
		if err != nil {
			return err
		}
	}

	for _, day := range payload.days {
		if day.Date == "" {
			continue
		}
		dayJSON, err := json.Marshal(day.Data)
		if err != nil {
			return err
		}
		_, err = tx.Exec(`
			INSERT INTO days (date, note_text, data_json)
			VALUES (?, ?, ?)
			ON CONFLICT (date) DO UPDATE SET
				note_text = excluded.note_text,
				data_json = excluded.data_json;
		`, day.Date, day.Note, string(dayJSON))
		if err != nil {
			return err
		}

		for name := range day.Data {
			trimmedName := strings.TrimSpace(name)
			if trimmedName == "" {
				continue
			}
			_, err := tx.Exec(`
				INSERT INTO accomplishments (name, type, active)
				SELECT ?, '', TRUE
				WHERE NOT EXISTS (
					SELECT 1 FROM accomplishments
					WHERE lower(name) = lower(?)
				);
			`, trimmedName, trimmedName)
			if err != nil {
				return err
			}
		}
	}

	return tx.Commit()
}
