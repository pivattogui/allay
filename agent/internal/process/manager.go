package process

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/allaymc/agent/pkg/types"
)

type EventCallback func(event any)

type ProcessInfo struct {
	ID        string
	Cmd       *exec.Cmd
	State     types.ServerState
	PID       int
	StartedAt time.Time
	Port      int
	RCONPort  int
	RCONPass  string
	LogFile   *os.File
	Stdin     io.WriteCloser
	exitCh    chan struct{}
	mu        sync.Mutex
	logMu     sync.Mutex
}

type OnRunningCallback func(serverID string, info *ProcessInfo)

type Manager struct {
	dataDir    string
	processes  map[string]*ProcessInfo
	mu         sync.RWMutex
	onEvent    EventCallback
	onRunning  OnRunningCallback
	logger     *slog.Logger
	rconPortMu sync.Mutex
}

func NewManager(dataDir string, logger *slog.Logger, onEvent EventCallback) *Manager {
	return &Manager{
		dataDir:   dataDir,
		processes: make(map[string]*ProcessInfo),
		onEvent:   onEvent,
		logger:    logger,
	}
}

func (m *Manager) SetOnRunning(cb OnRunningCallback) {
	m.onRunning = cb
}

func (m *Manager) Reconcile() error {
	serversDir := filepath.Join(m.dataDir, "servers")
	entries, err := os.ReadDir(serversDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		serverID := entry.Name()
		statePath := filepath.Join(serversDir, serverID, ".allay", "state.json")

		data, err := os.ReadFile(statePath)
		if err != nil {
			continue
		}

		var state types.ServerStateJSON
		if err := json.Unmarshal(data, &state); err != nil {
			continue
		}

		if state.State != string(types.StateRunning) && state.State != string(types.StateStarting) {
			continue
		}

		if isProcessAlive(state.PID) {
			m.logger.Info("reconciling running server", "id", serverID, "pid", state.PID)
			info := &ProcessInfo{
				ID:        serverID,
				State:     types.StateRunning,
				PID:       state.PID,
				StartedAt: state.StartedAt,
				Port:      state.Port,
				RCONPort:  state.RCONPort,
				RCONPass:  state.RCONPass,
			}

			logPath := filepath.Join(serversDir, serverID, ".allay", "logs", "latest.log")
			if f, err := os.Open(logPath); err == nil {
				info.LogFile = f
				go m.tailLog(serverID, f)
			}

			m.mu.Lock()
			m.processes[serverID] = info
			m.mu.Unlock()
		} else {
			m.logger.Warn("server process dead, marking crashed", "id", serverID, "pid", state.PID)
			state.State = string(types.StateCrashed)
			if data, err := json.MarshalIndent(state, "", "  "); err == nil {
				os.WriteFile(statePath, data, 0644)
			}
			m.emitStatus(serverID, types.StateCrashed, 0)
		}
	}

	return nil
}

