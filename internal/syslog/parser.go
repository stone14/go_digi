package syslog

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ParsedMessage holds the fields extracted from a raw syslog line.
type ParsedMessage struct {
	Facility  int
	Severity  int
	Timestamp time.Time
	Hostname  string
	Program   string
	Message   string
	Raw       string
}

// rfc3164 example: <34>Oct 11 22:14:15 mymachine su: 'su root' failed
// rfc5424 example: <165>1 2003-10-11T22:14:15.003Z mymachine evntslog - ID47 ...

var (
	rfc5424Re = regexp.MustCompile(`^<(\d+)>(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)`)
	rfc3164Re = regexp.MustCompile(`^<(\d+)>(.{15})\s+(\S+)\s+(\S+?)(?:\[(\d+)\])?:\s*(.*)`)
)

// Parse tries RFC5424 first, then falls back to RFC3164.
func Parse(raw string) (*ParsedMessage, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, fmt.Errorf("syslog: empty message")
	}

	// Try RFC5424
	if m := rfc5424Re.FindStringSubmatch(raw); m != nil {
		pri, _ := strconv.Atoi(m[1])
		facility := pri / 8
		severity := pri % 8

		ts, err := time.Parse(time.RFC3339Nano, m[3])
		if err != nil {
			ts = time.Now()
		}

		return &ParsedMessage{
			Facility:  facility,
			Severity:  severity,
			Timestamp: ts,
			Hostname:  m[4],
			Program:   m[5],
			Message:   m[8],
			Raw:       raw,
		}, nil
	}

	// Try RFC3164
	if m := rfc3164Re.FindStringSubmatch(raw); m != nil {
		pri, _ := strconv.Atoi(m[1])
		facility := pri / 8
		severity := pri % 8

		// RFC3164 timestamp: "Oct 11 22:14:15" — assume current year
		tsStr := m[2]
		ts, err := time.Parse("Jan  2 15:04:05", tsStr)
		if err != nil {
			ts, err = time.Parse("Jan 2 15:04:05", tsStr)
		}
		if err != nil {
			ts = time.Now()
		} else {
			ts = ts.AddDate(time.Now().Year(), 0, 0)
		}

		return &ParsedMessage{
			Facility:  facility,
			Severity:  severity,
			Timestamp: ts,
			Hostname:  m[3],
			Program:   m[4],
			Message:   m[6],
			Raw:       raw,
		}, nil
	}

	return nil, fmt.Errorf("syslog: unrecognised format")
}

// ParsePattern represents a row from syslog_parse_patterns.
type ParsePattern struct {
	ID            int
	Name          string
	Pattern       string
	EventType     string
	ExtractFields []string
	compiled      *regexp.Regexp
}

// EventParser classifies syslog messages using regex patterns from the DB.
type EventParser struct {
	patterns []ParsePattern
}

// NewEventParser loads patterns from syslog_parse_patterns and compiles them.
func NewEventParser(pool *pgxpool.Pool) *EventParser {
	ep := &EventParser{}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	rows, err := pool.Query(ctx,
		`SELECT id, name, pattern, event_type, extract_fields
		 FROM syslog_parse_patterns WHERE is_active = true ORDER BY id`)
	if err != nil {
		return ep
	}
	defer rows.Close()

	for rows.Next() {
		var p ParsePattern
		var fields *string
		if err := rows.Scan(&p.ID, &p.Name, &p.Pattern, &p.EventType, &fields); err != nil {
			continue
		}
		re, err := regexp.Compile(p.Pattern)
		if err != nil {
			continue
		}
		p.compiled = re
		if fields != nil && *fields != "" {
			p.ExtractFields = strings.Split(*fields, ",")
			for i := range p.ExtractFields {
				p.ExtractFields[i] = strings.TrimSpace(p.ExtractFields[i])
			}
		}
		ep.patterns = append(ep.patterns, p)
	}

	return ep
}

// Classify matches the message against loaded patterns and returns
// the event type and any extracted data from named capture groups.
func (ep *EventParser) Classify(msg *ParsedMessage) (string, map[string]interface{}) {
	if msg == nil {
		return "", nil
	}

	for _, p := range ep.patterns {
		if p.compiled == nil {
			continue
		}
		match := p.compiled.FindStringSubmatch(msg.Message)
		if match == nil {
			continue
		}

		data := map[string]interface{}{}
		names := p.compiled.SubexpNames()
		for i, name := range names {
			if i == 0 || name == "" {
				continue
			}
			if i < len(match) {
				data[name] = match[i]
			}
		}

		return p.EventType, data
	}

	return "", nil
}
