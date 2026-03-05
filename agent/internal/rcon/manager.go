package rcon

import (
	"fmt"
	"log/slog"
	"sync"
)

type Manager struct {
	clients map[string]*Client
	mu      sync.RWMutex
	logger  *slog.Logger
}

func NewManager(logger *slog.Logger) *Manager {
	return &Manager{
		clients: make(map[string]*Client),
		logger:  logger,
	}
}

func (m *Manager) Connect(serverID, host string, port int, password string) error {
	client := NewClient(host, port, password)
	if err := client.Connect(); err != nil {
		return err
	}

	m.mu.Lock()
	old, exists := m.clients[serverID]
	m.clients[serverID] = client
	m.mu.Unlock()

	if exists {
		old.Close()
	}

	m.logger.Info("RCON connected", "server", serverID, "port", port)
	return nil
}

func (m *Manager) Disconnect(serverID string) {
	m.mu.Lock()
	client, ok := m.clients[serverID]
	delete(m.clients, serverID)
	m.mu.Unlock()

	if ok {
		client.Close()
	}
}

func (m *Manager) Execute(serverID, command string) (string, error) {
	m.mu.RLock()
	client, ok := m.clients[serverID]
	m.mu.RUnlock()

	if !ok {
		return "", fmt.Errorf("no RCON connection for server %s", serverID)
	}

	result, err := client.Execute(command)
	if err != nil {
		m.logger.Warn("RCON command failed, attempting reconnect", "server", serverID, "error", err)
		if reconnErr := client.Reconnect(); reconnErr != nil {
			return "", fmt.Errorf("RCON reconnect failed: %w (original: %v)", reconnErr, err)
		}
		return client.Execute(command)
	}
	return result, nil
}

func (m *Manager) IsConnected(serverID string) bool {
	m.mu.RLock()
	client, ok := m.clients[serverID]
	m.mu.RUnlock()

	return ok && client.IsConnected()
}

func (m *Manager) CloseAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for id, client := range m.clients {
		client.Close()
		delete(m.clients, id)
	}
}
