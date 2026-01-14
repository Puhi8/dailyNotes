package dailyNotesProcess

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type overallTasksFile struct {
	Overall         overallSummary            `json:"overall"`
	Days            map[string]map[string]any `json:"days"`
	Accomplishments []AccomplishmentDef       `json:"accomplishments"`
}

type overallSummary struct {
	IndividualAccomplishment map[string]individualStats `json:"individualAccomplishment"`
	DailyAverage             float64                    `json:"dailyAverage"`
}

type individualStats struct {
	Percent float64 `json:"percent"`
	Chances int     `json:"chances"`
	Done    int     `json:"done"`
	Failed  int     `json:"failed"`
}

func updateOverallTasks(dailyNotesVaultPath, date string, dailyResults map[string]any) error {
	file, path, err := getOverallJson(dailyNotesVaultPath)
	if err != nil {
		return err
	}
	if file.Days == nil {
		file.Days = make(map[string]map[string]any)
	}
	file.Days[date] = dailyResults

	file.Overall.IndividualAccomplishment = computeIndividualStats(*file)
	file.Overall.DailyAverage = computeDailyAverage(file.Overall.IndividualAccomplishment)

	if err := os.MkdirAll(dailyNotesVaultPath, 0o755); err != nil {
		return fmt.Errorf("create daily notes vault dir: %w", err)
	}

	if err := writeJSON(path, file); err != nil {
		return fmt.Errorf("write overallTasks.json: %w", err)
	}
	return nil
}

func getOverallJson(dailyNotesVaultPath string) (*overallTasksFile, string, error) {
	if strings.TrimSpace(dailyNotesVaultPath) == "" {
		return nil, "", fmt.Errorf("daily notes vault path is required")
	}

	path := filepath.Join(dailyNotesVaultPath, "overallTasks.json")
	var file overallTasksFile

	data, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			return nil, "", fmt.Errorf("read overallTasks.json: %w", err)
		}
	} else if err := json.Unmarshal(data, &file); err != nil {
		return nil, "", fmt.Errorf("parse overallTasks.json: %w", err)
	}
	return &file, path, nil
}

func computeIndividualStats(fileData overallTasksFile) map[string]individualStats {
	stats := make(map[string]individualStats)
	for _, accomplishment := range fileData.Accomplishments {
		chances := 0
		done := 0
		for _, day := range fileData.Days {
			value, ok := day[accomplishment.Text]
			if !ok {
				continue
			}
			chances++
			if accomplishmentDone(accomplishment, value) {
				done++
			}
		}
		failed := chances - done
		percent := 0.0
		if chances > 0 {
			percent = round(float64(done) / float64(chances))
		}
		stats[accomplishment.Text] = individualStats{
			Percent: percent,
			Chances: chances,
			Done:    done,
			Failed:  failed,
		}
	}
	return stats
}

func accomplishmentDone(def AccomplishmentDef, value any) bool {
	switch strings.ToLower(strings.TrimSpace(def.Type)) {
	case "checkbox":
		checked, ok := value.(bool)
		if ok {
			return checked
		}
		return false
	case "text":
		textValue, ok := value.(string)
		if !ok {
			return false
		}
		return strings.TrimSpace(textValue) != ""
	default:
		return false
	}
}

func computeDailyAverage(accomplishmentStats map[string]individualStats) float64 {
	totalChances := 0
	totalDone := 0
	for _, stats := range accomplishmentStats {
		totalDone += stats.Done
		totalChances += stats.Chances
	}
	if totalChances == 0 {
		return 0
	}
	return round(float64(totalDone) / float64(totalChances))
}
