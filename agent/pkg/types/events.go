package types

import "time"

type EventType string

const (
	EventLog       EventType = "log"
	EventStatus    EventType = "status"
	EventMetrics   EventType = "metrics"
	EventHeartbeat EventType = "heartbeat"
)

type LogEvent struct {
	Type      EventType `json:"type"`
	ServerID  string    `json:"serverId"`
	Timestamp time.Time `json:"timestamp"`
	Level     string    `json:"level"`
	Message   string    `json:"message"`
}

type StatusEvent struct {
	Type      EventType   `json:"type"`
	ServerID  string      `json:"serverId"`
	Timestamp time.Time   `json:"timestamp"`
	State     ServerState `json:"state"`
	PID       int         `json:"pid,omitempty"`
	Uptime    int64       `json:"uptime,omitempty"`
}

type MetricsEvent struct {
	Type        EventType `json:"type"`
	ServerID    string    `json:"serverId"`
	Timestamp   time.Time `json:"timestamp"`
	CPUPercent  float64   `json:"cpuPercent"`
	RAMUsedMB   int64     `json:"ramUsedMb"`
	RAMMaxMB    int64     `json:"ramMaxMb"`
	PlayerCount int       `json:"playerCount"`
	PlayerMax   int       `json:"playerMax"`
}

type HeartbeatEvent struct {
	Type      EventType         `json:"type"`
	NodeID    string            `json:"nodeId"`
	Timestamp time.Time         `json:"timestamp"`
	Servers   map[string]string `json:"servers"`
	Resources SystemResources   `json:"resources"`
}

type SystemResources struct {
	CPUPercent  float64 `json:"cpuPercent"`
	RAMUsedMB   int64   `json:"ramUsedMb"`
	RAMTotalMB  int64   `json:"ramTotalMb"`
	DiskUsedGB  int64   `json:"diskUsedGb"`
	DiskTotalGB int64   `json:"diskTotalGb"`
}
