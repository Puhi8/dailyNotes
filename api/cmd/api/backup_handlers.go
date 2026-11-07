package main

import (
	"dailyNotes/internal/db"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"
)

const (
	maxBackupSnapshotBodyBytes int64 = 16 * 1024 * 1024
	maxBackupTemplateBytes           = 256 * 1024
	maxBackupNoteBytes               = 1024 * 1024
	maxBackupAccomplishments         = 5000
	maxBackupDays                    = 20000
	maxBackupDayEntries              = 1000
	maxBackupNameBytes               = 200
	maxBackupTypeBytes               = 50
	maxBackupKeyBytes                = 200
	maxBackupStringValueBytes        = 4096
	maxBackupQuotes                  = 20000
	maxBackupQuoteIDBytes            = 64
)

type backupSnapshot struct {
	Version         int                    `json:"version"`
	ExportedAt      string                 `json:"exportedAt"`
	NoteTemplate    string                 `json:"noteTemplate"`
	Accomplishments []backupAccomplishment `json:"accomplishments"`
	Days            []backupDay            `json:"days"`
	// Missing (nil) from clients older than quotes, which must not wipe quotes they cannot see.
	Quotes []backupQuote `json:"quotes"`
}

type backupAccomplishment struct {
	Name   string `json:"name"`
	Type   string `json:"type"`
	Active bool   `json:"active"`
}

type backupDay struct {
	Date string         `json:"date"`
	Note string         `json:"note"`
	Data map[string]any `json:"data"`
}

type backupQuote struct {
	ID           string `json:"id"`
	Text         string `json:"text"`
	Note         string `json:"note"`
	Date         string `json:"date"`
	AddedAt      string `json:"addedAt"`
	UpdatedAt    string `json:"updatedAt"`
	Status       string `json:"status"`
	DeniedReason string `json:"deniedReason"`
}

func handleGetBackupSnapshot(writer http.ResponseWriter, req *http.Request, userID int64) {
	setCorsHeaders(writer, req)
	writer.Header().Set("Cache-Control", "no-store")

	template, err := db.GetUserNoteTemplate(userID)
	if err != nil {
		http.Error(writer, "Failed to load note template", http.StatusInternalServerError)
		return
	}
	accomplishmentsRows, err := db.GetAllAccomplishments(userID)
	if err != nil {
		http.Error(writer, "Failed to load accomplishments", http.StatusInternalServerError)
		return
	}
	daysRows, err := db.GetDaysForUser(userID)
	if err != nil {
		http.Error(writer, "Failed to load days", http.StatusInternalServerError)
		return
	}
	quoteRows, err := db.GetAllQuotes()
	if err != nil {
		http.Error(writer, "Failed to load quotes", http.StatusInternalServerError)
		return
	}
	quotes := make([]backupQuote, 0, len(quoteRows))
	for _, row := range quoteRows {
		quotes = append(quotes, backupQuote(row))
	}

	accomplishments := make([]backupAccomplishment, 0, len(accomplishmentsRows))
	for _, row := range accomplishmentsRows {
		name := strings.TrimSpace(row.Name)
		if name == "" {
			continue
		}
		accType := ""
		if row.Type.Valid {
			accType = strings.TrimSpace(row.Type.String)
		}
		active := true
		if row.Active.Valid {
			active = row.Active.Bool
		}
		accomplishments = append(accomplishments, backupAccomplishment{
			Name:   name,
			Type:   accType,
			Active: active,
		})
	}

	days := make([]backupDay, 0, len(daysRows))
	for _, row := range daysRows {
		rawData, err := parseBackupDayData(row.DataJSON, row.NoteText)
		if err != nil {
			http.Error(writer, "Failed to parse day data", http.StatusInternalServerError)
			return
		}
		data, err := normalizeBackupDayData(rawData, false)
		if err != nil {
			http.Error(writer, "Failed to sanitize day data", http.StatusInternalServerError)
			return
		}
		note := ""
		if row.NoteText.Valid {
			note = row.NoteText.String
		}
		days = append(days, backupDay{
			Date: row.Date,
			Note: note,
			Data: data,
		})
	}
	sort.Slice(days, func(i, j int) bool {
		return days[i].Date < days[j].Date
	})

	payload := backupSnapshot{
		Version:         1,
		ExportedAt:      time.Now().UTC().Format(time.RFC3339),
		NoteTemplate:    template,
		Accomplishments: accomplishments,
		Days:            days,
		Quotes:          quotes,
	}
	res, err := json.Marshal(payload)
	if err != nil {
		http.Error(writer, "Error when converting json:", http.StatusInternalServerError)
		return
	}
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(http.StatusOK)
	writer.Write(res)
}

