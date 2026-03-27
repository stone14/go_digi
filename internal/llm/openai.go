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

type openaiProvider struct {
	apiURL string
	apiKey string
	model  string
}

func newOpenAI(cfg Config) *openaiProvider {
	u := cfg.APIURL
	if u == "" {
		u = "https://api.openai.com"
	}
	m := cfg.Model
	if m == "" {
		m = "gpt-4o"
	}
	return &openaiProvider{apiURL: u, apiKey: cfg.APIKey, model: m}
}

type openaiRequest struct {
	Model       string      `json:"model"`
	Messages    []openaiMsg `json:"messages"`
	Stream      bool        `json:"stream"`
	MaxTokens   int         `json:"max_tokens,omitempty"`
	Temperature *float64    `json:"temperature,omitempty"`
}

type openaiMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openaiChatResp struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

type openaiStreamChunk struct {
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
}

func (o *openaiProvider) Chat(ctx context.Context, messages []Message, opts Options) (string, error) {
	model := opts.Model
	if model == "" {
		model = o.model
	}

	reqBody := openaiRequest{
		Model:    model,
		Messages: toOpenAIMsgs(messages),
		Stream:   false,
	}
	if opts.MaxTokens > 0 {
		reqBody.MaxTokens = opts.MaxTokens
	}
	if opts.Temperature > 0 {
		reqBody.Temperature = &opts.Temperature
	}

	data, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("openai: marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, o.apiURL+"/v1/chat/completions", bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("openai: create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if o.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+o.apiKey)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("openai: do request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("openai: status %d: %s", resp.StatusCode, string(body))
	}

	var result openaiChatResp
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("openai: decode response: %w", err)
	}

	if len(result.Choices) == 0 {
		return "", fmt.Errorf("openai: empty choices")
	}

	return result.Choices[0].Message.Content, nil
}

func (o *openaiProvider) Stream(ctx context.Context, messages []Message, opts Options) (<-chan string, error) {
	model := opts.Model
	if model == "" {
		model = o.model
	}

	reqBody := openaiRequest{
		Model:    model,
		Messages: toOpenAIMsgs(messages),
		Stream:   true,
	}
	if opts.MaxTokens > 0 {
		reqBody.MaxTokens = opts.MaxTokens
	}
	if opts.Temperature > 0 {
		reqBody.Temperature = &opts.Temperature
	}

	data, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("openai: marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, o.apiURL+"/v1/chat/completions", bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("openai: create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if o.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+o.apiKey)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("openai: do request: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("openai: status %d: %s", resp.StatusCode, string(body))
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
			if payload == "[DONE]" {
				return
			}

			var chunk openaiStreamChunk
			if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
				continue
			}
			if len(chunk.Choices) > 0 && chunk.Choices[0].Delta.Content != "" {
				select {
				case ch <- chunk.Choices[0].Delta.Content:
				case <-ctx.Done():
					return
				}
			}
		}
	}()

	return ch, nil
}

func toOpenAIMsgs(msgs []Message) []openaiMsg {
	out := make([]openaiMsg, len(msgs))
	for i, m := range msgs {
		out[i] = openaiMsg{Role: m.Role, Content: m.Content}
	}
	return out
}
