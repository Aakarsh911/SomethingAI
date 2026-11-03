package llm

import (
	"context"
	"strings"
)

const (
	anthropicVersion   = "2023-06-01"
	anthropicMaxTokens = 8192
)

// anthropic talks to Anthropic's Messages API.
type anthropic struct{ endpoint }

func (p *anthropic) Complete(ctx context.Context, system, user string) (string, error) {
	var body struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	err := p.postJSON(ctx, p.baseURL+"/messages",
		map[string]string{"x-api-key": p.apiKey, "anthropic-version": anthropicVersion},
		map[string]any{
			"model":      p.model,
			"max_tokens": anthropicMaxTokens,
			"system":     system,
			"messages":   []map[string]string{{"role": "user", "content": user}},
		}, &body)
	if err != nil {
		return "", err
	}

	var text strings.Builder
	for _, block := range body.Content {
		if block.Type == "text" {
			text.WriteString(block.Text)
		}
	}
	return text.String(), nil
}
