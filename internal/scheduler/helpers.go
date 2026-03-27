package scheduler

import (
	"strconv"
	"strings"
)

// atoi is a convenience wrapper that returns 0 on failure.
func atoi(s string) int {
	v, _ := strconv.Atoi(s)
	return v
}

// containsAny returns true if s contains any of the provided substrings.
func containsAny(s string, subs ...string) bool {
	lower := strings.ToLower(s)
	for _, sub := range subs {
		if strings.Contains(lower, strings.ToLower(sub)) {
			return true
		}
	}
	return false
}

// nilIfEmptyStr returns nil for an empty string, otherwise a pointer to it.
func nilIfEmptyStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
