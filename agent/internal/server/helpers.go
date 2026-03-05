package server

import (
	"encoding/json"
	"net/http"
	"os/exec"
	"runtime"
	"strings"

	"github.com/allaymc/agent/pkg/types"
)

const agentVersion = "0.1.0"

func jsonResponse(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func jsonError(w http.ResponseWriter, status int, message string) {
	jsonResponse(w, status, map[string]string{"error": message})
}

func getSystemInfo() types.SystemInfo {
	info := types.SystemInfo{
		Version: agentVersion,
		OS:      runtime.GOOS,
		Arch:    runtime.GOARCH,
	}

	javaPaths := []string{}
	if path, err := exec.LookPath("java"); err == nil {
		javaPaths = append(javaPaths, path)
	}

	out, err := exec.Command("which", "-a", "java").Output()
	if err == nil {
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			line = strings.TrimSpace(line)
			if line != "" && !contains(javaPaths, line) {
				javaPaths = append(javaPaths, line)
			}
		}
	}

	info.JavaPaths = javaPaths
	return info
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}
