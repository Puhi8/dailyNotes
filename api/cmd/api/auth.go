package main

import (
	"crypto/rand"
	"dailyNotes/internal/db"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"log"
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	maxLoginBodyBytes       int64 = 16 * 1024
	maxCredentialsBodyBytes int64 = 16 * 1024
)

const (
	maxFailedLoginAttempts = 8
	failedLoginWindow      = 15 * time.Minute
	loginBlockDuration     = 2 * time.Minute
)

var (
	loginAttemptMu    sync.Mutex
	loginAttemptsByIP = make(map[string]loginAttemptState)
)

type loginAttemptState struct {
	firstFailedAt time.Time
	failedCount   int
	blockedUntil  time.Time
}

type loginRequest struct {
	Password string `json:"password"`
}

type loginResponse struct {
	UserID int64  `json:"userId"`
	JWT    string `json:"jwt"`
}

type updateCredentialsRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

type updateCredentialsResponse struct {
	UserID int64 `json:"userId"`
}

func handleLogin(writer http.ResponseWriter, req *http.Request) {
	setCorsHeaders(writer, req)
	writer.Header().Set("Cache-Control", "no-store")
	requestTime := time.Now()
	clientIP := extractClientIP(req)
	if blocked, retryAfter := loginBlocked(clientIP, requestTime); blocked {
		log.Printf("[auth] login rejected: ip=%s reason=rate_limited retry_after=%s", clientIP, retryAfter.Round(time.Second))
		writer.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(retryAfter.Seconds()))))
		http.Error(writer, "Too many login attempts. Try again later.", http.StatusTooManyRequests)
		return
	}
	var payload loginRequest
	if err := decodeStrictJSONBody(writer, req, maxLoginBodyBytes, &payload); err != nil {
		log.Printf("[auth] login rejected: ip=%s reason=invalid_json err=%v", clientIP, err)
		if isRequestBodyTooLarge(err) {
			http.Error(writer, "Request payload too large", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(writer, "Invalid JSON payload", http.StatusBadRequest)
		return
	}
	password := payload.Password
	if password == "" {
		log.Printf("[auth] login rejected: ip=%s reason=missing_password", clientIP)
		http.Error(writer, "Password required", http.StatusBadRequest)
		return
	}
	if len(password) > 1024 {
		log.Printf("[auth] login rejected: ip=%s reason=invalid_payload_size password_len=%d", clientIP, len(password))
		http.Error(writer, "Invalid login payload", http.StatusBadRequest)
		return
	}
	user, err := getPrimaryLoginUser()
	if err == sql.ErrNoRows {
		log.Printf("[auth] login rejected: ip=%s reason=primary_user_not_found", clientIP)
		recordLoginFailure(clientIP, requestTime)
		http.Error(writer, "Invalid credentials", http.StatusUnauthorized)
		return
	}
	if err != nil {
		log.Printf("[auth] login failed: ip=%s reason=user_lookup_error err=%v", clientIP, err)
		http.Error(writer, "Failed to load user", http.StatusInternalServerError)
		return
	}

	passwordOK, err := verifyServerPassword(password)
	if err != nil {
		log.Printf("[auth] login failed: ip=%s user_id=%d reason=password_verify_error err=%v", clientIP, user.UserID, err)
		http.Error(writer, "Failed to verify credentials", http.StatusInternalServerError)
		return
	}
	if !passwordOK {
		log.Printf("[auth] login rejected: ip=%s user_id=%d reason=password_mismatch", clientIP, user.UserID)
		recordLoginFailure(clientIP, requestTime)
		http.Error(writer, "Invalid credentials", http.StatusUnauthorized)
		return
	}
	token := strings.TrimSpace(user.JWT.String)
	if token == "" {
		created, err := generateAuthToken()
		if err != nil {
			http.Error(writer, "Failed to create token", http.StatusInternalServerError)
			return
		}
		if err := db.UpdateUserJWT(user.UserID, created); err != nil {
			http.Error(writer, "Failed to save token", http.StatusInternalServerError)
			return
		}
		token = created
	}
	cacheUserToken(user.UserID, token)
	clearLoginFailures(clientIP)
	log.Printf("[auth] login success: ip=%s user_id=%d", clientIP, user.UserID)
	response := loginResponse{
		UserID: user.UserID,
		JWT:    token,
	}
	res, err := json.Marshal(response)
	if err != nil {
		http.Error(writer, "Error when converting json:", http.StatusInternalServerError)
		return
	}
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(http.StatusOK)
	writer.Write(res)
}

func getPrimaryLoginUser() (db.UserAuthRow, error) {
	return db.GetUserAuthByID(bootstrapSingleUserID)
}

func handleLogout(writer http.ResponseWriter, req *http.Request, userID int64) {
	setCorsHeaders(writer, req)
	writer.Header().Set("Cache-Control", "no-store")
	if err := db.UpdateUserJWT(userID, ""); err != nil {
		http.Error(writer, "Failed to clear token", http.StatusInternalServerError)
		return
	}
	removeUserToken(userID)
	writer.WriteHeader(http.StatusNoContent)
}

func handleUpdateCredentials(writer http.ResponseWriter, req *http.Request, userID int64) {
	setCorsHeaders(writer, req)
	writer.Header().Set("Cache-Control", "no-store")

	var payload updateCredentialsRequest
	if err := decodeStrictJSONBody(writer, req, maxCredentialsBodyBytes, &payload); err != nil {
		if isRequestBodyTooLarge(err) {
			http.Error(writer, "Request payload too large", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(writer, "Invalid JSON payload", http.StatusBadRequest)
		return
	}

	currentPassword := payload.CurrentPassword
	newPassword := payload.NewPassword
	if currentPassword == "" || newPassword == "" {
		http.Error(writer, "Current password and new password are required", http.StatusBadRequest)
		return
	}
	if len(currentPassword) > 1024 || len(newPassword) > 1024 {
		http.Error(writer, "Invalid credentials payload", http.StatusBadRequest)
		return
	}

	_, err := db.GetUserAuthByID(userID)
	if err == sql.ErrNoRows {
		http.Error(writer, "Unauthorized user", http.StatusUnauthorized)
		return
	}
	if err != nil {
		http.Error(writer, "Failed to load user", http.StatusInternalServerError)
		return
	}

	currentPasswordValid, err := verifyServerPassword(currentPassword)
	if err != nil {
		http.Error(writer, "Failed to verify current password", http.StatusInternalServerError)
		return
	}
	if !currentPasswordValid {
		log.Printf("[auth] credentials update rejected: user_id=%d reason=current_password_mismatch", userID)
		http.Error(writer, "Current password is incorrect", http.StatusUnauthorized)
		return
	}

	if err := updateServerPassword(newPassword); err != nil {
		http.Error(writer, "Failed to update server password file", http.StatusInternalServerError)
		return
	}
	if err := db.UpdateUserJWT(userID, ""); err != nil {
		http.Error(writer, "Failed to rotate auth token", http.StatusInternalServerError)
		return
	}
	removeUserToken(userID)
	log.Printf("[auth] credentials updated: user_id=%d auth_token_rotated=true", userID)

	res, err := json.Marshal(updateCredentialsResponse{
		UserID: userID,
	})
	if err != nil {
		http.Error(writer, "Error when converting json:", http.StatusInternalServerError)
		return
	}
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(http.StatusOK)
	writer.Write(res)
}

func authenticateRequest(req *http.Request) (int64, bool) {
	token := extractBearerToken(req.Header.Get("Authorization"))
	if token == "" {
		return 0, false
	}
	authCacheMu.RLock()
	userID, ok := jwtUserCache[token]
	authCacheMu.RUnlock()
	return userID, ok
}

func extractBearerToken(header string) string {
	trimmed := strings.TrimSpace(header)
	if trimmed == "" {
		return ""
	}
	parts := strings.SplitN(trimmed, " ", 2)
	if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
		return strings.TrimSpace(parts[1])
	}
	return trimmed
}

func loadAuthCache() error {
	users, err := db.GetAllUserAuth()
	if err != nil {
		return err
	}
	authCacheMu.Lock()
	userJWTCache = make(map[int64]string, len(users))
	jwtUserCache = make(map[string]int64, len(users))
	authCacheMu.Unlock()
	for _, user := range users {
		token := strings.TrimSpace(user.JWT.String)
		if token == "" {
			created, err := generateAuthToken()
			if err != nil {
				return err
			}
			if err := db.UpdateUserJWT(user.UserID, created); err != nil {
				return err
			}
			token = created
		}
		cacheUserToken(user.UserID, token)
	}
	return nil
}

func generateAuthToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func cacheUserToken(userID int64, token string) {
	if token == "" {
		return
	}
	authCacheMu.Lock()
	defer authCacheMu.Unlock()
	if old, ok := userJWTCache[userID]; ok && old != token {
		delete(jwtUserCache, old)
	}
	userJWTCache[userID] = token
	jwtUserCache[token] = userID
}

func removeUserToken(userID int64) {
	authCacheMu.Lock()
	defer authCacheMu.Unlock()
	if old, ok := userJWTCache[userID]; ok {
		delete(jwtUserCache, old)
	}
	delete(userJWTCache, userID)
}

func extractClientIP(req *http.Request) string {
	remote := strings.TrimSpace(req.RemoteAddr)
	if remote == "" {
		return "unknown"
	}
	host, _, err := net.SplitHostPort(remote)
	if err != nil {
		return remote
	}
	return host
}

func loginBlocked(clientIP string, now time.Time) (bool, time.Duration) {
	loginAttemptMu.Lock()
	defer loginAttemptMu.Unlock()

	state, exists := loginAttemptsByIP[clientIP]
	if !exists {
		return false, 0
	}
	if !state.blockedUntil.IsZero() && now.Before(state.blockedUntil) {
		return true, state.blockedUntil.Sub(now)
	}
	if !state.firstFailedAt.IsZero() && now.Sub(state.firstFailedAt) > failedLoginWindow {
		delete(loginAttemptsByIP, clientIP)
	}
	return false, 0
}

func recordLoginFailure(clientIP string, now time.Time) {
	loginAttemptMu.Lock()
	defer loginAttemptMu.Unlock()

	state := loginAttemptsByIP[clientIP]
	if state.firstFailedAt.IsZero() || now.Sub(state.firstFailedAt) > failedLoginWindow {
		state = loginAttemptState{firstFailedAt: now, failedCount: 0}
	}
	state.failedCount++
	if state.failedCount >= maxFailedLoginAttempts {
		state.blockedUntil = now.Add(loginBlockDuration)
	}
	loginAttemptsByIP[clientIP] = state

	// Keep map bounded by pruning stale entries opportunistically.
	if len(loginAttemptsByIP) > 10000 {
		for ip, candidate := range loginAttemptsByIP {
			if now.Sub(candidate.firstFailedAt) > failedLoginWindow && now.After(candidate.blockedUntil) {
				delete(loginAttemptsByIP, ip)
			}
		}
	}
}

func clearLoginFailures(clientIP string) {
	loginAttemptMu.Lock()
	defer loginAttemptMu.Unlock()
	delete(loginAttemptsByIP, clientIP)
}
