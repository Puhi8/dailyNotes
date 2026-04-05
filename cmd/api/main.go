package main

import (
	"context"
	"dailyNotes/internal/db"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

var (
	authCacheMu  sync.RWMutex
	userJWTCache map[int64]string
	jwtUserCache map[string]int64
	corsRules    []corsRule
	corsAllowAll bool
)

func main() {
	if len(os.Args) != 2 {
		printUsageAndExit(1)
	}

	dataDir := strings.TrimSpace(os.Args[1])
	if dataDir == "" {
		printUsageAndExit(1)
	}
	if err := initializeAccessFiles(dataDir); err != nil {
		fmt.Println("Error:", err)
		return
	}
	log.Printf("Data directory: %s", dataDir)
	log.Printf("Password file: %s", getServerPasswordFilePath())

	dbPath := filepath.Join(dataDir, "daily_notes.db")
	if err := db.InitDatabase(dbPath); err != nil {
		fmt.Println("Error:", err)
		return
	}
	log.Printf("Database file: %s", dbPath)
	_, err := ensureDefaultUserID()
	if err != nil {
		fmt.Println("Error:", err)
		return
	}

	corsRules, corsAllowAll = resolveCORSAllowedOrigins()
	if err := loadAuthCache(); err != nil {
		fmt.Println("Error:", err)
		return
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/login", func(writer http.ResponseWriter, req *http.Request) {
		switch req.Method {
		case http.MethodPost:
			handleLogin(writer, req)
		case http.MethodOptions:
			handleOptions(writer, req)
		default:
			http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		}
	})
	mux.HandleFunc("/logout", authMiddleware(func(writer http.ResponseWriter, req *http.Request, userID int64) {
		switch req.Method {
		case http.MethodPost:
			handleLogout(writer, req, userID)
		case http.MethodOptions:
			handleOptions(writer, req)
		default:
			http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		}
	}))
	mux.HandleFunc("/account/credentials", authMiddleware(func(writer http.ResponseWriter, req *http.Request, userID int64) {
		switch req.Method {
		case http.MethodPut:
			handleUpdateCredentials(writer, req, userID)
		case http.MethodOptions:
			handleOptions(writer, req)
		default:
			http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		}
	}))
	mux.HandleFunc("/backup/snapshot", authMiddleware(func(writer http.ResponseWriter, req *http.Request, userID int64) {
		switch req.Method {
		case http.MethodGet:
			handleGetBackupSnapshot(writer, req, userID)
		case http.MethodPut:
			handlePutBackupSnapshot(writer, req, userID)
		case http.MethodOptions:
			handleOptions(writer, req)
		default:
			http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		}
	}))

	tlsCertPath := strings.TrimSpace(os.Getenv("DAILYNOTES_TLS_CERT_FILE"))
	tlsKeyPath := strings.TrimSpace(os.Getenv("DAILYNOTES_TLS_KEY_FILE"))
	server := &http.Server{
		Addr:              ":5789",
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
	if (tlsCertPath == "") != (tlsKeyPath == "") {
		log.Fatal("both DAILYNOTES_TLS_CERT_FILE and DAILYNOTES_TLS_KEY_FILE must be set to enable TLS")
	}

	serverErrCh := make(chan error, 1)
	go func() {
		if tlsCertPath != "" {
			log.Println("Server running on https://0.0.0.0:5789")
			serverErrCh <- server.ListenAndServeTLS(tlsCertPath, tlsKeyPath)
			return
		}
		log.Println("Server running on http://0.0.0.0:5789")
		serverErrCh <- server.ListenAndServe()
	}()

	shutdownSignalCtx, stopSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopSignals()

	select {
	case err := <-serverErrCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	case <-shutdownSignalCtx.Done():
		log.Println("Shutdown signal received. Stopping server...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("Graceful shutdown failed, forcing close: %v", err)
			_ = server.Close()
		}
		if err := <-serverErrCh; err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}
}

func printUsageAndExit(code int) {
	fmt.Fprintln(os.Stderr, "usage:")
	fmt.Fprintln(os.Stderr, "  go run ./cmd/api <data-dir>")
	os.Exit(code)
}
