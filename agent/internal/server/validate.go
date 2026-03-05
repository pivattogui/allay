package server

import "regexp"

var safeIDRegex = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]*$`)
var safeVersionRegex = regexp.MustCompile(`^[a-zA-Z0-9._-]+$`)
var validServerTypes = map[string]bool{"vanilla": true, "paper": true}

func isValidID(id string) bool {
	return len(id) > 0 && len(id) <= 128 && safeIDRegex.MatchString(id)
}

func isValidVersion(version string) bool {
	return len(version) > 0 && len(version) <= 64 && safeVersionRegex.MatchString(version)
}

func isValidServerType(t string) bool {
	return validServerTypes[t]
}
