package rcon

import (
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"time"
)

const (
	packetLogin   int32 = 3
	packetCommand int32 = 2

	maxPayloadSize = 4096
)

type Client struct {
	addr     string
	password string
	conn     net.Conn
	reqID    atomic.Int32
	mu       sync.Mutex
}

func NewClient(host string, port int, password string) *Client {
	return &Client{
		addr:     fmt.Sprintf("%s:%d", host, port),
		password: password,
	}
}

func (c *Client) Connect() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	conn, err := net.DialTimeout("tcp", c.addr, 5*time.Second)
	if err != nil {
		return fmt.Errorf("connecting to RCON: %w", err)
	}
	c.conn = conn

	if err := c.authenticate(); err != nil {
		conn.Close()
		c.conn = nil
		return fmt.Errorf("RCON auth failed: %w", err)
	}

	return nil
}

func (c *Client) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn != nil {
		c.conn.Close()
		c.conn = nil
	}
}

func (c *Client) Execute(command string) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn == nil {
		return "", fmt.Errorf("not connected")
	}

	id := c.reqID.Add(1)
	if err := c.sendPacket(id, packetCommand, command); err != nil {
		c.conn.Close()
		c.conn = nil
		return "", err
	}

	respID, _, payload, err := c.readPacket()
	if err != nil {
		c.conn.Close()
		c.conn = nil
		return "", err
	}
	if respID != id {
		return "", fmt.Errorf("response ID mismatch: expected %d, got %d", id, respID)
	}

	return payload, nil
}

func (c *Client) Reconnect() error {
	c.Close()
	return c.Connect()
}

func (c *Client) IsConnected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn != nil
}

func (c *Client) authenticate() error {
	id := c.reqID.Add(1)
	if err := c.sendPacket(id, packetLogin, c.password); err != nil {
		return err
	}

	respID, _, _, err := c.readPacket()
	if err != nil {
		return err
	}
	if respID == -1 {
		return fmt.Errorf("authentication failed")
	}
	return nil
}

func (c *Client) sendPacket(id, pktType int32, payload string) error {
	if len(payload) > maxPayloadSize {
		return fmt.Errorf("payload too large: %d bytes (max %d)", len(payload), maxPayloadSize)
	}

	body := make([]byte, 0, 14+len(payload))

	b := make([]byte, 4)
	binary.LittleEndian.PutUint32(b, uint32(id))
	body = append(body, b...)

	binary.LittleEndian.PutUint32(b, uint32(pktType))
	body = append(body, b...)

	body = append(body, []byte(payload)...)
	body = append(body, 0, 0)

	length := make([]byte, 4)
	binary.LittleEndian.PutUint32(length, uint32(len(body)))

	c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))

	if _, err := c.conn.Write(length); err != nil {
		return err
	}
	_, err := c.conn.Write(body)
	return err
}

func (c *Client) readPacket() (id, pktType int32, payload string, err error) {
	c.conn.SetReadDeadline(time.Now().Add(10 * time.Second))

	var length int32
	if err := binary.Read(c.conn, binary.LittleEndian, &length); err != nil {
		return 0, 0, "", err
	}

	if length < 10 || length > maxPayloadSize+10 {
		return 0, 0, "", fmt.Errorf("invalid packet length: %d", length)
	}

	data := make([]byte, length)
	if _, err := io.ReadFull(c.conn, data); err != nil {
		return 0, 0, "", err
	}

	id = int32(binary.LittleEndian.Uint32(data[0:4]))
	pktType = int32(binary.LittleEndian.Uint32(data[4:8]))
	payload = string(data[8 : length-2])

	return id, pktType, payload, nil
}
