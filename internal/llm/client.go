package llm

import "context"

// Provider defines the interface for LLM backends.
type Provider interface {
	Chat(ctx context.Context, messages []Message, opts Options) (string, error)
	Stream(ctx context.Context, messages []Message, opts Options) (<-chan string, error)
}

// Message represents a single chat message.
type Message struct {
	Role    string `json:"role"`    // system, user, assistant
	Content string `json:"content"`
}

// Options holds per-request LLM parameters.
type Options struct {
	Model       string  `json:"model,omitempty"`
	MaxTokens   int     `json:"max_tokens,omitempty"`
	Temperature float64 `json:"temperature,omitempty"`
}

// Config holds connection details for an LLM provider.
type Config struct {
	Provider string // ollama, openai, anthropic
	APIURL   string
	APIKey   string
	Model    string
}

// NewProvider returns a Provider implementation based on cfg.Provider.
// Returns nil if the provider name is unrecognised.
func NewProvider(cfg Config) Provider {
	switch cfg.Provider {
	case "ollama":
		return newOllama(cfg)
	case "openai":
		return newOpenAI(cfg)
	case "anthropic":
		return newAnthropic(cfg)
	default:
		return nil
	}
}
