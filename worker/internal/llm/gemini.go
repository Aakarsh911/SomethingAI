package llm

import (
	"context"
	"net/url"
	"strings"
)

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
