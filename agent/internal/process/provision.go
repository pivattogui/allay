package process

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/allaymc/agent/pkg/types"
)

var safeIDRegex = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]*$`)

func (m *Manager) Provision(req types.ProvisionRequest, rconCfg types.RCONCfg) error {
	if !safeIDRegex.MatchString(req.ID) || len(req.ID) > 128 {
		return fmt.Errorf("invalid server ID format")
	}
	if req.Type != types.ServerTypeVanilla && req.Type != types.ServerTypePaper {
		return fmt.Errorf("invalid server type: %s", req.Type)
	}
	if req.Version == "" {
		return fmt.Errorf("version is required")
	}
	if req.Port <= 0 || req.Port > 65535 {
		return fmt.Errorf("invalid port: %d", req.Port)
	}
	if req.RAMMin <= 0 {
		return fmt.Errorf("ramMin must be positive")
	}
	if req.RAMMax < req.RAMMin {
		return fmt.Errorf("ramMax must be >= ramMin")
	}

	serverDir := filepath.Join(m.dataDir, "servers", req.ID)
	allayDir := filepath.Join(serverDir, ".allay")
	logsDir := filepath.Join(allayDir, "logs")

	if err := os.MkdirAll(logsDir, 0755); err != nil {
		return fmt.Errorf("creating server directory: %w", err)
	}

	jarSrc := filepath.Join(m.dataDir, "jars", string(req.Type), req.Version+".jar")
	jarDst := filepath.Join(serverDir, "server.jar")
	if err := copyFile(jarSrc, jarDst); err != nil {
		return fmt.Errorf("copying server jar: %w", err)
	}

	if err := os.WriteFile(filepath.Join(serverDir, "eula.txt"), []byte("eula=true\n"), 0644); err != nil {
		return fmt.Errorf("writing eula.txt: %w", err)
	}

	var rconPort int
	var rconPass string
	props := generateServerProperties(req.Port)

	if rconCfg.Enabled {
		m.rconPortMu.Lock()
		rconPort = allocateRCONPort(m.dataDir, rconCfg.PortRangeStart, rconCfg.PortRangeEnd)
		rconPass = generatePassword(16)
		props["enable-rcon"] = "true"
		props["rcon.port"] = fmt.Sprintf("%d", rconPort)
		props["rcon.password"] = rconPass
	}

	propsContent := formatProperties(props)
	if err := os.WriteFile(filepath.Join(serverDir, "server.properties"), []byte(propsContent), 0644); err != nil {
		return fmt.Errorf("writing server.properties: %w", err)
	}

	javaCmd := findJava()
	javaArgs := buildJavaArgs(req)

	state := types.ServerStateJSON{
		State:       string(types.StateStopped),
		JavaCommand: javaCmd,
		JavaArgs:    javaArgs,
		Port:        req.Port,
		RCONPort:    rconPort,
		RCONPass:    rconPass,
	}

	stateData, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling state: %w", err)
	}
	if err := os.WriteFile(filepath.Join(allayDir, "state.json"), stateData, 0644); err != nil {
		if rconCfg.Enabled {
			m.rconPortMu.Unlock()
		}
		return fmt.Errorf("writing state.json: %w", err)
	}
	if rconCfg.Enabled {
		m.rconPortMu.Unlock()
	}

	return nil
}

func (m *Manager) Deprovision(serverID string) error {
	info, _ := m.getProcess(serverID)
	if info != nil {
		info.mu.Lock()
		state := info.State
		info.mu.Unlock()
		if state == types.StateRunning || state == types.StateStarting {
			m.Kill(serverID)
		}
	}

	m.mu.Lock()
	delete(m.processes, serverID)
	m.mu.Unlock()

	serverDir := filepath.Join(m.dataDir, "servers", serverID)
	return os.RemoveAll(serverDir)
}

func generateServerProperties(port int) map[string]string {
	return map[string]string{
		"server-port":       fmt.Sprintf("%d", port),
		"online-mode":       "true",
		"enable-command-block": "true",
		"max-players":       "20",
		"view-distance":     "10",
		"motd":              "An Allay Minecraft Server",
		"enable-rcon":       "false",
		"spawn-protection":  "0",
	}
}

func formatProperties(props map[string]string) string {
	keys := make([]string, 0, len(props))
	for k := range props {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var sb strings.Builder
	sb.WriteString("# Allay Managed Server Properties\n")
	for _, k := range keys {
		sb.WriteString(k + "=" + props[k] + "\n")
	}
	return sb.String()
}

func buildJavaArgs(req types.ProvisionRequest) []string {
	args := []string{
		fmt.Sprintf("-Xms%dM", req.RAMMin),
		fmt.Sprintf("-Xmx%dM", req.RAMMax),
	}
	args = append(args, req.JVMArgs...)
	args = append(args, "-jar", "server.jar", "nogui")
	return args
}

func findJava() string {
	if path, err := exec.LookPath("java"); err == nil {
		return path
	}
	paths := []string{
		"/usr/bin/java",
		"/usr/local/bin/java",
	}
	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return "java"
}

func allocateRCONPort(dataDir string, start, end int) int {
	used := make(map[int]bool)
	serversDir := filepath.Join(dataDir, "servers")
	entries, _ := os.ReadDir(serversDir)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		statePath := filepath.Join(serversDir, entry.Name(), ".allay", "state.json")
		data, err := os.ReadFile(statePath)
		if err != nil {
			continue
		}
		var state types.ServerStateJSON
		if json.Unmarshal(data, &state) == nil && state.RCONPort > 0 {
			used[state.RCONPort] = true
		}
	}
	for port := start; port <= end; port++ {
		if !used[port] {
			return port
		}
	}
	return start
}

func generatePassword(length int) string {
	b := make([]byte, length)
	rand.Read(b)
	return hex.EncodeToString(b)[:length]
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("opening %s: %w", src, err)
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return fmt.Errorf("creating %s: %w", dst, err)
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return fmt.Errorf("copying %s to %s: %w", src, dst, err)
	}
	return out.Close()
}
