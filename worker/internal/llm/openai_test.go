package llm

import "testing"

func TestOutputTextSkipsSearchCalls(t *testing.T) {
	got := outputText([]responseItem{
		{Type: "web_search_call"},
		{
			Type:    "message",
			Content: []responsePart{{Type: "output_text", Text: "three commits landed"}},
		},
	})
	if got != "three commits landed" {
		t.Fatalf("got %q", got)
	}
}
