package src

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

func RunYesterdayProcess(yesterdayNotePath, dailyNotesVaultPath string, yesterday time.Time, accomplishments []AccomplishmentDef) error {
	if !fileExists(yesterdayNotePath) {
		return nil
	}

	if err := archiveYesterday(yesterdayNotePath, dailyNotesVaultPath, yesterday, accomplishments); err != nil {
		return err
	}

	if err := os.Remove(yesterdayNotePath); err != nil {
		return fmt.Errorf("delete yesterday note: %w", err)
	}

	return nil
}

func archiveYesterday(yesterdayNotePath, dailyNotesVaultPath string, yesterday time.Time, accomplishments []AccomplishmentDef) error {
	contentBytes, err := os.ReadFile(yesterdayNotePath)
	if err != nil {
		return fmt.Errorf("read yesterday note: %w", err)
	}

	content := string(contentBytes)
	tasks := extractAccomplishments(content, accomplishments)

	archiveDir := filepath.Join(dailyNotesVaultPath, formatDate(yesterday))
	if err := os.MkdirAll(archiveDir, 0o755); err != nil {
		return fmt.Errorf("create archive dir: %w", err)
	}

	tasksPath := filepath.Join(archiveDir, "dailyAccomplishment.json")
	if err := writeJSON(tasksPath, tasks); err != nil {
		return fmt.Errorf("write dailyAccomplishment.json: %w", err)
	}

	if err := updateOverallTasks(dailyNotesVaultPath, formatDate(yesterday), tasks); err != nil {
		return err
	}

	archivedContent, _ := removeAccomplishmentsSection(content)
	archivedNotePath := filepath.Join(archiveDir, formatDate(yesterday)+".md")
	if err := os.WriteFile(archivedNotePath, []byte(archivedContent), 0o644); err != nil {
		return fmt.Errorf("write archived note: %w", err)
	}
	return nil
}

func extractAccomplishments(content string, accomplishments []AccomplishmentDef) map[string]any {
	lines := accomplishmentLines(content)
	if lines == nil {
		lines = strings.Split(content, "\n")
	}

	results := make(map[string]any, len(accomplishments))
	for _, item := range accomplishments {
		key := fmt.Sprintf(item.Text)
		switch strings.ToLower(strings.TrimSpace(item.Type)) {
		case "checkbox":
			results[key] = findCheckboxValue(lines, item.Text)
		case "text":
			results[key] = findTextValue(lines, item.Text)
		default:
			results[key] = ""
		}
	}

	return results
}

func accomplishmentLines(content string) []string {
	scanner := bufio.NewScanner(strings.NewReader(content))
	var lines []string
	inSection := false

	for scanner.Scan() {
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "## ") {
			header := strings.TrimSpace(strings.TrimPrefix(trimmed, "## "))
			if strings.EqualFold(header, accomplishmentsHeader) {
				inSection = true
				continue
			}
			if inSection {
				break
			}
		}
		if inSection {
			lines = append(lines, line)
		}
	}

	if len(lines) == 0 {
		return nil
	}
	return lines
}

func removeAccomplishmentsSection(content string) (string, bool) {
	scanner := bufio.NewScanner(strings.NewReader(content))
	var lines []string
	inSection := false
	removed := false

	for scanner.Scan() {
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "## ") {
			header := strings.TrimSpace(strings.TrimPrefix(trimmed, "## "))
			if strings.EqualFold(header, accomplishmentsHeader) {
				inSection = true
				removed = true
				continue
			}
			if inSection {
				inSection = false
			}
		}
		if inSection {
			continue
		}
		lines = append(lines, line)
	}

	if !removed {
		return content, false
	}

	result := strings.Join(lines, "\n")
	if !strings.HasSuffix(result, "\n") {
		result += "\n"
	}
	return result, true
}

func findCheckboxValue(lines []string, text string) bool {
	re := regexp.MustCompile(`^- \[([ xX])\]\s+(.*)$`)
	for _, line := range lines {
		line = strings.TrimSpace(line)
		matches := re.FindStringSubmatch(line)
		if len(matches) != 3 {
			continue
		}
		label := strings.TrimSpace(matches[2])
		if label == text {
			return matches[1] == "x" || matches[1] == "X"
		}
	}
	return false
}

func findTextValue(lines []string, text string) string {
	prefix := strings.ToLower(text) + ":"
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		trimmed = strings.TrimPrefix(trimmed, "- ")
		if strings.HasPrefix(strings.ToLower(trimmed), prefix) {
			return strings.TrimSpace(trimmed[len(prefix):])
		}
	}
	return ""
}
