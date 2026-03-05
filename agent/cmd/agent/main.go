package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/allaymc/agent/internal/backup"
	"github.com/allaymc/agent/internal/config"
	"github.com/allaymc/agent/internal/events"
	"github.com/allaymc/agent/internal/files"
	"github.com/allaymc/agent/internal/jar"
	"github.com/allaymc/agent/internal/metrics"
	"github.com/allaymc/agent/internal/process"
	"github.com/allaymc/agent/internal/rcon"
	"github.com/allaymc/agent/internal/server"
	"github.com/allaymc/agent/internal/ws"
	"github.com/allaymc/agent/pkg/types"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	cfg, err := config.Load("config.json")
	if err != nil {
		logger.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	if cfg.Name == "" {
		hostname, _ := os.Hostname()
		cfg.Name = hostname
	}

	for _, dir := range []string{cfg.DataDir, cfg.DataDir + "/servers", cfg.DataDir + "/backups", cfg.DataDir + "/jars"} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			logger.Error("failed to create directory", "path", dir, "error", err)
			os.Exit(1)
		}
	}

	eventBus := events.NewBus(cfg.DataDir, logger)

	rconMgr := rcon.NewManager(logger)
	procMgr := process.NewManager(cfg.DataDir, logger, eventBus.Emit)
	backupMgr := backup.NewManager(cfg.DataDir)
	fileMgr := files.NewManager(cfg.DataDir)
	jarMgr := jar.NewManager(cfg.DataDir)

	procMgr.SetOnRunning(func(serverID string, info *process.ProcessInfo) {
		if info.RCONPort > 0 && info.RCONPass != "" {
			if err := rconMgr.Connect(serverID, "localhost", info.RCONPort, info.RCONPass); err != nil {
				logger.Warn("failed to connect RCON on server running", "id", serverID, "error", err)
			}
		}
	})

	logger.Info("reconciling server processes...")
	if err := procMgr.Reconcile(); err != nil {
		logger.Error("reconciliation failed", "error", err)
	}

	metricsCollector := metrics.NewCollector(
		procMgr, rconMgr,
		cfg.Metrics.CollectIntervalMs,
		logger, eventBus.Emit,
	)
	go metricsCollector.Start()

	nodeID, err := registerWithController(cfg, logger)
	if err != nil {
		logger.Warn("failed to register with controller (will retry on WS connect)", "error", err)
	}

	if cfg.ControllerURL != "" && nodeID != "" {
		wsClient := ws.NewClient(cfg.ControllerURL, nodeID, cfg.Token, logger)

		var heartbeatCancel context.CancelFunc
		wsClient.OnConnect(func() {
			if heartbeatCancel != nil {
				heartbeatCancel()
			}
			var hbCtx context.Context
			hbCtx, heartbeatCancel = context.WithCancel(context.Background())
			eventBus.SetSender(wsClient.Send)
			go startHeartbeat(hbCtx, nodeID, procMgr, eventBus, cfg)
		})

		wsClient.OnDisconnect(func() {
			if heartbeatCancel != nil {
				heartbeatCancel()
				heartbeatCancel = nil
			}
			eventBus.SetSender(nil)
		})

		wsClient.Start()
		defer func() {
			if heartbeatCancel != nil {
				heartbeatCancel()
			}
			wsClient.Stop()
		}()
	}

	srv := server.New(cfg, procMgr, rconMgr, backupMgr, fileMgr, jarMgr, logger)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		if err := srv.Start(); err != nil && err != http.ErrServerClosed {
			logger.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	logger.Info("agent started", "port", cfg.Port, "name", cfg.Name)

	<-sigCh
	logger.Info("shutting down...")

	metricsCollector.Stop()
	rconMgr.CloseAll()

	procMgr.StopAll()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(ctx)

	logger.Info("agent stopped")
}

func registerWithController(cfg *types.Config, logger *slog.Logger) (string, error) {
	if cfg.ControllerURL == "" {
		return "", fmt.Errorf("no controller URL configured")
	}

	nodeID, err := config.LoadNodeID(cfg.DataDir)
	if err != nil {
		return "", err
	}
	if nodeID != "" {
		// Verify node still exists in backend
		req, err := http.NewRequest("GET", cfg.ControllerURL+"/api/nodes/"+nodeID, nil)
		if err == nil {
			req.Header.Set("Authorization", "Bearer "+cfg.Token)
			resp, err := http.DefaultClient.Do(req)
			if err == nil {
				resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					logger.Info("using existing node ID", "nodeId", nodeID)
					return nodeID, nil
				}
				// Node doesn't exist in backend, clear cache and re-register
				logger.Warn("cached node ID not found in backend, re-registering", "nodeId", nodeID)
				_ = os.Remove(cfg.DataDir + "/node.json")
			}
		}
	}

	resources := metrics.GetSystemResources()
	advertiseHost := cfg.AdvertiseHost
	if advertiseHost == "" {
		advertiseHost, _ = os.Hostname()
	}
	payload := map[string]any{
		"name": cfg.Name,
		"host": advertiseHost,
		"port": cfg.Port,
		"resources": map[string]any{
			"cpuCores":   runtime.NumCPU(),
			"ramTotalMb": resources.RAMTotalMB,
			"diskTotalGb": resources.DiskTotalGB,
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshaling registration payload: %w", err)
	}
	req, err := http.NewRequest("POST", cfg.ControllerURL+"/api/nodes/register", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("creating registration request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.Token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return "", fmt.Errorf("registration failed: HTTP %d", resp.StatusCode)
	}

	var result struct {
		NodeID string `json:"nodeId"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}

	if err := config.SaveNodeID(cfg.DataDir, result.NodeID); err != nil {
		logger.Warn("failed to persist node ID", "error", err)
	}

	logger.Info("registered with controller", "nodeId", result.NodeID)
	return result.NodeID, nil
}

func startHeartbeat(ctx context.Context, nodeID string, procMgr *process.Manager, eventBus *events.Bus, cfg *types.Config) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	sendHeartbeat := func() {
		eventBus.Emit(types.HeartbeatEvent{
			Type:      types.EventHeartbeat,
			NodeID:    nodeID,
			Timestamp: time.Now().UTC(),
			Servers:   procMgr.GetAllStatuses(),
			Resources: metrics.GetSystemResources(),
		})
	}

	sendHeartbeat()

	for {
		select {
		case <-ticker.C:
			sendHeartbeat()
		case <-ctx.Done():
			return
		}
	}
}