func handlePutBackupSnapshot(writer http.ResponseWriter, req *http.Request, _ int64) {
	setCorsHeaders(writer, req)

	var payload backupSnapshot
	if err := decodeStrictJSONBody(writer, req, maxBackupSnapshotBodyBytes, &payload); err != nil {
		if isRequestBodyTooLarge(err) {
			http.Error(writer, "Request payload too large", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(writer, "Invalid JSON payload", http.StatusBadRequest)
		return
	}
	if payload.Version == 0 {
		payload.Version = 1
	}
	if payload.Version != 1 {
		http.Error(writer, "Unsupported backup version", http.StatusBadRequest)
		return
	}
	if err := validateAndNormalizeBackupSnapshot(&payload); err != nil {
		http.Error(writer, fmt.Sprintf("Invalid backup snapshot: %v", err), http.StatusBadRequest)
		return
	}
	if err := importBackupSnapshot(payload); err != nil {
		http.Error(writer, "Failed to apply backup snapshot", http.StatusInternalServerError)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func importBackupSnapshot(payload backupSnapshot) error {
	tx, err := db.DB.Begin()
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if _, err := tx.Exec(`INSERT INTO app_state (id, jwt, note_template) VALUES (1, '', '') ON CONFLICT(id) DO NOTHING`); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE app_state SET note_template = ? WHERE id = 1`, payload.NoteTemplate); err != nil {
		return err
	}

	// Replace existing single-user data as a full snapshot restore.
	if _, err := tx.Exec(`DELETE FROM days`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM accomplishments`); err != nil {
		return err
	}

	accomplishmentNames := make(map[string]struct{})
	normalizedName := func(name string) string {
		return strings.ToLower(strings.TrimSpace(name))
	}

	for _, item := range payload.Accomplishments {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			continue
		}
		key := normalizedName(name)
		if _, exists := accomplishmentNames[key]; exists {
			continue
		}
		if _, err := tx.Exec(
			`INSERT INTO accomplishments (name, type, active) VALUES (?, ?, ?)`,
			name,
			strings.TrimSpace(item.Type),
			item.Active,
		); err != nil {
			return err
		}
		accomplishmentNames[key] = struct{}{}
	}

	// Ensure accomplishments also include any keys that appear in day data.
	for _, day := range payload.Days {
		for name := range day.Data {
			trimmedName := strings.TrimSpace(name)
			if trimmedName == "" {
				continue
			}
			key := normalizedName(trimmedName)
			if _, exists := accomplishmentNames[key]; exists {
				continue
			}
			if _, err := tx.Exec(
				`INSERT INTO accomplishments (name, type, active) VALUES (?, '', TRUE)`,
				trimmedName,
			); err != nil {
				return err
			}
			accomplishmentNames[key] = struct{}{}
		}
	}

	for _, day := range payload.Days {
		dayJSON, err := json.Marshal(day.Data)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(
			`INSERT INTO days (date, note_text, data_json) VALUES (?, ?, ?)`,
			day.Date,
			day.Note,
			string(dayJSON),
		); err != nil {
			return err
		}
	}

	if payload.Quotes != nil {
		if _, err := tx.Exec(`DELETE FROM quotes`); err != nil {
			return err
		}
		for _, quote := range payload.Quotes {
			if _, err := tx.Exec(
				`INSERT INTO quotes (quote_id, quote_text, quote_note, date, added_at, updated_at, status, denied_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				quote.ID,
				quote.Text,
				quote.Note,
				quote.Date,
				quote.AddedAt,
				quote.UpdatedAt,
				quote.Status,
				quote.DeniedReason,
			); err != nil {
				return err
			}
		}
	}

	return tx.Commit()
}

func parseBackupDayData(dataJSON sql.NullString, noteText sql.NullString) (map[string]any, error) {
	if dataJSON.Valid && strings.TrimSpace(dataJSON.String) != "" {
		var dayData map[string]any
		if err := json.Unmarshal([]byte(dataJSON.String), &dayData); err == nil {
			if dayData == nil {
				dayData = map[string]any{}
			}
			return dayData, nil
		}
	}
	if noteText.Valid {
		trimmed := strings.TrimSpace(noteText.String)
		if strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[") {
			var dayData map[string]any
			if err := json.Unmarshal([]byte(trimmed), &dayData); err == nil {
				if dayData == nil {
					dayData = map[string]any{}
				}
				return dayData, nil
			}
		}
	}
	return map[string]any{}, nil
}

func validateAndNormalizeBackupSnapshot(payload *backupSnapshot) error {
	if payload == nil {
		return fmt.Errorf("empty payload")
	}
	if len(payload.NoteTemplate) > maxBackupTemplateBytes {
		return fmt.Errorf("noteTemplate exceeds %d bytes", maxBackupTemplateBytes)
	}

	accomplishments := make([]backupAccomplishment, 0, len(payload.Accomplishments))
	accomplishmentNames := make(map[string]struct{})
	for _, item := range payload.Accomplishments {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			continue
		}
		if len(name) > maxBackupNameBytes {
			return fmt.Errorf("accomplishment name too long: %q", name)
		}
		accType := strings.TrimSpace(item.Type)
		if len(accType) > maxBackupTypeBytes {
			return fmt.Errorf("accomplishment type too long for %q", name)
		}
		key := strings.ToLower(name)
		if _, exists := accomplishmentNames[key]; exists {
			continue
		}
		accomplishmentNames[key] = struct{}{}
		accomplishments = append(accomplishments, backupAccomplishment{
			Name:   name,
			Type:   accType,
			Active: item.Active,
		})
		if len(accomplishments) > maxBackupAccomplishments {
			return fmt.Errorf("too many accomplishments (max %d)", maxBackupAccomplishments)
		}
	}
	payload.Accomplishments = accomplishments

	dayByDate := make(map[string]backupDay, len(payload.Days))
	for _, day := range payload.Days {
		dateKey := strings.TrimSpace(day.Date)
		if _, err := time.Parse("06-01-02", dateKey); err != nil {
			return fmt.Errorf("invalid day date: %q", day.Date)
		}
		if len(day.Note) > maxBackupNoteBytes {
			return fmt.Errorf("note too large for date %s", dateKey)
		}
		normalizedData, err := normalizeBackupDayData(day.Data, true)
		if err != nil {
			return fmt.Errorf("invalid day data for %s: %w", dateKey, err)
		}
		dayByDate[dateKey] = backupDay{
			Date: dateKey,
			Note: day.Note,
			Data: normalizedData,
		}
		if len(dayByDate) > maxBackupDays {
			return fmt.Errorf("too many days (max %d)", maxBackupDays)
		}
	}

	dates := make([]string, 0, len(dayByDate))
	for dateKey := range dayByDate {
		dates = append(dates, dateKey)
	}
	sort.Strings(dates)

	days := make([]backupDay, 0, len(dates))
	for _, dateKey := range dates {
		days = append(days, dayByDate[dateKey])
	}
	payload.Days = days

	quotes, err := normalizeBackupQuotes(payload.Quotes)
	if err != nil {
		return err
	}
	payload.Quotes = quotes

	return nil
}

func normalizeBackupQuotes(input []backupQuote) ([]backupQuote, error) {
	if input == nil {
		return nil, nil
	}
	if len(input) > maxBackupQuotes {
		return nil, fmt.Errorf("too many quotes (max %d)", maxBackupQuotes)
	}
	quotes := make([]backupQuote, 0, len(input))
	seenIDs := make(map[string]struct{}, len(input))
	for _, quote := range input {
		quote.ID = strings.TrimSpace(quote.ID)
		quote.Text = strings.TrimSpace(quote.Text)
		quote.Note = strings.TrimSpace(quote.Note)
		quote.Date = strings.TrimSpace(quote.Date)
		quote.DeniedReason = strings.TrimSpace(quote.DeniedReason)
		if quote.ID == "" || len(quote.ID) > maxBackupQuoteIDBytes {
			return nil, fmt.Errorf("invalid quote id: %q", quote.ID)
		}
		if _, exists := seenIDs[quote.ID]; exists {
			continue
		}
		seenIDs[quote.ID] = struct{}{}
		if quote.Text == "" {
			return nil, fmt.Errorf("empty quote text for %s", quote.ID)
		}
		if len(quote.Text) > maxBackupNoteBytes || len(quote.Note) > maxBackupNoteBytes || len(quote.DeniedReason) > maxBackupNoteBytes {
			return nil, fmt.Errorf("quote too large: %s", quote.ID)
		}
		if _, err := time.Parse("06-01-02", quote.Date); err != nil {
			return nil, fmt.Errorf("invalid quote date: %q", quote.Date)
		}
		for _, timestamp := range []string{quote.AddedAt, quote.UpdatedAt} {
			if _, err := time.Parse(time.RFC3339, timestamp); err != nil {
				return nil, fmt.Errorf("invalid quote time: %q", timestamp)
			}
		}
		switch quote.Status {
		case "active", "hidden":
			quote.DeniedReason = ""
		case "denied":
		default:
			return nil, fmt.Errorf("invalid quote status: %q", quote.Status)
		}
		quotes = append(quotes, quote)
	}
	return quotes, nil
}

func normalizeBackupDayData(input map[string]any, strict bool) (map[string]any, error) {
	if input == nil {
		return map[string]any{}, nil
	}
	result := make(map[string]any)
	for rawKey, rawValue := range input {
		key := strings.TrimSpace(rawKey)
		if key == "" {
			if strict {
				return nil, fmt.Errorf("empty task key")
			}
			continue
		}
		if len(key) > maxBackupKeyBytes {
			if strict {
				return nil, fmt.Errorf("task key too long: %q", key)
			}
			continue
		}
		value, ok, err := normalizeBackupValue(rawValue)
		if err != nil {
			if strict {
				return nil, fmt.Errorf("key %q: %w", key, err)
			}
			continue
		}
		if !ok {
			if strict {
				return nil, fmt.Errorf("key %q: unsupported value type", key)
			}
			continue
		}
		result[key] = value
		if len(result) > maxBackupDayEntries {
			if strict {
				return nil, fmt.Errorf("too many entries in day (max %d)", maxBackupDayEntries)
			}
			break
		}
	}
	return result, nil
}

func normalizeBackupValue(raw any) (any, bool, error) {
	switch value := raw.(type) {
	case nil:
		return nil, true, nil
	case bool:
		return value, true, nil
	case string:
		if len(value) > maxBackupStringValueBytes {
			return nil, false, fmt.Errorf("string value exceeds %d bytes", maxBackupStringValueBytes)
		}
		return value, true, nil
	case float64:
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return nil, false, fmt.Errorf("non-finite number")
		}
		return value, true, nil
	default:
		return nil, false, nil
	}
}
