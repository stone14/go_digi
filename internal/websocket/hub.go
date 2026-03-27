package websocket

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = 30 * time.Second
	maxMessageSize = 4096
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// Client는 WebSocket 연결을 관리하는 구조체입니다.
type Client struct {
	conn   *websocket.Conn
	send   chan []byte
	hub    *Hub
	topics map[string]bool
	mu     sync.RWMutex
}

// Hub는 모든 WebSocket 클라이언트를 관리합니다.
type Hub struct {
	clients    map[*Client]bool
	register   chan *Client
	unregister chan *Client
	broadcast  chan *Message
	mu         sync.RWMutex
}

// Message는 WebSocket을 통해 전송되는 메시지 구조체입니다.
type Message struct {
	Topic string      `json:"topic"`
	Type  string      `json:"type"`
	Data  interface{} `json:"data"`
}

// clientMessage는 클라이언트에서 수신하는 메시지입니다.
type clientMessage struct {
	Action string `json:"action"` // subscribe, unsubscribe
	Topic  string `json:"topic"`
}

// NewHub는 새 Hub 인스턴스를 생성합니다.
func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan *Message, 256),
	}
}

// Run은 Hub의 메인 이벤트 루프입니다. 별도 고루틴에서 실행해야 합니다.
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			slog.Info("WebSocket 클라이언트 연결", "clients", h.clientCount())

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()
			slog.Info("WebSocket 클라이언트 연결 해제", "clients", h.clientCount())

		case msg := <-h.broadcast:
			data, err := json.Marshal(msg)
			if err != nil {
				slog.Error("WebSocket 메시지 직렬화 실패", "error", err)
				continue
			}

			h.mu.RLock()
			for client := range h.clients {
				if client.isSubscribed(msg.Topic) {
					select {
					case client.send <- data:
					default:
						// 버퍼가 가득 차면 클라이언트 제거
						go func(c *Client) {
							h.unregister <- c
						}(client)
					}
				}
			}
			h.mu.RUnlock()
		}
	}
}

// Broadcast는 구독 중인 모든 클라이언트에 메시지를 전송합니다.
func (h *Hub) Broadcast(msg *Message) {
	select {
	case h.broadcast <- msg:
	default:
		slog.Warn("WebSocket broadcast 채널 가득 참, 메시지 드롭")
	}
}

// HandleWS는 HTTP를 WebSocket으로 업그레이드하고 클라이언트를 등록합니다.
func (h *Hub) HandleWS(c echo.Context) error {
	conn, err := upgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		slog.Error("WebSocket 업그레이드 실패", "error", err)
		return err
	}

	client := &Client{
		conn:   conn,
		send:   make(chan []byte, 256),
		hub:    h,
		topics: make(map[string]bool),
	}

	h.register <- client

	go client.writePump()
	go client.readPump()

	return nil
}

// clientCount는 현재 연결된 클라이언트 수를 반환합니다.
func (h *Hub) clientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// readPump은 클라이언트로부터 메시지를 수신합니다.
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				slog.Warn("WebSocket 비정상 종료", "error", err)
			}
			return
		}

		var msg clientMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			slog.Warn("WebSocket 메시지 파싱 실패", "error", err)
			continue
		}

		switch msg.Action {
		case "subscribe":
			c.subscribe(msg.Topic)
			slog.Debug("WebSocket 토픽 구독", "topic", msg.Topic)
		case "unsubscribe":
			c.unsubscribe(msg.Topic)
			slog.Debug("WebSocket 토픽 구독 해제", "topic", msg.Topic)
		default:
			slog.Warn("WebSocket 알 수 없는 액션", "action", msg.Action)
		}
	}
}

// writePump은 send 채널의 메시지를 WebSocket 연결로 전송합니다.
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				slog.Warn("WebSocket 메시지 전송 실패", "error", err)
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// subscribe는 토픽을 구독합니다.
func (c *Client) subscribe(topic string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.topics[topic] = true
}

// unsubscribe는 토픽 구독을 해제합니다.
func (c *Client) unsubscribe(topic string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.topics, topic)
}

// isSubscribed는 클라이언트가 해당 토픽을 구독 중인지 확인합니다.
// "metrics:123" 토픽은 "metrics:123" 구독과 매칭됩니다.
// "alerts" 토픽은 "alerts" 구독과 매칭됩니다.
func (c *Client) isSubscribed(topic string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()

	// 정확히 매칭
	if c.topics[topic] {
		return true
	}

	// "metrics:123" → 클라이언트가 "metrics" 전체를 구독한 경우
	if idx := strings.Index(topic, ":"); idx > 0 {
		prefix := topic[:idx]
		if c.topics[prefix] {
			return true
		}
	}

	return false
}
