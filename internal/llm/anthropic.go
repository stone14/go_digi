package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type anthropicProvider struct {
	apiURL string
	apiKey string
	model  string
}

func newAnthropic(cfg Config) *anthropicProvider {
	u := cfg.APIURL
	if u == "" {
		u = "https://api.anthropic.com"
	}
	m := cfg.Model
	if m == "" {
		m = "claude-sonnet-4-20250514"
	}
	return &anthropicProvider{apiURL: u, apiKey: cfg.APIKey, model: m}
}

type anthropicRequest struct {
	Model     string         `json:"model"`
	Messages  []anthropicMsg `json:"messages"`
	MaxTokens int            `json:"max_tokens"`
	Stream    bool           `json:"stream,omitempty"`
	System    string         `json:"system,omitempty"`
}

type anthropicMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type anthropicChatResp struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
}

type anthropicStreamEvent struct {
	Type  string `json:"type"`
	Delta struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"delta,omitempty"`
}

func (a *anthropicProvider) Chat(ctx context.Context, messages []Message, opts Options) (string, error) {
	model := opts.Model
	if model == "" {
		model = a.model
	}
	maxTokens := opts.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 4096
	}

	system, msgs := splitAnthropicSystem(messages)

	reqBody := anthropicRequest{
		Model:     model,
		Messages:  msgs,
		MaxTokens: maxTokens,
		System:    system,
	}

	data, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("anthropic: marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.apiURL+"/v1/messages", bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("anthropic: create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", a.apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("anthropic: do request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("anthropic: status %d: %s", resp.StatusCode, string(body))
	}

	var result anthropicChatResp
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("anthropic: decode response: %w", err)
	}

	if len(result.Content) == 0 {
		return "", fmt.Errorf("anthropic: empty content")
	}

	return result.Content[0].Text, nil
}

func (a *anthropicProvider) Stream(ctx context.Context, messages []Message, opts Options) (<-chan string, error) {
	model := opts.Model
	if model == "" {
		model = a.model
	}
	maxTokens := opts.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 4096
	}

	system, msgs := splitAnthropicSystem(messages)

	reqBody := anthropicRequest{
		Model:     model,
		Messages:  msgs,
		MaxTokens: maxTokens,
		Stream:    true,
		System:    system,
	}

	data, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("anthropic: marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.apiURL+"/v1/messages", bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("anthropic: create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", a.apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("anthropic: do request: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("anthropic: status %d: %s", resp.StatusCode, string(body))
	}

	ch := make(chan string, 64)
	go func() {
		defer resp.Body.Close()
		defer close(ch)

		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			line := scanner.Text()
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			payload := strings.TrimPrefix(line, "data: ")

			var event anthropicStreamEvent
			if err := json.Unmarshal([]byte(payload), &event); err != nil {
				continue
			}

			switch event.Type {
			case "content_block_delta":
				if event.Delta.Text != "" {
					select {
					case ch <- event.Delta.Text:
					case <-ctx.Done():
						return
					}
				}
			case "message_stop":
				return
			}
		}
	}()

	return ch, nil
}

// splitAnthropicSystem extracts the system message (if any) from the list
// and returns the remaining messages in Anthropic format.
func splitAnthropicSystem(messages []Message) (string, []anthropicMsg) {
	var system string
	var out []anthropicMsg
	for _, m := range messages {
		if m.Role == "system" {
			system = m.Content
			continue
		}
		out = append(out, anthropicMsg{Role: m.Role, Content: m.Content})
	}
	return system, out
}
