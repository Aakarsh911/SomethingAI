// Package llm runs `llm` workflow steps against the OpenAI Responses API.
package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"
)

const defaultBaseURL = "https://api.openai.com/v1"

const systemPrompt = "You transform data inside an automation workflow. Follow the instruction exactly and reply with the result only — no preamble, no commentary, no markdown fences."

// maxInputChars caps the previous step's output sent to the model; a Gmail
// fetch is far larger than a summary needs.
const maxInputChars = 100_000

type Client struct {
	apiKey  string
	baseURL string
	model   string
	http    *http.Client
}

func New(apiKey, baseURL, model string) *Client {
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	return &Client{
		apiKey:  apiKey,
		baseURL: strings.TrimRight(baseURL, "/"),
		model:   model,
		http:    &http.Client{},
	}
}

// Transform applies instruction to input (the previous step's output, as
// text) and returns the model's reply.
func (c *Client) Transform(ctx context.Context, instruction, input string) (string, error) {
	if c.apiKey == "" {
		return "", errors.New("OPENAI_API_KEY is not set, so model steps cannot run.")
	}

	payload, err := json.Marshal(map[string]any{
		"model": c.model,
		"input": []map[string]string{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": "INSTRUCTION\n" + instruction + "\n\nINPUT\n" + renderInput(input)},
		},
	})
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/responses", bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("model step: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("model step: read response: %w", err)
	}

	var body struct {
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
		Output []struct {
			Type    string `json:"type"`
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		} `json:"output"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return "", fmt.Errorf("model step: unreadable response (%s)", resp.Status)
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		if body.Error != nil && body.Error.Message != "" {
			return "", fmt.Errorf("model step: %s", body.Error.Message)
		}
		return "", fmt.Errorf("model step: OpenAI answered %s", resp.Status)
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
