package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: dailyNotes <daily notes vault>")
		os.Exit(1)
	}

	dailyNotesVaultPath := os.Args[1]
	tasksFilePath := filepath.Join(dailyNotesVaultPath, "overallTasks.json")

	mux := http.NewServeMux()
	// authMiddleware(func(w http.ResponseWriter, r *http.Request)
	mux.HandleFunc("/data", func(writer http.ResponseWriter, req *http.Request) {
		switch req.Method {
		case http.MethodGet:
			handleGetTasks(writer, req, tasksFilePath)
		default:
			http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	log.Println("Server running on http://localhost:5789")
	log.Fatal(http.ListenAndServe(":5789", mux))
}

// GET /tasks  -> returns overallTasks.json
func handleGetTasks(writer http.ResponseWriter, req *http.Request, tasksFilePath string) {
	data, err := os.ReadFile(tasksFilePath)
	if err != nil {
		http.Error(writer, "Task file not found", http.StatusInternalServerError)
		return
	}

	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(http.StatusOK)
	writer.Write(data)
}

// Checks X-API-Key before allowing access
func authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		next(w, r)
		key := r.Header.Get("X-API-Key")
		if key != "secret" { // change this in real usage
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		next(w, r)
	}
}
