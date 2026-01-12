package main

import (
	"fmt"
	"os"
	"time"
	"dailyNotes/src"
)

func main() {
	if len(os.Args) < 6 {
		fmt.Fprintln(os.Stderr, "usage: dailyNotes <vault folder path> <todo.md path> <todo process> <processes.txt path> <daily notes vault>")
		os.Exit(1)
	}
	vaultFolderPath := os.Args[1]
	todoPath := os.Args[2]
	todoProcess := os.Args[3]
	processesPath := os.Args[4]
	dailyNotesVaultPath := os.Args[5]
	defer src.CleanProcessesTxt(processesPath, os.Args[0])

	if vaultFolderPath == "" || todoPath == "" || dailyNotesVaultPath == "" {
		src.ExitWithError(fmt.Errorf("vault folder path, todo.md path, and daily notes vault are required"))
	}

	accomplishments, err := src.GetAccomplishmentsConfig(dailyNotesVaultPath)
	if err != nil {
		src.ExitWithError(err)
	}
	today := time.Now()
	yesterday := today.AddDate(0, 0, -1)

	yesterdayNotePath := src.NotePathForDate(vaultFolderPath, yesterday)
	todayNotePath := src.NotePathForDate(vaultFolderPath, today)

	hadError := false
	if err := src.RunYesterdayProcess(yesterdayNotePath, dailyNotesVaultPath, yesterday, accomplishments); err != nil {
		fmt.Fprintln(os.Stderr, "yesterday:", err)
		hadError = true
	}

	if err := src.RunTodayTodoProcess(todayNotePath, todoPath, todoProcess, processesPath, today, accomplishments); err != nil {
		fmt.Fprintln(os.Stderr, "today+todo:", err)
		hadError = true
	}

	if hadError {
		os.Exit(1)
	}
}
