package main

import (
	"crypto/rand"
	"crypto/subtle"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const (
	serverPasswordFileName   = "password"
	minBootstrapPasswordSize = 2
	maxBootstrapPasswordSize = 10
	maxServerPasswordSize    = 1024
)

var (
	accessFilesMu      sync.RWMutex
	serverPasswordPath string
)

func getServerPasswordFilePath() string {
	accessFilesMu.RLock()
	defer accessFilesMu.RUnlock()
	return serverPasswordPath
}

func initializeAccessFiles(dataDir string) error {
	trimmedDataDir := strings.TrimSpace(dataDir)
	if trimmedDataDir == "" {
		return fmt.Errorf("data directory is required")
	}
	if err := os.MkdirAll(trimmedDataDir, 0755); err != nil {
		return fmt.Errorf("create data directory %s: %w", trimmedDataDir, err)
	}

	accessFilesMu.Lock()
	defer accessFilesMu.Unlock()
	serverPasswordPath = filepath.Join(trimmedDataDir, serverPasswordFileName)
	if err := ensureServerPasswordFileLocked(); err != nil {
		return err
	}
	return nil
}

func ensureServerPasswordFileLocked() error {
	info, err := os.Stat(serverPasswordPath)
	if err == nil {
		if info.IsDir() {
			return fmt.Errorf("%s is a directory, expected a file", serverPasswordPath)
		}
		return nil
	}
	if !os.IsNotExist(err) {
		return fmt.Errorf("stat password file %s: %w", serverPasswordPath, err)
	}

	password, err := generateBootstrapPassword()
	if err != nil {
		return fmt.Errorf("generate initial password: %w", err)
	}
	if err := writePasswordFile(serverPasswordPath, password); err != nil {
		return fmt.Errorf("write password file %s: %w", serverPasswordPath, err)
	}
	return nil
}

func verifyServerPassword(provided string) (bool, error) {
	stored, err := readServerPassword()
	if err != nil {
		return false, err
	}
	return subtle.ConstantTimeCompare([]byte(stored), []byte(provided)) == 1, nil
}

func readServerPassword() (string, error) {
	accessFilesMu.RLock()
	path := serverPasswordPath
	accessFilesMu.RUnlock()
	if strings.TrimSpace(path) == "" {
		return "", fmt.Errorf("server password file is not initialized")
	}
	password, err := readPasswordFile(path)
	if os.IsNotExist(err) {
		accessFilesMu.Lock()
		if strings.TrimSpace(serverPasswordPath) == "" {
			accessFilesMu.Unlock()
			return "", fmt.Errorf("server password file is not initialized")
		}
		if recoverErr := ensureServerPasswordFileLocked(); recoverErr != nil {
			accessFilesMu.Unlock()
			return "", recoverErr
		}
		recoveredPassword, recoverReadErr := readPasswordFile(serverPasswordPath)
		accessFilesMu.Unlock()
		if recoverReadErr != nil {
			return "", recoverReadErr
		}
		password = recoveredPassword
		err = nil
	}
	if err != nil {
		return "", err
	}
	if !isValidServerPassword(password) {
		return "", fmt.Errorf("password in %s must be 1-%d characters", path, maxServerPasswordSize)
	}
	return password, nil
}

func updateServerPassword(newPassword string) error {
	if !isValidServerPassword(newPassword) {
		return fmt.Errorf("password must be 1-%d characters", maxServerPasswordSize)
	}

	accessFilesMu.Lock()
	defer accessFilesMu.Unlock()
	path := serverPasswordPath
	if strings.TrimSpace(path) == "" {
		return fmt.Errorf("server password file is not initialized")
	}
	if err := writePasswordFile(path, newPassword); err != nil {
		return err
	}
	return nil
}

func readPasswordFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	password := strings.TrimRight(string(data), "\r\n")
	return password, nil
}

func writePasswordFile(path string, password string) error {
	dir := filepath.Dir(path)
	tempFile, err := os.CreateTemp(dir, ".password-*")
	if err != nil {
		return err
	}
	tempPath := tempFile.Name()
	cleanup := func() {
		_ = os.Remove(tempPath)
	}

	if err := tempFile.Chmod(0600); err != nil {
		_ = tempFile.Close()
		cleanup()
		return err
	}
	if _, err := tempFile.WriteString(password); err != nil {
		_ = tempFile.Close()
		cleanup()
		return err
	}
	if err := tempFile.Close(); err != nil {
		cleanup()
		return err
	}
	if err := os.Rename(tempPath, path); err != nil {
		cleanup()
		return err
	}
	return nil
}

func generateBootstrapPassword() (string, error) {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
	length, err := randomIntInclusive(minBootstrapPasswordSize, maxBootstrapPasswordSize)
	if err != nil {
		return "", err
	}

	builder := strings.Builder{}
	builder.Grow(length)
	for i := 0; i < length; i++ {
		index, err := randomIntInclusive(0, len(alphabet)-1)
		if err != nil {
			return "", err
		}
		builder.WriteByte(alphabet[index])
	}
	return builder.String(), nil
}

func randomIntInclusive(minValue int, maxValue int) (int, error) {
	if minValue > maxValue {
		return 0, fmt.Errorf("invalid random range: %d-%d", minValue, maxValue)
	}
	span := big.NewInt(int64(maxValue - minValue + 1))
	value, err := rand.Int(rand.Reader, span)
	if err != nil {
		return 0, err
	}
	return int(value.Int64()) + minValue, nil
}

func isValidServerPassword(password string) bool {
	if strings.ContainsAny(password, "\r\n") {
		return false
	}
	length := len(password)
	return length >= 1 && length <= maxServerPasswordSize
}
