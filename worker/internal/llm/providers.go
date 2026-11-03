package llm

// Every provider lives in this file. To add one, write a type embedding
// endpoint with a Complete method and register it in providers.

import (
	"context"
	"net/url"
	"strings"
)

type spec struct {
	keyEnv         string
	defaultModel   string
	defaultBaseURL string
	// legacy* are pre-LLM_* variable names, kept so old .env files work.
	legacyModelEnvs []string
	legacyBaseURL   string
	requiresKey     bool
	build           func(endpoint) Provider
}

// providers lists every supported provider, keyed by its LLM_PROVIDER value.
var providers = map[string]spec{
	"openai": {
		keyEnv:          "OPENAI_API_KEY",
		defaultModel:    "gpt-5.5",
		defaultBaseURL:  "https://api.openai.com/v1",
		legacyModelEnvs: []string{"OPENAI_STEP_MODEL", "OPENAI_MODEL"},
		legacyBaseURL:   "OPENAI_BASE_URL",
		requiresKey:     true,
		build:           func(e endpoint) Provider { return &openAI{e} },
	},
	"anthropic": {
		keyEnv:         "ANTHROPIC_API_KEY",
		defaultModel:   "claude-sonnet-5-5",
		defaultBaseURL: "https://api.anthropic.com/v1",
		requiresKey:    true,
		build:          func(e endpoint) Provider { return &anthropic{e} },
	},
	"gemini": {
		keyEnv:         "GEMINI_API_KEY",
		defaultBaseURL: "https://generativelanguage.googleapis.com/v1beta",
		requiresKey:    true,
		build:          func(e endpoint) Provider { return &gemini{e} },
	},
	"openai-compatible": {
		build: func(e endpoint) Provider { return &openAICompatible{e} },
	},
}

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
		map[string]string{"x-api-key": p.apiKey, "anthropic-version": "2023-06-01"},
		map[string]any{
			"model":      p.model,
			"max_tokens": 8192,
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

// gemini talks to Google's Gemini generateContent API.
type gemini struct{ endpoint }

type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts"`
}

type geminiPart struct {
	Text string `json:"text"`
}

func (p *gemini) Complete(ctx context.Context, system, user string) (string, error) {
	var body struct {
		Candidates []struct {
			Content geminiContent `json:"content"`
		} `json:"candidates"`
	}
	err := p.postJSON(ctx, p.baseURL+"/models/"+url.PathEscape(p.model)+":generateContent",
		map[string]string{"x-goog-api-key": p.apiKey},
		map[string]any{
			"systemInstruction": geminiContent{Parts: []geminiPart{{Text: system}}},
			"contents":          []geminiContent{{Role: "user", Parts: []geminiPart{{Text: user}}}},
		}, &body)
	if err != nil {
		return "", err
	}
	if len(body.Candidates) == 0 {
		return "", nil
	}

	var text strings.Builder
	for _, part := range body.Candidates[0].Content.Parts {
		text.WriteString(part.Text)
	}
	return text.String(), nil
}
