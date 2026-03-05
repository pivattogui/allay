package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"

	"github.com/allaymc/agent/pkg/types"
)

func Load(path string) (*types.Config, error) {
	cfg := &types.Config{
		Port:         4000,
		DataDir:      "./data",
		MaxServers:   10,
		LogRetention: 7,
		Metrics: types.MetricsCfg{
			CollectIntervalMs: 5000,
		},
		RCON: types.RCONCfg{
			Enabled:        true,
			PortRangeStart: 25600,
			PortRangeEnd:   25700,
		},
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			return nil, fmt.Errorf("reading config file: %w", err)
		}
	} else {
		if err := json.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("parsing config file: %w", err)
		}
	}

	applyEnvOverrides(cfg)

	if err := validate(cfg); err != nil {
		return nil, err
	}

	return cfg, nil
}

func validate(cfg *types.Config) error {
	if cfg.Token == "" {
		return fmt.Errorf("token is required (set AGENT_TOKEN or config.json token field)")
	}
	if cfg.Port <= 0 || cfg.Port > 65535 {
		return fmt.Errorf("invalid port: %d", cfg.Port)
	}
	if cfg.Metrics.CollectIntervalMs <= 0 {
		return fmt.Errorf("metrics.collectIntervalMs must be positive")
	}
	if cfg.RCON.Enabled && cfg.RCON.PortRangeStart > cfg.RCON.PortRangeEnd {
		return fmt.Errorf("rcon.portRangeStart (%d) must be <= portRangeEnd (%d)", cfg.RCON.PortRangeStart, cfg.RCON.PortRangeEnd)
	}
	return nil
}

func applyEnvOverrides(cfg *types.Config) {
	if v := os.Getenv("AGENT_PORT"); v != "" {
		if port, err := strconv.Atoi(v); err == nil {
			cfg.Port = port
		} else {
			fmt.Fprintf(os.Stderr, "warning: invalid AGENT_PORT value %q, ignoring\n", v)
		}
	}
	if v := os.Getenv("CONTROLLER_URL"); v != "" {
		cfg.ControllerURL = v
	}
	if v := os.Getenv("AGENT_TOKEN"); v != "" {
		cfg.Token = v
	}
	if v := os.Getenv("DATA_DIR"); v != "" {
		cfg.DataDir = v
	}
	if v := os.Getenv("AGENT_NAME"); v != "" {
		cfg.Name = v
	}
	if v := os.Getenv("AGENT_HOST"); v != "" {
		cfg.AdvertiseHost = v
	}
}

func LoadNodeID(dataDir string) (string, error) {
	path := dataDir + "/node.json"
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}

	var reg types.NodeRegistration
	if err := json.Unmarshal(data, &reg); err != nil {
		return "", err
	}
	return reg.NodeID, nil
}

func SaveNodeID(dataDir, nodeID string) error {
	path := dataDir + "/node.json"
	data, err := json.MarshalIndent(types.NodeRegistration{NodeID: nodeID}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}
