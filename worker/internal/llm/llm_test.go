package llm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func envOf(vars map[string]string) func(string) string {
	return func(name string) string { return vars[name] }
}

func TestConfigFromEnvKeepsLegacyOpenAIVars(t *testing.T) {
	cfg := ConfigFromEnv(envOf(map[string]string{
		"OPENAI_API_KEY":    "sk-old",
		"OPENAI_STEP_MODEL": "gpt-step",
		"OPENAI_MODEL":      "gpt-main",
	}))
	want := Config{Provider: "openai", APIKey: "sk-old", Model: "gpt-step"}
	if cfg != want {
		t.Errorf("got %+v, want %+v", cfg, want)
	}
}

func TestConfigFromEnvIgnoresOpenAIVarsForOtherProviders(t *testing.T) {
	cfg := ConfigFromEnv(envOf(map[string]string{
		"LLM_PROVIDER":      "Anthropic",
		"ANTHROPIC_API_KEY": "sk-ant",
		"OPENAI_STEP_MODEL": "gpt-step",
	}))
	want := Config{Provider: "anthropic", APIKey: "sk-ant"}
	if cfg != want {
		t.Errorf("got %+v, want %+v", cfg, want)
	}
}

func TestNewRejectsUnknownProvider(t *testing.T) {
	if _, err := New(Config{Provider: "nope"}); err == nil {
		t.Fatal("want an error for an unknown provider")
	}
}

func TestMissingKeyFailsAtCallTime(t *testing.T) {
	c, err := New(Config{Provider: "gemini", Model: "m"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Transform(context.Background(), "x", "y"); err == nil || !strings.Contains(err.Error(), "GEMINI_API_KEY") {
		t.Errorf("got %v, want a missing-key error", err)
	}
}

func TestProvidersSpeakTheirWireFormat(t *testing.T) {
	cases := []struct {
		provider, path, authHeader, reply string
	}{
		{"openai", "/responses", "Authorization",
			`{"output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}]}`},
		{"openai-compatible", "/chat/completions", "Authorization",
			`{"choices":[{"message":{"content":"ok"}}]}`},
		{"anthropic", "/messages", "X-Api-Key",
			`{"content":[{"type":"text","text":"ok"}]}`},
		{"gemini", "/models/m:generateContent", "X-Goog-Api-Key",
			`{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}`},
	}
	for _, tc := range cases {
		t.Run(tc.provider, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != tc.path {
					t.Errorf("path = %s, want %s", r.URL.Path, tc.path)
				}
				if !strings.Contains(r.Header.Get(tc.authHeader), "key") {
					t.Errorf("%s header missing", tc.authHeader)
				}
				w.Write([]byte(tc.reply))
			}))
			defer srv.Close()

			c, err := New(Config{Provider: tc.provider, APIKey: "key", BaseURL: srv.URL, Model: "m"})
			if err != nil {
				t.Fatal(err)
			}
			got, err := c.Transform(context.Background(), "do it", "data")
			if err != nil {
				t.Fatal(err)
			}
			if got != "ok" {
				t.Errorf("got %q, want %q", got, "ok")
			}
		})
	}
}

func TestProviderErrorMessageSurfaces(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":{"message":"bad key"}}`))
	}))
	defer srv.Close()

	c, _ := New(Config{Provider: "anthropic", APIKey: "key", BaseURL: srv.URL})
	if _, err := c.Transform(context.Background(), "x", "y"); err == nil || !strings.Contains(err.Error(), "bad key") {
		t.Errorf("got %v, want the provider's message", err)
	}
}
