package types

type Config struct {
	Port          int          `json:"port"`
	ControllerURL string       `json:"controllerUrl"`
	Token         string       `json:"token"`
	DataDir       string       `json:"dataDir"`
	Name          string       `json:"name"`
	AdvertiseHost string       `json:"advertiseHost"`
	MaxServers    int          `json:"maxServers"`
	LogRetention  int          `json:"logRetentionDays"`
	Metrics       MetricsCfg   `json:"metrics"`
	RCON          RCONCfg      `json:"rcon"`
}

type MetricsCfg struct {
	CollectIntervalMs int `json:"collectIntervalMs"`
}

type RCONCfg struct {
	Enabled        bool `json:"enabled"`
	PortRangeStart int  `json:"portRangeStart"`
	PortRangeEnd   int  `json:"portRangeEnd"`
}

type NodeRegistration struct {
	NodeID string `json:"nodeId"`
}