func (m *Manager) Start(serverID string) (*types.StartResponse, error) {
	m.mu.Lock()
	if info, ok := m.processes[serverID]; ok {
		info.mu.Lock()
		state := info.State
		info.mu.Unlock()
		if state == types.StateRunning || state == types.StateStarting {
			m.mu.Unlock()
			return nil, fmt.Errorf("server %s is already %s", serverID, state)
		}
	}
	// Hold write lock until we insert into map — prevents TOCTOU
	// We'll unlock after inserting

	serverDir := filepath.Join(m.dataDir, "servers", serverID)
	allayDir := filepath.Join(serverDir, ".allay")
	logsDir := filepath.Join(allayDir, "logs")
	os.MkdirAll(logsDir, 0755)

	statePath := filepath.Join(allayDir, "state.json")
	stateData, err := os.ReadFile(statePath)
	if err != nil {
		m.mu.Unlock()
		return nil, fmt.Errorf("reading state.json: %w (was the server provisioned?)", err)
	}

	var state types.ServerStateJSON
	if err := json.Unmarshal(stateData, &state); err != nil {
		m.mu.Unlock()
		return nil, fmt.Errorf("parsing state.json: %w", err)
	}

	logFile, err := os.OpenFile(
		filepath.Join(logsDir, "latest.log"),
		os.O_CREATE|os.O_WRONLY|os.O_APPEND,
		0644,
	)
	if err != nil {
		m.mu.Unlock()
		return nil, fmt.Errorf("opening log file: %w", err)
	}

	cmd := exec.Command(state.JavaCommand, state.JavaArgs...)
	cmd.Dir = serverDir
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}

	stdinPipe, err := cmd.StdinPipe()
	if err != nil {
		logFile.Close()
		m.mu.Unlock()
		return nil, fmt.Errorf("creating stdin pipe: %w", err)
	}

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		logFile.Close()
		m.mu.Unlock()
		return nil, fmt.Errorf("creating stdout pipe: %w", err)
	}

	cmd.Stderr = cmd.Stdout

	if err := cmd.Start(); err != nil {
		logFile.Close()
		m.mu.Unlock()
		return nil, fmt.Errorf("starting server: %w", err)
	}

	pid := cmd.Process.Pid

	info := &ProcessInfo{
		ID:        serverID,
		Cmd:       cmd,
		State:     types.StateStarting,
		PID:       pid,
		StartedAt: time.Now().UTC(),
		Port:      state.Port,
		RCONPort:  state.RCONPort,
		RCONPass:  state.RCONPass,
		LogFile:   logFile,
		Stdin:     stdinPipe,
		exitCh:    make(chan struct{}),
	}

	m.processes[serverID] = info
	m.mu.Unlock()

	if err := os.WriteFile(filepath.Join(allayDir, "process.pid"), []byte(strconv.Itoa(pid)), 0644); err != nil {
		m.logger.Warn("failed to write PID file", "id", serverID, "error", err)
	}
	state.PID = pid
	state.State = string(types.StateStarting)
	state.StartedAt = info.StartedAt
	if data, err := json.MarshalIndent(state, "", "  "); err == nil {
		if err := os.WriteFile(statePath, data, 0644); err != nil {
			m.logger.Warn("failed to write state file", "id", serverID, "error", err)
		}
	}

	m.emitStatus(serverID, types.StateStarting, pid)

	go m.monitorOutput(serverID, stdoutPipe, info)
	go m.waitForExit(serverID)

	return &types.StartResponse{Status: string(types.StateStarting), PID: pid}, nil
}

func (m *Manager) Stop(serverID string) error {
	info, err := m.getProcess(serverID)
	if err != nil {
		return err
	}

	info.mu.Lock()
	if info.State != types.StateRunning && info.State != types.StateStarting {
		info.mu.Unlock()
		return fmt.Errorf("server %s is not running (state: %s)", serverID, info.State)
	}
	info.State = types.StateStopping
	isReconciled := info.Cmd == nil
	pid := info.PID
	info.mu.Unlock()

	m.emitStatus(serverID, types.StateStopping, pid)

	if info.Stdin != nil {
		io.WriteString(info.Stdin, "stop\n")
	} else if isReconciled && pid > 0 {
		syscall.Kill(pid, syscall.SIGTERM)
	}

	// Wait for exit via exitCh (populated by waitForExit) or polling for reconciled
	if isReconciled {
		// For reconciled processes, poll PID
		deadline := time.After(30 * time.Second)
		for {
			select {
			case <-deadline:
				m.logger.Warn("graceful stop timed out for reconciled process, sending SIGKILL", "id", serverID)
				if pid > 0 {
					syscall.Kill(-pid, syscall.SIGKILL)
				}
				m.markStopped(serverID)
				return nil
			case <-time.After(500 * time.Millisecond):
				if !isProcessAlive(pid) {
					m.markStopped(serverID)
					return nil
				}
			}
		}
	}

	// For managed processes, wait on exitCh (closed by waitForExit)
	select {
	case <-info.exitCh:
		// waitForExit already handled state transition
	case <-time.After(30 * time.Second):
		m.logger.Warn("graceful stop timed out, sending SIGTERM", "id", serverID)
		if info.Cmd != nil && info.Cmd.Process != nil {
			info.Cmd.Process.Signal(syscall.SIGTERM)
		}
		select {
		case <-info.exitCh:
		case <-time.After(5 * time.Second):
			m.logger.Warn("SIGTERM timed out, sending SIGKILL", "id", serverID)
			m.Kill(serverID)
			return nil
		}
	}
	return nil
}

