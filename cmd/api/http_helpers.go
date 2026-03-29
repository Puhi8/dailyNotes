package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
)

type authedHandler func(http.ResponseWriter, *http.Request, int64)

type corsRule struct {
	exactOrigin string
	hostOnly    string
}

func handleOptions(writer http.ResponseWriter, req *http.Request) {
	setCorsHeaders(writer, req)
	writer.WriteHeader(http.StatusNoContent)
}

func setCorsHeaders(writer http.ResponseWriter, req *http.Request) {
	allowedOrigin := resolveAllowedCORSOrigin(req)
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	if allowedOrigin != "" {
		if allowedOrigin != "*" {
			writer.Header().Set("Vary", "Origin")
		}
		writer.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
	}
	writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key")
	writer.Header().Set("Access-Control-Max-Age", "600")
}

func resolveAllowedCORSOrigin(req *http.Request) string {
	if corsAllowAll {
		return "*"
	}
	if len(corsRules) == 0 {
		return ""
	}

	requestOrigin := ""
	if req != nil {
		requestOrigin = strings.TrimSpace(req.Header.Get("Origin"))
	}
	if requestOrigin == "" {
		for _, rule := range corsRules {
			if rule.exactOrigin != "" {
				return rule.exactOrigin
			}
		}
		return ""
	}

	normalizedOrigin, originHost, ok := normalizeOriginForCORSMatch(requestOrigin)
	if !ok {
		return ""
	}

	for _, rule := range corsRules {
		if rule.exactOrigin != "" && rule.exactOrigin == normalizedOrigin {
			return requestOrigin
		}
		if rule.hostOnly != "" && rule.hostOnly == originHost {
			return requestOrigin
		}
	}
	return ""
}

func normalizeOriginForCORSMatch(raw string) (string, string, bool) {
	trimmed := strings.TrimSpace(raw)
	if !strings.Contains(trimmed, "://") {
		return "", "", false
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", "", false
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" && scheme != "capacitor" {
		return "", "", false
	}
	host := strings.ToLower(parsed.Host)
	if host == "" {
		return "", "", false
	}
	return scheme + "://" + host, host, true
}

func resolveCORSAllowedOrigins() ([]corsRule, bool) {
	raw := strings.TrimSpace(os.Getenv("DAILYNOTES_CORS_ORIGIN"))
	raw = strings.Trim(raw, "\"")
	if raw == "" {
		return nil, true
	}

	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ';' || r == '\n'
	})
	rules := make([]corsRule, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	allowAll := false

	for _, part := range parts {
		candidate := strings.TrimSpace(strings.Trim(part, "\""))
		if candidate == "" {
			continue
		}
		if candidate == "*" {
			allowAll = true
			continue
		}
		if normalized, _, ok := normalizeOriginForCORSMatch(candidate); ok {
			key := "origin:" + normalized
			if _, exists := seen[key]; !exists {
				seen[key] = struct{}{}
				rules = append(rules, corsRule{exactOrigin: normalized})
			}
			continue
		}

		hostOnly := strings.ToLower(strings.Trim(candidate, "/"))
		if hostOnly == "" {
			continue
		}
		key := "host:" + hostOnly
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		rules = append(rules, corsRule{hostOnly: hostOnly})
	}

	if len(rules) == 0 && !allowAll {
		return nil, true
	}
	return rules, allowAll
}

func authMiddleware(next authedHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			handleOptions(w, r)
			return
		}
		userID, ok := authenticateRequest(r)
		if !ok {
			setCorsHeaders(w, r)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r, userID)
	}
}

func decodeStrictJSONBody(writer http.ResponseWriter, req *http.Request, maxBodyBytes int64, target any) error {
	req.Body = http.MaxBytesReader(writer, req.Body, maxBodyBytes)
	decoder := json.NewDecoder(req.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	// Ensure exactly one JSON document is sent.
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		if err == nil {
			return fmt.Errorf("unexpected trailing JSON payload")
		}
		return err
	}
	return nil
}

func isRequestBodyTooLarge(err error) bool {
	var maxErr *http.MaxBytesError
	return errors.As(err, &maxErr)
}
