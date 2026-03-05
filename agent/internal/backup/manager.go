package backup

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/allaymc/agent/pkg/types"
)

type Manager struct {
	dataDir string
}

func NewManager(dataDir string) *Manager {
	return &Manager{dataDir: dataDir}
}

func (m *Manager) Create(serverID string) (*types.BackupInfo, error) {
	serverDir := filepath.Join(m.dataDir, "servers", serverID)
	if _, err := os.Stat(serverDir); err != nil {
		return nil, fmt.Errorf("server directory not found: %w", err)
	}

	backupsDir := filepath.Join(m.dataDir, "backups")
	if err := os.MkdirAll(backupsDir, 0755); err != nil {
		return nil, fmt.Errorf("creating backups directory: %w", err)
	}

	ts := time.Now().UTC().Format("2006-01-02T15-04-05")
	filename := fmt.Sprintf("%s_%s.tar.gz", serverID, ts)
	backupPath := filepath.Join(backupsDir, filename)

	outFile, err := os.Create(backupPath)
	if err != nil {
		return nil, fmt.Errorf("creating backup file: %w", err)
	}

	gzWriter := gzip.NewWriter(outFile)
	tarWriter := tar.NewWriter(gzWriter)

	err = filepath.Walk(serverDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		relPath, err := filepath.Rel(serverDir, path)
		if err != nil {
			return err
		}

		if strings.HasPrefix(relPath, ".allay") {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		header, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		header.Name = relPath

		if err := tarWriter.WriteHeader(header); err != nil {
			return err
		}

		if !info.IsDir() {
			if err := func() error {
				f, err := os.Open(path)
				if err != nil {
					return err
				}
				defer f.Close()
				_, err = io.Copy(tarWriter, f)
				return err
			}(); err != nil {
				return err
			}
		}

		return nil
	})
	tarWriter.Close()
	gzWriter.Close()
	outFile.Close()

	if err != nil {
		os.Remove(backupPath)
		return nil, fmt.Errorf("creating tar archive: %w", err)
	}

	stat, _ := os.Stat(backupPath)

	return &types.BackupInfo{
		ID:        filename,
		Filename:  filename,
		SizeBytes: stat.Size(),
		CreatedAt: time.Now().UTC(),
	}, nil
}

func (m *Manager) List(serverID string) ([]types.BackupInfo, error) {
	backupsDir := filepath.Join(m.dataDir, "backups")
	entries, err := os.ReadDir(backupsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []types.BackupInfo{}, nil
		}
		return nil, err
	}

	var backups []types.BackupInfo
	prefix := serverID + "_"
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), prefix) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		backups = append(backups, types.BackupInfo{
			ID:        entry.Name(),
			Filename:  entry.Name(),
			SizeBytes: info.Size(),
			CreatedAt: info.ModTime(),
		})
	}

	return backups, nil
}

func (m *Manager) Restore(serverID, backupID string) error {
	backupPath := filepath.Join(m.dataDir, "backups", backupID)
	if _, err := os.Stat(backupPath); err != nil {
		return fmt.Errorf("backup not found: %w", err)
	}

	serverDir := filepath.Join(m.dataDir, "servers", serverID)
	allayDir := filepath.Join(serverDir, ".allay")

	allayBackup := filepath.Join(serverDir, ".allay_restore_backup")
	os.Rename(allayDir, allayBackup)

	entries, _ := os.ReadDir(serverDir)
	for _, entry := range entries {
		name := entry.Name()
		if name == ".allay_restore_backup" {
			continue
		}
		os.RemoveAll(filepath.Join(serverDir, name))
	}

	inFile, err := os.Open(backupPath)
	if err != nil {
		os.Rename(allayBackup, allayDir)
		return err
	}
	defer inFile.Close()

	gzReader, err := gzip.NewReader(inFile)
	if err != nil {
		os.Rename(allayBackup, allayDir)
		return err
	}
	defer gzReader.Close()

	tarReader := tar.NewReader(gzReader)
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			os.Rename(allayBackup, allayDir)
			return err
		}

		target := filepath.Join(serverDir, header.Name)

		cleanTarget := filepath.Clean(target)
		cleanServer := filepath.Clean(serverDir)
		if cleanTarget != cleanServer && !strings.HasPrefix(cleanTarget, cleanServer+string(filepath.Separator)) {
			continue
		}

		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0755); err != nil {
				os.Rename(allayBackup, allayDir)
				return fmt.Errorf("creating directory %s: %w", target, err)
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
				os.Rename(allayBackup, allayDir)
				return fmt.Errorf("creating parent dir for %s: %w", target, err)
			}
			if err := func() error {
				f, err := os.Create(target)
				if err != nil {
					return err
				}
				defer f.Close()
				const maxFileSize = 1 << 30 // 1GB per file
				if _, err := io.Copy(f, io.LimitReader(tarReader, maxFileSize)); err != nil {
					return err
				}
				return nil
			}(); err != nil {
				os.Rename(allayBackup, allayDir)
				return fmt.Errorf("extracting %s: %w", target, err)
			}
		}
	}

	os.Rename(allayBackup, allayDir)
	return nil
}

func (m *Manager) Delete(backupID string) error {
	backupPath := filepath.Join(m.dataDir, "backups", backupID)
	return os.Remove(backupPath)
}