func (m *Manager) Kill(serverID string) error {
	info, err := m.getProcess(serverID)
	if err != nil {
		if isOrphan(m.dataDir, serverID) {
			return killOrphan(m.dataDir, serverID)
		}
		return err
	}

	if info.PID > 0 {
		syscall.Kill(-info.PID, syscall.SIGKILL)
	}

	m.markStopped(serverID)
	return nil
}

func (m *Manager) Restart(serverID string) error {
	info, _ := m.getProcess(serverID)
	if info != nil && (info.State == types.StateRunning || info.State == types.StateStarting) {
		if err := m.Stop(serverID); err != nil {
			return err
		}
	}
	_, err := m.Start(serverID)
	return err
}

func (m *Manager) SendCommand(serverID, command string) error {
	info, err := m.getProcess(serverID)
	if err != nil {
		return err
	}

	info.mu.Lock()
	defer info.mu.Unlock()

	if info.State != types.StateRunning {
		return fmt.Errorf("server %s is not running", serverID)
	}

	if info.Stdin != nil {
		_, err := io.WriteString(info.Stdin, command+"\n")
		return err
	}

	return fmt.Errorf("no stdin pipe available for server %s", serverID)
}

func (m *Manager) GetStatus(serverID string) (*types.ServerStatus, error) {
	info, err := m.getProcess(serverID)
	if err != nil {
		statePath := filepath.Join(m.dataDir, "servers", serverID, ".allay", "state.json")
		if data, readErr := os.ReadFile(statePath); readErr == nil {
			var state types.ServerStateJSON
			if json.Unmarshal(data, &state) == nil {
				return &types.ServerStatus{
					ID:    serverID,
					State: types.ServerState(state.State),
					Port:  state.Port,
				}, nil
			}
		}
		return &types.ServerStatus{ID: serverID, State: types.StateStopped}, nil
	}

	info.mu.Lock()
	defer info.mu.Unlock()

	return &types.ServerStatus{
		ID:        serverID,
		State:     info.State,
		PID:       info.PID,
		StartedAt: &info.StartedAt,
		Port:      info.Port,
	}, nil
}

func (m *Manager) GetLogs(serverID string, lines int) ([]string, error) {
	logPath := filepath.Join(m.dataDir, "servers", serverID, ".allay", "logs", "latest.log")
	return tailFile(logPath, lines)
}

func (m *Manager) GetAllStatuses() map[string]string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	statuses := make(map[string]string)
	for id, info := range m.processes {
		info.mu.Lock()
		statuses[id] = string(info.State)
		info.mu.Unlock()
	}
	return statuses
}

func (m *Manager) StopAll() {
	m.mu.RLock()
	ids := make([]string, 0, len(m.processes))
	for id := range m.processes {
		ids = append(ids, id)
	}
	m.mu.RUnlock()

	for _, id := range ids {
		m.logger.Info("stopping server for shutdown", "id", id)
		m.Stop(id)
	}
}

func (m *Manager) monitorOutput(serverID string, stdout io.Reader, info *ProcessInfo) {
	scanner := bufio.NewScanner(stdout)
	buf := make([]byte, 0, 256*1024)
	scanner.Buffer(buf, 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()

		info.logMu.Lock()
		if info.LogFile != nil {
			info.LogFile.WriteString(line + "\n")
		}
		info.logMu.Unlock()

		m.onEvent(types.LogEvent{
			Type:      types.EventLog,
			ServerID:  serverID,
			Timestamp: time.Now().UTC(),
			Level:     parseLogLevel(line),
			Message:   line,
		})

		if strings.Contains(line, "Done") && strings.Contains(line, "For help, type") {
			info.mu.Lock()
			if info.State == types.StateStarting {
				info.State = types.StateRunning
				m.updateStateFile(serverID, types.StateRunning)
				m.emitStatus(serverID, types.StateRunning, info.PID)
				if m.onRunning != nil {
					go m.onRunning(serverID, info)
				}
			}
			info.mu.Unlock()
		}
	}
}

