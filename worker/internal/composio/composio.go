// Package composio executes tools against a user's Composio connected
// account over Composio's REST API.
//
// There is no Go SDK. The request mirrors what @composio/core sends from
// executeComposioTool with dangerouslySkipVersionCheck: nothing in this app
// pins toolkit versions yet, so every call asks for "latest".
package composio

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

const defaultBaseURL = "https://backend.composio.dev"

type Client struct {
	apiKey  string
	baseURL string
	http    *http.Client
}

func New(apiKey, baseURL string) *Client {
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	return &Client{
		apiKey:  apiKey,
		baseURL: strings.TrimRight(baseURL, "/"),
		http:    &http.Client{},
	}
}

type ExecuteRequest struct {
	UserID             string
	ToolSlug           string
	Arguments          map[string]any
	ConnectedAccountID string
}

// Execute runs one tool and returns its `data`.
//
// Composio reports tool-level failures in a 200 body rather than as an HTTP
// error, so `successful` is checked explicitly — otherwise a failed call
// would be recorded as a successful step.
func (c *Client) Execute(ctx context.Context, req ExecuteRequest) (any, error) {
	if c.apiKey == "" {
		return nil, errors.New("COMPOSIO_API_KEY is not set, so tools cannot run.")
	}

	body := map[string]any{
		"user_id":   req.UserID,
		"arguments": req.Arguments,
		"version":   "latest",
	}
	if req.ConnectedAccountID != "" {
		body["connected_account_id"] = req.ConnectedAccountID
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("%s: encode arguments: %w", req.ToolSlug, err)
	}

	endpoint := c.baseURL + "/api/v3.1/tools/execute/" + url.PathEscape(req.ToolSlug)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", c.apiKey)

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", req.ToolSlug, err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("%s: read response: %w", req.ToolSlug, err)
	}

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		if detail := extractError(raw); detail != "" {
			return nil, fmt.Errorf("%s: %s", req.ToolSlug, detail)
		}
		return nil, fmt.Errorf("%s: Composio answered %s", req.ToolSlug, resp.Status)
	}

	var result struct {
		Data       any     `json:"data"`
		Error      *string `json:"error"`
		Successful bool    `json:"successful"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&result); err != nil {
		return nil, fmt.Errorf("%s: unreadable response from Composio: %w", req.ToolSlug, err)
	}

	if !result.Successful {
		if result.Error != nil && *result.Error != "" {
			return nil, errors.New(*result.Error)
		}
		return nil, fmt.Errorf("%s failed.", req.ToolSlug)
	}
	return result.Data, nil
}

// extractError digs the provider's explanation out of an error body.
//
// Taken from the innermost object that has a message: the outer layers
// repeat Composio's generic wording, the inner one is the provider speaking.
// A suggested_fix is appended when it says something the message does not.
func extractError(raw []byte) string {
	var body any
	if json.Unmarshal(raw, &body) != nil {
		return ""
	}

	var message, fix string
	var walk func(value any, depth int)
	walk = func(value any, depth int) {
		if depth > 6 {
			return
		}
		switch v := value.(type) {
		case map[string]any:
			if s, ok := v["message"].(string); ok && strings.TrimSpace(s) != "" {
				message = strings.TrimSpace(s)
			}
			if s, ok := v["suggested_fix"].(string); ok && strings.TrimSpace(s) != "" {
				fix = strings.TrimSpace(s)
			}
			for _, nested := range v {
				walk(nested, depth+1)
			}
		case []any:
			for _, nested := range v {
				walk(nested, depth+1)
			}
		}
	}
	walk(body, 0)

	if message == "" {
		return ""
	}
	if fix != "" && fix != message {
		return message + " " + fix
	}
	return message
}
