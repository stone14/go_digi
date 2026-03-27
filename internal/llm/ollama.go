package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

type ollamaProvider struct {
	apiURL string
	model  string
}

func newOllama(cfg Config) *ollamaProvider {
	u := cfg.APIURL
	if u == "" {
		u = "http://localhost:11434"
	}
	m := cfg.Model
	if m == "" {
		m = "llama3"
	}
	return &ollamaProvider{apiURL: u, model: m}
}

// ollamaRequest is the POST body for /api/chat.
type ollamaRequest struct {
	Model    string        `json:"model"`
	Messages []ollamaMsg   `json:"messages"`
	Stream   bool          `json:"stream"`
	Options  *ollamaOpts   `json:"options,omitempty"`
}

type ollamaMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ollamaOpts struct {
	Temperature float64 `json:"temperature,omitempty"`
	NumPredict  int     `json:"num_predict,omitempty"`
}

type ollamaChatResp struct {
	Message struct {
		Content string `json:"content"`
	} `json:"message"`
	Done bool `json:"done"`
}

func (o *ollamaProvider) Chat(ctx context.Context, messages []Message, opts Options) (string, error) {
	model := opts.Model
	if model == "" {
		model = o.model
	}

	reqBody := ollamaRequest{
		Model:    model,
		Messages: toOllamaMsgs(messages),
		Stream:   false,
	}
	if opts.Temperature > 0 || opts.MaxTokens > 0 {
		reqBody.Options = &ollamaOpts{
			Temperature: opts.Temperature,
			NumPredict:  opts.MaxTokens,
		}
	}

	data, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("ollama: marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, o.apiURL+"/api/chat", bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("ollama: create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("ollama: do request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("ollama: status %d: %s", resp.StatusCode, string(body))
	}

	var result ollamaChatResp
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("ollama: decode response: %w", err)
	}

	return result.Message.Content, nil
}

func (o *ollamaProvider) Stream(ctx context.Context, messages []Message, opts Options) (<-chan string, error) {
	model := opts.Model
	if model == "" {
		model = o.model
	}

	reqBody := ollamaRequest{
		Model:    model,
		Messages: toOllamaMsgs(messages),
		Stream:   true,
	}
	if opts.Temperature > 0 || opts.MaxTokens > 0 {
		reqBody.Options = &ollamaOpts{
			Temperature: opts.Temperature,
			NumPredict:  opts.MaxTokens,
		}
	}

	data, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("ollama: marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, o.apiURL+"/api/chat", bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("ollama: create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ollama: do request: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("ollama: status %d: %s", resp.StatusCode, string(body))
	}

	ch := make(chan string, 64)
	go func() {
		defer resp.Body.Close()
		defer close(ch)

		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			line := scanner.Bytes()
			if len(line) == 0 {
				continue
			}
			var chunk ollamaChatResp
			if err := json.Unmarshal(line, &chunk); err != nil {
				continue
			}
			if chunk.Message.Content != "" {
				select {
				case ch <- chunk.Message.Content:
				case <-ctx.Done():
					return
				}
			}
			if chunk.Done {
				return
			}
		}
	}()

	return ch, nil
}

func toOllamaMsgs(msgs []Message) []ollamaMsg {
	out := make([]ollamaMsg, len(msgs))
	for i, m := range msgs {
		out[i] = ollamaMsg{Role: m.Role, Content: m.Content}
	}
	return out
}
