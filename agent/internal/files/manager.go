package files

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/allaymc/agent/pkg/types"
)

type Manager struct {
	dataDir string
}

func NewManager(dataDir string) *Manager {
	return &Manager{dataDir: dataDir}
}

func (m *Manager) List(serverID, subPath string) ([]types.FileEntry, error) {
	dir, err := m.resolvePath(serverID, subPath)
	if err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("reading directory: %w", err)
	}

	result := make([]types.FileEntry, 0, len(entries))
	for _, entry := range entries {
		if entry.Name() == ".allay" {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		result = append(result, types.FileEntry{
			Name:    entry.Name(),
			IsDir:   entry.IsDir(),
			Size:    info.Size(),
			ModTime: info.ModTime().UTC().Format("2006-01-02T15:04:05Z"),
		})
	}

	return result, nil
}

func (m *Manager) Read(serverID, filePath string) ([]byte, error) {
	path, err := m.resolvePath(serverID, filePath)
	if err != nil {
		return nil, err
	}

	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("file not found: %w", err)
	}

	if info.IsDir() {
		return nil, fmt.Errorf("path is a directory, not a file")
	}

	const maxReadSize = 10 << 20 // 10MB
	if info.Size() > maxReadSize {
		return nil, fmt.Errorf("file too large (%d bytes, max %d)", info.Size(), maxReadSize)
	}

	return os.ReadFile(path)
}

func (m *Manager) Write(serverID, filePath string, content []byte) error {
	path, err := m.resolvePath(serverID, filePath)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return fmt.Errorf("creating parent directories: %w", err)
	}

	return os.WriteFile(path, content, 0644)
}

func (m *Manager) Delete(serverID, filePath string) error {
	path, err := m.resolvePath(serverID, filePath)
	if err != nil {
		return err
	}

	if path == filepath.Join(m.dataDir, "servers", serverID) {
		return fmt.Errorf("cannot delete server root directory")
	}

	return os.RemoveAll(path)
}

func (m *Manager) resolvePath(serverID, subPath string) (string, error) {
	serverDir := filepath.Join(m.dataDir, "servers", serverID)
	if _, err := os.Stat(serverDir); err != nil {
		return "", fmt.Errorf("server directory not found")
	}

	if subPath == "" || subPath == "/" {
		return serverDir, nil
	}

	subPath = filepath.Clean(subPath)
	fullPath := filepath.Join(serverDir, subPath)
	absPath, err := filepath.Abs(fullPath)
	if err != nil {
		return "", fmt.Errorf("invalid path")
	}

	absServerDir, _ := filepath.Abs(serverDir)
	if !strings.HasPrefix(absPath, absServerDir+string(filepath.Separator)) && absPath != absServerDir {
		return "", fmt.Errorf("path traversal detected")
	}

	if strings.Contains(absPath, "/.allay/") || strings.HasSuffix(absPath, "/.allay") {
		return "", fmt.Errorf("access to .allay directory is forbidden")
	}

	return absPath, nil
}
