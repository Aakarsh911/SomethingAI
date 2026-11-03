package llm

import (
	"context"
	"strings"
)

// openAI talks to OpenAI's Responses API.
type openAI struct{ endpoint }

func (p *openAI) Complete(ctx context.Context, system, user string) (string, error) {
	var body struct {
		Output []struct {
			Type    string `json:"type"`
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		} `json:"output"`
	}
	err := p.postJSON(ctx, p.baseURL+"/responses",
		map[string]string{"Authorization": "Bearer " + p.apiKey},
		map[string]any{
			"model": p.model,
			"input": []map[string]string{
				{"role": "system", "content": system},
				{"role": "user", "content": user},
			},
		}, &body)
	if err != nil {
		return "", err
	}

	// The SDKs' output_text, by hand: every text part of every message.
	var text strings.Builder
	for _, item := range body.Output {
		if item.Type != "message" {
			continue
		}
		for _, part := range item.Content {
			if part.Type == "output_text" {
				text.WriteString(part.Text)
			}
		}
	}
	return text.String(), nil
}

// openAICompatible talks to any server that speaks the Chat Completions API:
// OpenRouter, Groq, Together, DeepSeek, vLLM, Ollama and the like.
type openAICompatible struct{ endpoint }

func (p *openAICompatible) Complete(ctx context.Context, system, user string) (string, error) {
	headers := map[string]string{}
	// Local servers often take no key.
	if p.apiKey != "" {
		headers["Authorization"] = "Bearer " + p.apiKey
	}

	var body struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	err := p.postJSON(ctx, p.baseURL+"/chat/completions", headers,
		map[string]any{
			"model": p.model,
			"messages": []map[string]string{
				{"role": "system", "content": system},
				{"role": "user", "content": user},
			},
		}, &body)
	if err != nil {
		return "", err
	}
	if len(body.Choices) == 0 {
		return "", nil
	}
	return body.Choices[0].Message.Content, nil
}
