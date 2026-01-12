package src

import (
	"fmt"
	"strings"
	"time"
)

func BuildNoteContent(accomplishments []AccomplishmentDef) string {
	var builder strings.Builder

	builder.WriteString("## ")
	builder.WriteString(accomplishmentsHeader)
	builder.WriteString("\n")
	for _, item := range accomplishments {
		switch strings.ToLower(strings.TrimSpace(item.Type)) {
		case "checkbox":
			builder.WriteString("- [ ] ")
			builder.WriteString(item.Text)
			builder.WriteString("\n")
		case "text":
			builder.WriteString("- ")
			builder.WriteString(item.Text)
			builder.WriteString(": \n")
		}
	}
	builder.WriteString("\n")

	builder.WriteString("## How am I")
	builder.WriteString("\n\n")

	builder.WriteString("## About day\n")
	builder.WriteString("### Best thing\n")
	builder.WriteString("\n")
	builder.WriteString("### Worst thing\n")
	builder.WriteString("\n")

	return builder.String()
}

func RunTodayTodoProcess(todayNotePath, todoPath, todoProcess, processesPath string, today time.Time, accomplishments []AccomplishmentDef) error {
	var errorsList []string
	noteReady := fileExists(todayNotePath)
	if !noteReady {
		if err := WriteNewNote(todayNotePath, BuildNoteContent(accomplishments)); err != nil {
			errorsList = append(errorsList, fmt.Sprintf("create today note: %v", err))
		}
		noteReady = fileExists(todayNotePath)
	}

	if err := WaitForProcessToExit(todoProcess, processesPath); err != nil {
		errorsList = append(errorsList, fmt.Sprintf("wait for todo process: %v", err))
	}

	if noteReady {
		if err := AppendTodoEntry(todoPath, todayNotePath, formatDate(today)); err != nil {
			errorsList = append(errorsList, fmt.Sprintf("append todo entry: %v", err))
		}
	} else {
		errorsList = append(errorsList, fmt.Sprintf("skip todo entry: note missing at %s", todayNotePath))
	}

	if len(errorsList) == 0 {
		return nil
	}
	return fmt.Errorf(strings.Join(errorsList, "; "))
}
