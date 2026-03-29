package main

import "dailyNotes/internal/db"

const bootstrapSingleUserID int64 = 1

func ensureDefaultUserID() (int64, error) {
	if err := db.EnsureAppState(); err != nil {
		return 0, err
	}
	return bootstrapSingleUserID, nil
}
