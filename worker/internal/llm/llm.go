// Package llm runs `llm` workflow steps against a configurable model provider.
package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"unicode/utf8"
)

const systemPrompt = "You transform data inside an automation workflow. Follow the instruction exactly and reply with the result only — no preamble, no commentary, no markdown fences."

// maxInputChars caps the previous step's output sent to the model; a Gmail
// fetch is far larger than a summary needs.
const maxInputChars = 100_000

// Provider sends one system and user message to a model and returns its reply.
type Provider interface {
	Complete(ctx context.Context, system, user string) (string, error)
}

// Config picks and configures a provider.
type Config struct {
	Provider string
	APIKey   string
	BaseURL  string
	Model    string
}

// endpoint holds what every HTTP provider needs.
type endpoint struct {
	name    string
	apiKey  string
	baseURL string
	model   string
	http    *http.Client
}

// ConfigFromEnv reads LLM_PROVIDER (default "openai"), LLM_API_KEY,
// LLM_STEP_MODEL or LLM_MODEL, and LLM_BASE_URL, falling back to the
// provider's own variables.
func ConfigFromEnv(getenv func(string) string) Config {
	name := strings.ToLower(strings.TrimSpace(firstNonEmpty(getenv("LLM_PROVIDER"), "openai")))
	s := providers[name]

	key := getenv("LLM_API_KEY")
	if key == "" && s.keyEnv != "" {
		key = getenv(s.keyEnv)
	}

	model := firstNonEmpty(getenv("LLM_STEP_MODEL"), getenv("LLM_MODEL"))
	for _, env := range s.legacyModelEnvs {
		model = firstNonEmpty(model, getenv(env))
	}

	baseURL := getenv("LLM_BASE_URL")
	if baseURL == "" && s.legacyBaseURL != "" {
		baseURL = getenv(s.legacyBaseURL)
	}

	return Config{Provider: name, APIKey: key, BaseURL: baseURL, Model: model}
}

// Client runs workflow steps through a Provider.
type Client struct {
	provider Provider
	name     string
	model    string
	// unusable is returned by every call when the config is incomplete; the
	// worker still runs tool-only workflows.
	unusable error
}

// New builds a Client. It fails only for an unknown provider; a missing key
// or model is reported when a model step runs.
func New(cfg Config) (*Client, error) {
	s, ok := providers[cfg.Provider]
	if !ok {
		return nil, fmt.Errorf("unknown LLM_PROVIDER %q; use one of: %s", cfg.Provider, strings.Join(names(), ", "))
	}

	c := &Client{name: cfg.Provider, model: firstNonEmpty(cfg.Model, s.defaultModel)}
	baseURL := strings.TrimRight(firstNonEmpty(cfg.BaseURL, s.defaultBaseURL), "/")

	switch {
	case s.requiresKey && cfg.APIKey == "":
		c.unusable = fmt.Errorf("LLM_API_KEY (or %s) is not set, so model steps cannot run.", s.keyEnv)
	case c.model == "":
		c.unusable = fmt.Errorf("LLM_MODEL is not set and %s has no default, so model steps cannot run.", cfg.Provider)
	case baseURL == "":
		c.unusable = fmt.Errorf("LLM_BASE_URL is required for %s, so model steps cannot run.", cfg.Provider)
	}

	c.provider = s.build(endpoint{
		name:    cfg.Provider,
		apiKey:  cfg.APIKey,
		baseURL: baseURL,
		model:   c.model,
		http:    &http.Client{},
	})
	return c, nil
}

func (c *Client) Provider() string { return c.name }
func (c *Client) Model() string    { return c.model }

// Transform applies instruction to input (the previous step's output, as
// text) and returns the model's reply.
func (c *Client) Transform(ctx context.Context, instruction, input string) (string, error) {
	if c.unusable != nil {
		return "", c.unusable
	}
	return c.provider.Complete(ctx, systemPrompt, "INSTRUCTION\n"+instruction+"\n\nINPUT\n"+renderInput(input))
}

// postJSON sends payload and decodes a successful reply into out.
func (e endpoint) postJSON(ctx context.Context, url string, headers map[string]string, payload, out any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := e.http.Do(req)
	if err != nil {
		return fmt.Errorf("model step: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("model step: read response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		// OpenAI, Anthropic and Gemini all nest the message the same way.
		var failure struct {
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal(raw, &failure) == nil && failure.Error != nil && failure.Error.Message != "" {
			return fmt.Errorf("model step: %s", failure.Error.Message)
		}
		return fmt.Errorf("model step: %s answered %s", e.name, resp.Status)
	}

	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("model step: unreadable response (%s)", resp.Status)
	}
	return nil
}

func renderInput(text string) string {
	if text == "" {
		return "(no input)"
	}
	if len(text) > maxInputChars {
		cut := maxInputChars
		for cut > 0 && !utf8.RuneStart(text[cut]) {
			cut--
		}
		return text[:cut] + "\n…(truncated)"
	}
	return text
}

func names() []string {
	out := make([]string, 0, len(providers))
	for name := range providers {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
