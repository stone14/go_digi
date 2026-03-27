package llm

import "context"

// Result holds the outcome of a pooled LLM call.
type Result struct {
	Text string
	Err  error
}

// Pool limits concurrent LLM calls using a semaphore channel.
type Pool struct {
	provider Provider
	workers  int
	sem      chan struct{}
}

// NewPool creates a worker pool that limits concurrency to workers.
func NewPool(provider Provider, workers int) *Pool {
	if workers <= 0 {
		workers = 1
	}
	return &Pool{
		provider: provider,
		workers:  workers,
		sem:      make(chan struct{}, workers),
	}
}

// Submit sends a chat request to the pool and returns a channel
// that will receive exactly one Result.
func (p *Pool) Submit(ctx context.Context, messages []Message, opts Options) <-chan Result {
	ch := make(chan Result, 1)

	go func() {
		defer close(ch)

		// Acquire semaphore slot.
		select {
		case p.sem <- struct{}{}:
		case <-ctx.Done():
			ch <- Result{Err: ctx.Err()}
			return
		}
		defer func() { <-p.sem }()

		text, err := p.provider.Chat(ctx, messages, opts)
		ch <- Result{Text: text, Err: err}
	}()

	return ch
}
