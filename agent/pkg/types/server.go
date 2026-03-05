package types

import "time"

type ServerState string

const (
	StateStarting ServerState = "starting"
	StateRunning  ServerState = "running"
	StateStopping ServerState = "stopping"
	StateStopped  ServerState = "stopped"
	StateCrashed  ServerState = "crashed"
)

type ServerType string

const (
	ServerTypeVanilla ServerType = "vanilla"
	ServerTypePaper   ServerType = "paper"
)

type ProvisionRequest struct {
	ID      string     `json:"id"`
	Name    string     `json:"name"`
	Type    ServerType `json:"type"`
	Version string     `json:"version"`
	Port    int        `json:"port"`
	RAMMin  int        `json:"ramMin"`
	RAMMax  int        `json:"ramMax"`
	JVMArgs []string   `json:"jvmArgs,omitempty"`
}

type ServerStatus struct {
	ID        string      `json:"id"`
	State     ServerState `json:"state"`
	PID       int         `json:"pid,omitempty"`
	StartedAt *time.Time  `json:"startedAt,omitempty"`
	Port      int         `json:"port"`
}

type ServerStateJSON struct {
	PID         int       `json:"pid"`
	State       string    `json:"state"`
	StartedAt   time.Time `json:"startedAt"`
	JavaCommand string    `json:"javaCommand"`
	JavaArgs    []string  `json:"javaArgs"`
	Port        int       `json:"port"`
	RCONPort    int       `json:"rconPort,omitempty"`
	RCONPass    string    `json:"rconPassword,omitempty"`
}

type CommandRequest struct {
	Command string `json:"command"`
}

type StartResponse struct {
	Status string `json:"status"`
	PID    int    `json:"pid"`
}

type BackupInfo struct {
	ID        string    `json:"id"`
	Filename  string    `json:"filename"`
	SizeBytes int64     `json:"sizeBytes"`
	CreatedAt time.Time `json:"createdAt"`
}

type FileEntry struct {
	Name    string `json:"name"`
	IsDir   bool   `json:"isDir"`
	Size    int64  `json:"size"`
	ModTime string `json:"modTime"`
}

type JarVersion struct {
	ID          string `json:"id"`
	Type        string `json:"type"`
	URL         string `json:"url,omitempty"`
	ReleaseTime string `json:"releaseTime,omitempty"`
}

type SystemInfo struct {
	Version   string `json:"version"`
	OS        string `json:"os"`
	Arch      string `json:"arch"`
	JavaPaths []string `json:"javaPaths"`
}
