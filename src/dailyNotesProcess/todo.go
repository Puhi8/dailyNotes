package dailyNotesProcess

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	accomplishmentsHeader   = "Accomplishments"
	processPollInterval     = 2 * time.Second
)

func WaitForProcessToExit(todoProcess, processesPath string) error {
	if strings.TrimSpace(todoProcess) == "" {
		return nil
	}
	processName := filepath.Base(todoProcess)
	for {
		running, err := processListed(processesPath, processName)
		if err != nil {
			if os.IsNotExist(err) {
				return nil
			}
			return fmt.Errorf("read processes file: %w", err)
		}
		if !running {
			return nil
		}
		fmt.Println("Waiting for todo!")
		time.Sleep(processPollInterval)
	}
}

func processListed(processesPath, processName string) (bool, error) {
	data, err := os.ReadFile(processesPath)
	if err != nil {
		return false, err
	}
	target := strings.ToLower(processName)
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	for scanner.Scan() {
		line := strings.ToLower(strings.TrimSpace(scanner.Text()))
		if line == target {
			return true, nil
		}
	}
	return false, nil
}

func AppendTodoEntry(todoPath, notePath, date string) error {
	existing, err := os.ReadFile(todoPath)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("read todo file: %w", err)
	}
	entry := todoEntry(todoPath, notePath, date)
	remaining := filterDailyNoteLinks(string(existing))
	content := entry + remaining

	if err := os.WriteFile(todoPath, []byte(content), 0o644); err != nil {
		return fmt.Errorf("write todo file: %w", err)
	}
	return nil
}

func todoEntry(todoPath, notePath, date string) string {
	relativePath, err := filepath.Rel(filepath.Dir(todoPath), notePath)
	if err != nil {
		relativePath = notePath
	}
	relativePath = filepath.ToSlash(relativePath)
	return fmt.Sprintf("[Daily note %s](%s)\n", date, relativePath)
}

func filterDailyNoteLinks(content string) string {
	if content == "" {
		return ""
	}
	lines := strings.Split(content, "\n")
	kept := make([]string, 0, len(lines))
	for _, line := range lines {
		if strings.HasPrefix(line, "[Daily note ") {
			continue
		}
		kept = append(kept, line)
	}
	result := strings.Join(kept, "\n")
	if result != "" && !strings.HasSuffix(result, "\n") {
		result += "\n"
	}
	return result
}
