package dailyNotesProcess

import (
	"bufio"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type accomplishmentConfig struct {
	Accomplishments []AccomplishmentDef `json:"accomplishments"`
}

type AccomplishmentDef struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func formatDate(day time.Time) string {
	return day.Format("06-01-02")
}

func ExitWithError(err error) {
	fmt.Fprintln(os.Stderr, err.Error())
	os.Exit(1)

}

func NotePathForDate(root string, day time.Time) string {
	fileName := formatDate(day) + ".md"
	return filepath.Join(root, fileName)
}

func WriteNewNote(path, content string) error {
	if fileExists(path) {
		return fmt.Errorf("note already exists: %s", path)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create note directory: %w", err)
	}
	return os.WriteFile(path, []byte(content), 0o644)
}

func writeJSON(path string, payload any) error {
	data, err := json.MarshalIndent(payload, "", "   ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o644)
}

func GetAccomplishmentsConfig(dailyNotesVaultPath string) ([]AccomplishmentDef, error) {
	var candidate string
	workingDir, err := os.Getwd()
	if err != nil {
		return nil, fmt.Errorf("find accomplishments.json: %w", err)
	}

	candidate = filepath.Join(workingDir, "accomplishments.json")
	if !fileExists(candidate) {
		return nil, fmt.Errorf("accomplishments.json not found near executable or in %s", workingDir)
	}

	data, err := os.ReadFile(candidate)
	if err != nil {
		return nil, fmt.Errorf("read accomplishments.json: %w", err)
	}

	var config accomplishmentConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("parse accomplishments.json: %w", err)
	}
	if len(config.Accomplishments) == 0 {
		return nil, fmt.Errorf("accomplishments.json has no accomplishments")
	}

	overallData, overallPath, err := getOverallJson(dailyNotesVaultPath)
	if err != nil {
		return nil, err
	}
	overallIndex := make(map[string]struct{})
	rewriteOverall := false
	accomplishmentKey := func(def AccomplishmentDef) string {
		return strings.ToLower(strings.TrimSpace(def.Type)) + "\x00" + strings.TrimSpace(def.Text)
	}

	for _, item := range overallData.Accomplishments {
		overallIndex[accomplishmentKey(item)] = struct{}{}
	}

	for i, item := range config.Accomplishments {
		switch strings.ToLower(strings.TrimSpace(item.Type)) {
		case "checkbox", "text":
			key := accomplishmentKey(item)
			if _, ok := overallIndex[key]; !ok {
				overallData.Accomplishments = append(overallData.Accomplishments, item)
				overallIndex[key] = struct{}{}
				rewriteOverall = true
			}
		default:
			return nil, fmt.Errorf("accomplishment %d has unsupported type %q", i+1, item.Type)
		}
	}
	if rewriteOverall {
		if err := writeJSON(overallPath, overallData); err != nil {
			return nil, fmt.Errorf("write overallTasks.json: %w", err)
		}
	}
	return config.Accomplishments, nil
}

func round(value float64) float64 {
	return math.Round(value*100) / 100
}

func CleanProcessesTxt(processesPath, args0 string) error {
	exeName := strings.ToLower(filepath.Base(args0))
	inFile, err := os.Open(processesPath)
	if err != nil {
		return err
	}
	defer inFile.Close()

	scanner := bufio.NewScanner(inFile)
	var cleaned []string
	for scanner.Scan() {
		line := scanner.Text()
		if strings.Contains(strings.ToLower(line), exeName) {
			continue
		}
		cleaned = append(cleaned, line)
	}
	if err := scanner.Err(); err != nil {
		return err
	}

	outFile, err := os.Create(processesPath)
	if err != nil {
		return err
	}
	defer outFile.Close()

	writer := bufio.NewWriter(outFile)
	for _, line := range cleaned {
		if _, err := fmt.Fprintln(writer, line); err != nil {
			return err
		}
	}
	return writer.Flush()
}
