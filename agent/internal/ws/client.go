package ws

import (
	"fmt"
	"log/slog"
	"math/rand"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Client struct {
	controllerURL string
	nodeID        string
	token         string
	conn          *websocket.Conn
	mu            sync.Mutex
	logger        *slog.Logger
	onConnect     func()
	onDisconnect  func()
	stopCh        chan struct{}
}

func NewClient(controllerURL, nodeID, token string, logger *slog.Logger) *Client {
	return &Client{
		controllerURL: controllerURL,
		nodeID:        nodeID,
		token:         token,
		logger:        logger,
		stopCh:        make(chan struct{}),
	}
}

func (c *Client) OnConnect(fn func()) {
	c.onConnect = fn
}

func (c *Client) OnDisconnect(fn func()) {
	c.onDisconnect = fn
}

func (c *Client) Start() {
	go c.connectLoop()
}

func (c *Client) Stop() {
	close(c.stopCh)
	c.mu.Lock()
	if c.conn != nil {
		c.conn.Close()
	}
	c.mu.Unlock()
}

func (c *Client) Send(data []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn == nil {
		return fmt.Errorf("not connected")
	}

	return c.conn.WriteMessage(websocket.TextMessage, data)
}

func (c *Client) connectLoop() {
	backoff := time.Second

	for {
		select {
		case <-c.stopCh:
			return
		default:
		}

		if err := c.connect(); err != nil {
			c.logger.Warn("WebSocket connection failed", "error", err, "retry_in", backoff)
			select {
			case <-time.After(backoff):
			case <-c.stopCh:
				return
			}
			jitter := time.Duration(rand.Int63n(int64(backoff / 4)))
			backoff = min(backoff*2, 30*time.Second) + jitter
			continue
		}

		connectedAt := time.Now()

		if c.onConnect != nil {
			c.onConnect()
		}

		c.readLoop()

		if c.onDisconnect != nil {
			c.onDisconnect()
		}

		// Only reset backoff if connection lasted more than 5 seconds
		// (prevents rapid reconnect loop when server immediately closes)
		if time.Since(connectedAt) > 5*time.Second {
			backoff = time.Second
		} else {
			backoff = min(backoff*2, 30*time.Second)
			c.logger.Warn("connection was short-lived, increasing backoff", "retry_in", backoff)
		}

		select {
		case <-time.After(backoff):
		case <-c.stopCh:
			return
		}
	}
}

func (c *Client) connect() error {
	u, err := url.Parse(c.controllerURL)
	if err != nil {
		return err
	}

	switch u.Scheme {
	case "http":
		u.Scheme = "ws"
	case "https":
		u.Scheme = "wss"
	}
	u.Path = "/ws/agent"
	q := u.Query()
	q.Set("nodeId", c.nodeID)
	u.RawQuery = q.Encode()

	headers := make(http.Header)
	headers.Set("Authorization", "Bearer "+c.token)

	conn, _, err := websocket.DefaultDialer.Dial(u.String(), headers)
	if err != nil {
		return err
	}

	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()

	c.logger.Info("WebSocket connected to controller")
	return nil
}

func (c *Client) readLoop() {
	for {
		_, _, err := c.conn.ReadMessage()
		if err != nil {
			c.logger.Warn("WebSocket read error", "error", err)
			c.mu.Lock()
			c.conn = nil
			c.mu.Unlock()
			return
		}
	}
}