func (m *Manager) waitForExit(serverID string) {
	m.mu.RLock()
	info, ok := m.processes[serverID]
	m.mu.RUnlock()
	if !ok || info.Cmd == nil {
		return
	}

	err := info.Cmd.Wait()
	info.mu.Lock()
	prevState := info.State
	if prevState == types.StateStopping {
		info.State = types.StateStopped
	} else if err != nil {
		info.State = types.StateCrashed
	} else {
		info.State = types.StateStopped
	}
	finalState := info.State
	info.mu.Unlock()

	info.logMu.Lock()
	if info.LogFile != nil {
		info.LogFile.Close()
		info.LogFile = nil
	}
	info.logMu.Unlock()

	m.updateStateFile(serverID, finalState)
	m.emitStatus(serverID, finalState, 0)

	if finalState == types.StateCrashed {
		m.logger.Error("server crashed", "id", serverID, "error", err)
	}

	close(info.exitCh)
}

func (m *Manager) getProcess(serverID string) (*ProcessInfo, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	info, ok := m.processes[serverID]
	if !ok {
		return nil, fmt.Errorf("server %s not found in process list", serverID)
	}
	return info, nil
}

func (m *Manager) markStopped(serverID string) {
	m.mu.RLock()
	info, ok := m.processes[serverID]
	m.mu.RUnlock()
	if ok {
		info.mu.Lock()
		info.State = types.StateStopped
		info.mu.Unlock()
		info.logMu.Lock()
		if info.LogFile != nil {
			info.LogFile.Close()
			info.LogFile = nil
		}
		info.logMu.Unlock()
	}
	m.updateStateFile(serverID, types.StateStopped)
	m.emitStatus(serverID, types.StateStopped, 0)
}

func (m *Manager) updateStateFile(serverID string, state types.ServerState) {
	statePath := filepath.Join(m.dataDir, "servers", serverID, ".allay", "state.json")
	data, err := os.ReadFile(statePath)
	if err != nil {
		return
	}
	var s types.ServerStateJSON
	if json.Unmarshal(data, &s) != nil {
		return
	}
	s.State = string(state)
	if updated, err := json.MarshalIndent(s, "", "  "); err == nil {
		os.WriteFile(statePath, updated, 0644)
	}
}

func (m *Manager) emitStatus(serverID string, state types.ServerState, pid int) {
	m.onEvent(types.StatusEvent{
		Type:      types.EventStatus,
		ServerID:  serverID,
		Timestamp: time.Now().UTC(),
		State:     state,
		PID:       pid,
	})
}

func (m *Manager) tailLog(serverID string, f *os.File) {
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		m.onEvent(types.LogEvent{
			Type:      types.EventLog,
			ServerID:  serverID,
			Timestamp: time.Now().UTC(),
			Level:     parseLogLevel(scanner.Text()),
			Message:   scanner.Text(),
		})
	}
}

func isProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	return syscall.Kill(pid, 0) == nil
}

func isOrphan(dataDir, serverID string) bool {
	pidPath := filepath.Join(dataDir, "servers", serverID, ".allay", "process.pid")
	data, err := os.ReadFile(pidPath)
	if err != nil {
		return false
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		return false
	}
	return isProcessAlive(pid)
}

func killOrphan(dataDir, serverID string) error {
	pidPath := filepath.Join(dataDir, "servers", serverID, ".allay", "process.pid")
	data, err := os.ReadFile(pidPath)
	if err != nil {
		return err
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		return err
	}
	if pid <= 0 {
		return fmt.Errorf("invalid PID %d for server %s", pid, serverID)
	}
	return syscall.Kill(-pid, syscall.SIGKILL)
}

func parseLogLevel(line string) string {
	switch {
	case strings.Contains(line, "/ERROR"):
		return "error"
	case strings.Contains(line, "/WARN"):
		return "warn"
	case strings.Contains(line, "/INFO"):
		return "info"
	default:
		return "info"
	}
}

func tailFile(path string, n int) ([]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, err
	}

	lines := strings.Split(strings.TrimRight(string(data), "\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return lines, nil
}
