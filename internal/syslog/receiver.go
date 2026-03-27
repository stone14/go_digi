package syslog

import (
	"context"
	"encoding/json"
	"log/slog"
	"net"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// syslogEntry is an internal struct for the DB write channel.
type syslogEntry struct {
	AssetID   *int
	Facility  int
	Severity  int
	Timestamp time.Time
	Hostname  string
	Program   string
	Message   string
	Raw       string
	EventType string
	ParsedData map[string]interface{}
}

// Receiver listens for UDP syslog messages and persists them.
type Receiver struct {
	pool   *pgxpool.Pool
	addr   string
	conn   *net.UDPConn
	parser *EventParser
}

// NewReceiver creates a Receiver that writes to pool and listens on addr.
func NewReceiver(pool *pgxpool.Pool, addr string) *Receiver {
	if addr == "" {
		addr = ":5140"
	}
	return &Receiver{
		pool: pool,
		addr: addr,
	}
}

// Start begins listening for UDP syslog messages.
// It blocks until ctx is cancelled or Stop is called.
func (r *Receiver) Start(ctx context.Context) error {
	// Load parse patterns from DB.
	r.parser = NewEventParser(r.pool)

	udpAddr, err := net.ResolveUDPAddr("udp", r.addr)
	if err != nil {
		return err
	}

	r.conn, err = net.ListenUDP("udp", udpAddr)
	if err != nil {
		return err
	}

	slog.Info("syslog receiver started", "addr", r.addr)

	// Buffered channel for async DB writes.
	entryCh := make(chan syslogEntry, 1024)
	defer close(entryCh)

	// Writer goroutine.
	go r.writer(ctx, entryCh)

	buf := make([]byte, 65536)
	for {
		select {
		case <-ctx.Done():
			slog.Info("syslog receiver stopping (context cancelled)")
			return r.conn.Close()
		default:
		}

		r.conn.SetReadDeadline(time.Now().Add(1 * time.Second))
		n, _, err := r.conn.ReadFromUDP(buf)
		if err != nil {
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				continue
			}
			// Connection closed (Stop was called).
			if r.conn == nil {
				return nil
			}
			slog.Error("syslog: read error", "error", err)
			continue
		}

		raw := string(buf[:n])

		parsed, err := Parse(raw)
		if err != nil {
			slog.Warn("syslog: parse error", "error", err, "raw", raw)
			continue
		}

		// Classify the message.
		eventType, parsedData := r.parser.Classify(parsed)

		// Resolve hostname to asset_id.
		assetID := r.resolveAsset(ctx, parsed.Hostname)

		entry := syslogEntry{
			AssetID:    assetID,
			Facility:   parsed.Facility,
			Severity:   parsed.Severity,
			Timestamp:  parsed.Timestamp,
			Hostname:   parsed.Hostname,
			Program:    parsed.Program,
			Message:    parsed.Message,
			Raw:        parsed.Raw,
			EventType:  eventType,
			ParsedData: parsedData,
		}

		select {
		case entryCh <- entry:
		default:
			slog.Warn("syslog: write channel full, dropping message")
		}
	}
}

// Stop closes the UDP connection.
func (r *Receiver) Stop() error {
	if r.conn != nil {
		slog.Info("syslog receiver stopping")
		err := r.conn.Close()
		r.conn = nil
		return err
	}
	return nil
}

// writer drains the entry channel and writes rows to DB.
func (r *Receiver) writer(ctx context.Context, ch <-chan syslogEntry) {
	for {
		select {
		case <-ctx.Done():
			return
		case entry, ok := <-ch:
			if !ok {
				return
			}
			r.writeEntry(ctx, entry)
		}
	}
}

func (r *Receiver) writeEntry(ctx context.Context, e syslogEntry) {
	writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	var parsedJSON []byte
	if len(e.ParsedData) > 0 {
		parsedJSON, _ = json.Marshal(e.ParsedData)
	}

	_, err := r.pool.Exec(writeCtx,
		`INSERT INTO syslog_entries
		 (asset_id, facility, severity, received_at, hostname, program, message, raw, event_type, parsed_data)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULLIF($9,''), $10)`,
		e.AssetID, e.Facility, e.Severity, e.Timestamp,
		e.Hostname, e.Program, e.Message, e.Raw,
		e.EventType, parsedJSON)
	if err != nil {
		slog.Error("syslog: db write error", "error", err, "hostname", e.Hostname)
	}
}

// resolveAsset looks up the assets table by hostname or ip_address.
func (r *Receiver) resolveAsset(ctx context.Context, hostname string) *int {
	if hostname == "" || hostname == "-" {
		return nil
	}

	lookupCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	var id int
	err := r.pool.QueryRow(lookupCtx,
		`SELECT id FROM assets
		 WHERE is_active = true
		   AND (hostname = $1 OR ip_address::text = $1)
		 LIMIT 1`, hostname).Scan(&id)
	if err != nil {
		return nil
	}
	return &id
}
