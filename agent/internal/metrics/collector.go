package metrics

import (
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/allaymc/agent/internal/process"
	"github.com/allaymc/agent/internal/rcon"
	"github.com/allaymc/agent/pkg/types"
	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/mem"
	gopsProcess "github.com/shirou/gopsutil/v4/process"
)

type EventCallback func(event any)

type Collector struct {
	procMgr    *process.Manager
	rconMgr    *rcon.Manager
	interval   time.Duration
	onEvent    EventCallback
	logger     *slog.Logger
	stopCh     chan struct{}
	stopOnce   sync.Once
}

func NewCollector(
	procMgr *process.Manager,
	rconMgr *rcon.Manager,
	intervalMs int,
	logger *slog.Logger,
	onEvent EventCallback,
) *Collector {
	return &Collector{
		procMgr:  procMgr,
		rconMgr:  rconMgr,
		interval: time.Duration(intervalMs) * time.Millisecond,
		onEvent:  onEvent,
		logger:   logger,
		stopCh:   make(chan struct{}),
	}
}

func (c *Collector) Start() {
	// Prime CPU measurement
	cpu.Percent(0, false)

	ticker := time.NewTicker(c.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			c.collect()
		case <-c.stopCh:
			return
		}
	}
}

func (c *Collector) Stop() {
	c.stopOnce.Do(func() { close(c.stopCh) })
}

func (c *Collector) collect() {
	statuses := c.procMgr.GetAllStatuses()

	for serverID, state := range statuses {
		if state != string(types.StateRunning) {
			continue
		}

		status, err := c.procMgr.GetStatus(serverID)
		if err != nil || status.PID == 0 {
			continue
		}

		proc, err := gopsProcess.NewProcess(int32(status.PID))
		if err != nil {
			continue
		}

		cpuPct, _ := proc.CPUPercent()
		memInfo, _ := proc.MemoryInfo()

		var ramUsed int64
		if memInfo != nil {
			ramUsed = int64(memInfo.RSS / 1024 / 1024)
		}

		playerCount, playerMax := c.getPlayerCount(serverID)

		c.onEvent(types.MetricsEvent{
			Type:        types.EventMetrics,
			ServerID:    serverID,
			Timestamp:   time.Now().UTC(),
			CPUPercent:  cpuPct,
			RAMUsedMB:   ramUsed,
			RAMMaxMB:    0,
			PlayerCount: playerCount,
			PlayerMax:   playerMax,
		})
	}
}

func (c *Collector) getPlayerCount(serverID string) (count, max int) {
	if c.rconMgr == nil {
		return 0, 0
	}

	resp, err := c.rconMgr.Execute(serverID, "list")
	if err != nil {
		return 0, 0
	}

	return parsePlayerList(resp)
}

func parsePlayerList(resp string) (count, max int) {
	// "There are X of a max of Y players online: ..."
	parts := strings.SplitN(resp, " of a max of ", 2)
	if len(parts) != 2 {
		return 0, 0
	}

	countStr := strings.TrimPrefix(parts[0], "There are ")
	countStr = strings.TrimSpace(countStr)
	count, _ = strconv.Atoi(countStr)

	maxParts := strings.SplitN(parts[1], " ", 2)
	if len(maxParts) > 0 {
		max, _ = strconv.Atoi(maxParts[0])
	}

	return count, max
}

func GetSystemResources() types.SystemResources {
	var res types.SystemResources

	cpuPcts, err := cpu.Percent(0, false)
	if err == nil && len(cpuPcts) > 0 {
		res.CPUPercent = cpuPcts[0]
	}

	memStat, err := mem.VirtualMemory()
	if err == nil {
		res.RAMTotalMB = int64(memStat.Total / 1024 / 1024)
		res.RAMUsedMB = int64(memStat.Used / 1024 / 1024)
	}

	diskStat, err := disk.Usage("/")
	if err == nil {
		res.DiskTotalGB = int64(diskStat.Total / 1024 / 1024 / 1024)
		res.DiskUsedGB = int64(diskStat.Used / 1024 / 1024 / 1024)
	}

	return res
}
