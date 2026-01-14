package main

import (
	"fmt"
	"os"
	"time"
	"dailyNotes/src/dailyNotesProcess"
)

func main() {
	if len(os.Args) < 6 {
		fmt.Fprintln(os.Stderr, "usage: dailyNotes <vault folder path> <todo.md path> <todo process> <processes.txt path> <daily notes vault>")
		os.Exit(1)
	}
	vaultFolderPath := os.Args[1]
	todoPath := os.Args[2]
	todoProcess := os.Args[3]
	dailyNotesVaultPath := os.Args[4]
	processesPath := os.Args[5]
	defer dailyNotesProcess.CleanProcessesTxt(processesPath, os.Args[0])

	if vaultFolderPath == "" || todoPath == "" || dailyNotesVaultPath == "" {
		dailyNotesProcess.ExitWithError(fmt.Errorf("vault folder path, todo.md path, and daily notes vault are required"))
	}

	accomplishments, err := dailyNotesProcess.GetAccomplishmentsConfig(dailyNotesVaultPath)
	if err != nil {
		dailyNotesProcess.ExitWithError(err)
	}
	today := time.Now()
	yesterday := today.AddDate(0, 0, -1)

	yesterdayNotePath := dailyNotesProcess.NotePathForDate(vaultFolderPath, yesterday)
	todayNotePath := dailyNotesProcess.NotePathForDate(vaultFolderPath, today)

	hadError := false
	if err := dailyNotesProcess.RunYesterdayProcess(yesterdayNotePath, dailyNotesVaultPath, yesterday, accomplishments); err != nil {
		fmt.Fprintln(os.Stderr, "yesterday:", err)
		hadError = true
	}

	if err := dailyNotesProcess.RunTodayTodoProcess(todayNotePath, todoPath, todoProcess, processesPath, today, accomplishments); err != nil {
		fmt.Fprintln(os.Stderr, "today+todo:", err)
		hadError = true
	}

	if hadError {
		os.Exit(1)
	}
}
