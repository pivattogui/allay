package events

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
)

type SendFunc func(data []byte) error

const maxBufferSize = 10000

type Bus struct {
	sendFn  SendFunc
	buffer  []json.RawMessage
	mu      sync.Mutex
	logger  *slog.Logger
	dataDir string
}

func NewBus(dataDir string, logger *slog.Logger) *Bus {
	b := &Bus{
		dataDir: dataDir,
		logger:  logger,
	}
	b.loadBuffer()
	return b
}

func (b *Bus) SetSender(fn SendFunc) {
	b.mu.Lock()
	b.sendFn = fn
	b.mu.Unlock()

	b.flush()
}

func (b *Bus) Emit(event any) {
	data, err := json.Marshal(event)
	if err != nil {
		b.logger.Error("failed to marshal event", "error", err)
		return
	}

	b.mu.Lock()
	fn := b.sendFn
	if fn == nil {
		if len(b.buffer) >= maxBufferSize {
			b.buffer = b.buffer[1:]
		}
		b.buffer = append(b.buffer, data)
		b.mu.Unlock()
		b.persistBuffer()
		return
	}
	b.mu.Unlock()

	if err := fn(data); err != nil {
		b.mu.Lock()
		if len(b.buffer) >= maxBufferSize {
			b.buffer = b.buffer[1:]
		}
		b.buffer = append(b.buffer, data)
		b.mu.Unlock()
		b.persistBuffer()
	}
}

func (b *Bus) flush() {
	b.mu.Lock()
	if b.sendFn == nil || len(b.buffer) == 0 {
		b.mu.Unlock()
		return
	}

	pending := make([]json.RawMessage, len(b.buffer))
	copy(pending, b.buffer)
	b.buffer = nil
	fn := b.sendFn
	b.mu.Unlock()

	b.logger.Info("flushing buffered events", "count", len(pending))

	for i, data := range pending {
		if err := fn(data); err != nil {
			// Stop on first error, re-buffer remaining events in order
			b.mu.Lock()
			remaining := make([]json.RawMessage, 0, len(pending)-i+len(b.buffer))
			remaining = append(remaining, pending[i:]...)
			remaining = append(remaining, b.buffer...)
			b.buffer = remaining
			b.mu.Unlock()
			break
		}
	}

	b.persistBuffer()
}

func (b *Bus) bufferPath() string {
	return filepath.Join(b.dataDir, "event_buffer.json")
}

func (b *Bus) persistBuffer() {
	b.mu.Lock()
	defer b.mu.Unlock()

	if len(b.buffer) == 0 {
		os.Remove(b.bufferPath())
		return
	}

	data, err := json.Marshal(b.buffer)
	if err != nil {
		b.logger.Error("failed to marshal event buffer", "error", err)
		return
	}
	if err := os.WriteFile(b.bufferPath(), data, 0644); err != nil {
		b.logger.Error("failed to persist event buffer", "error", err)
	}
}

func (b *Bus) loadBuffer() {
	data, err := os.ReadFile(b.bufferPath())
	if err != nil {
		return
	}

	var buf []json.RawMessage
	if json.Unmarshal(data, &buf) == nil {
		b.buffer = buf
		b.logger.Info("loaded buffered events from disk", "count", len(buf))
	}
}
