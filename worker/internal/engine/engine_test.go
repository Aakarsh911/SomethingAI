package engine

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"somethingai/worker/internal/graph"
)

func mustGraph(t *testing.T, raw string) *graph.Graph {
	t.Helper()
	g, err := graph.Parse([]byte(raw))
	if err != nil {
		t.Fatalf("parse graph: %v", err)
	}
	return g
}

type recorder struct {
	tools  []ToolCall
	models []ModelCall
	steps  []StepOutcome
}

func (r *recorder) env(toolOutput func(ToolCall) (any, error)) Env {
	return Env{
		CallTool: func(_ context.Context, call ToolCall) (any, error) {
			r.tools = append(r.tools, call)
			return toolOutput(call)
		},
		CallModel: func(_ context.Context, call ModelCall) (string, error) {
			r.models = append(r.models, call)
			return "summary of " + jsString(call.Input), nil
		},
		OnStep: func(outcome StepOutcome) error {
			r.steps = append(r.steps, outcome)
			return nil
		},
	}
}

func TestLinearToolThenLLM(t *testing.T) {
	g := mustGraph(t, `{
		"nodes": [
			{"id": "t", "kind": "trigger"},
			{"id": "fetch", "kind": "tool", "serverSlug": "gmail", "toolSlug": "GMAIL_FETCH", "inputs": {"max": 5, "q": "from:{{previous.output}}"}},
			{"id": "sum", "kind": "llm", "instruction": "Summarise {{steps.fetch.output.count}} mails"}
		],
		"edges": [{"from": "t", "to": "fetch"}, {"from": "fetch", "to": "sum"}]
	}`)

	r := &recorder{}
	result := Execute(context.Background(), g, r.env(func(ToolCall) (any, error) {
		return map[string]any{"count": json.Number("3")}, nil
	}))

	if result.Status != RunSucceeded {
		t.Fatalf("status = %s, error = %q", result.Status, result.Error)
	}
	if len(r.steps) != 2 {
		t.Fatalf("recorded %d steps, want 2", len(r.steps))
	}
	// previous is null before the first step, which stringifies to "".
	if got := r.tools[0].Inputs["q"]; got != "from:" {
		t.Errorf("q = %q", got)
	}
	if got := r.tools[0].Inputs["max"]; got != json.Number("5") {
		t.Errorf("max = %#v, want json.Number(5)", got)
	}
	if got := r.models[0].Instruction; got != "Summarise 3 mails" {
		t.Errorf("instruction = %q", got)
	}
	if result.Output != "summary of [object Object]" {
		t.Errorf("output = %#v", result.Output)
	}
	if r.steps[0].ServerSlug != "gmail" || r.steps[1].ServerSlug != "" {
		t.Errorf("server slugs = %q, %q", r.steps[0].ServerSlug, r.steps[1].ServerSlug)
	}
}

func TestWholePlaceholderKeepsType(t *testing.T) {
	scope := Scope{Previous: map[string]any{"ids": []any{json.Number("1"), json.Number("2")}}, Steps: map[string]any{}}

	got, err := Resolve(map[string]any{
		"ids":     "{{ previous.output.ids }}",
		"first":   "{{previous.output.ids.0}}",
		"missing": "{{previous.output.nope}}",
		"list":    []any{"{{previous.output.nope}}"},
		"text":    "ids: {{previous.output.ids}}",
	}, scope)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]any{
		"ids":   []any{json.Number("1"), json.Number("2")},
		"first": json.Number("1"),
		"list":  []any{nil},
		"text":  "ids: [\n  1,\n  2\n]",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %#v\nwant %#v", got, want)
	}
}

func TestAliases(t *testing.T) {
	scope := Scope{Previous: "hi", Steps: map[string]any{}}
	for _, spelling := range []string{"previous_step_output", "Last.Output", "output", "previousStep.output"} {
		got, err := Resolve("{{"+spelling+"}}", scope)
		if err != nil || got != "hi" {
			t.Errorf("%s: got %#v, %v", spelling, got, err)
		}
	}
}

func TestTemplateErrors(t *testing.T) {
	scope := Scope{Previous: map[string]any{"a": "x", "list": []any{}}, Steps: map[string]any{}}
	cases := map[string]string{
		"{{previous.input}}":         "Unknown reference",
		"{{steps.nope.output}}":      "which has not run",
		"{{previous.output.a.b}}":    "off a non-object",
		"{{previous.output.z.b}}":    "reads past a missing value",
		"{{previous.output.list.x}}": "indexes an array",
		"{{whatever}}":               "Unknown reference",
	}
	for template, want := range cases {
		_, err := Resolve(template, scope)
		var te *TemplateError
		if !errors.As(err, &te) || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: got %v, want error containing %q", template, err, want)
		}
	}
}

func TestConditions(t *testing.T) {
	scope := Scope{Previous: map[string]any{"n": json.Number("7"), "s": "Hello world"}, Steps: map[string]any{}}
	cases := map[string]bool{
		"true":                       true,
		"FALSE":                      false,
		"":                           false,
		"{{previous.output.n}} > 5":  true,
		"{{previous.output.n}} <= 6": false,
		"{{previous.output.n}} == 7": true,
		"'{{previous.output.s}}' == 'Hello world'": true,
		"{{previous.output.s}} contains world":     true,
		"{{previous.output.s}} STARTS WITH Hello":  true,
		"{{previous.output.s}} ends with \"x\"":    false,
		"{{previous.output.s}} != Hello world":     false,
		"is not empty":                             false,
		" > 0":                                     false, // blank is 0, as Number("") is
	}
	for condition, want := range cases {
		got, err := EvaluateCondition(condition, scope)
		if err != nil {
			t.Errorf("%q: unexpected error %v", condition, err)
			continue
		}
		if got != want {
			t.Errorf("%q = %v, want %v", condition, got, want)
		}
	}

	for _, bad := range []string{"{{previous.output.s}} > 3", "maybe", "{{previous.output}}"} {
		_, err := EvaluateCondition(bad, scope)
		var ce *ConditionError
		if !errors.As(err, &ce) {
			t.Errorf("%q: got %v, want ConditionError", bad, err)
		}
	}
}

func TestBranchRoutesOnPreviousNotBranch(t *testing.T) {
	g := mustGraph(t, `{
		"nodes": [
			{"id": "t", "kind": "trigger"},
			{"id": "count", "kind": "tool", "serverSlug": "s", "toolSlug": "COUNT"},
			{"id": "b", "kind": "branch", "condition": "{{previous.output}} > 10"},
			{"id": "big", "kind": "tool", "serverSlug": "s", "toolSlug": "BIG", "inputs": {"n": "{{previous.output}}"}},
			{"id": "small", "kind": "tool", "serverSlug": "s", "toolSlug": "SMALL"}
		],
		"edges": [
			{"from": "t", "to": "count"},
			{"from": "count", "to": "b"},
			{"from": "b", "to": "big", "when": "true"},
			{"from": "b", "to": "small", "when": "false"}
		]
	}`)

	r := &recorder{}
	result := Execute(context.Background(), g, r.env(func(call ToolCall) (any, error) {
		if call.ToolSlug == "COUNT" {
			return json.Number("42"), nil
		}
		return "done", nil
	}))

	if result.Status != RunSucceeded {
		t.Fatalf("status = %s, error = %q", result.Status, result.Error)
	}
	if len(r.tools) != 2 || r.tools[1].ToolSlug != "BIG" {
		t.Fatalf("tools = %+v", r.tools)
	}
	// The branch must not have replaced previous with its own empty output.
	if r.tools[1].Inputs["n"] != json.Number("42") {
		t.Errorf("n = %#v", r.tools[1].Inputs["n"])
	}
	if r.steps[1].Kind != graph.KindBranch || r.steps[1].Input != "{{previous.output}} > 10" {
		t.Errorf("branch step = %+v", r.steps[1])
	}
}

func TestFailures(t *testing.T) {
	cases := []struct {
		name, graph, want string
	}{
		{
			name: "loop",
			graph: `{"nodes":[{"id":"t","kind":"trigger"},{"id":"a","kind":"tool","serverSlug":"s","toolSlug":"A"},{"id":"b","kind":"tool","serverSlug":"s","toolSlug":"B"}],
				"edges":[{"from":"t","to":"a"},{"from":"a","to":"b"},{"from":"b","to":"a"}]}`,
			want: `loops back to "a"`,
		},
		{
			name: "join",
			graph: `{"nodes":[{"id":"t","kind":"trigger"},{"id":"a","kind":"tool","serverSlug":"s","toolSlug":"A"},{"id":"b","kind":"tool","serverSlug":"s","toolSlug":"B"},{"id":"c","kind":"tool","serverSlug":"s","toolSlug":"C"}],
				"edges":[{"from":"t","to":"a"},{"from":"t","to":"b"},{"from":"a","to":"c"},{"from":"b","to":"c"}]}`,
			want: `"c" is reached by more than one path`,
		},
		{
			name: "unconfigured",
			graph: `{"nodes":[{"id":"t","kind":"trigger"},{"id":"a","kind":"tool","label":"Send it","serverSlug":"gmail","toolSlug":"__unconfigured__"}],
				"edges":[{"from":"t","to":"a"}]}`,
			want: `"Send it" has no tool selected yet`,
		},
		{
			name: "tool error",
			graph: `{"nodes":[{"id":"t","kind":"trigger"},{"id":"a","kind":"tool","serverSlug":"s","toolSlug":"BOOM"}],
				"edges":[{"from":"t","to":"a"}]}`,
			want: "kaboom",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := &recorder{}
			result := Execute(context.Background(), mustGraph(t, tc.graph), r.env(func(call ToolCall) (any, error) {
				if call.ToolSlug == "BOOM" {
					return nil, errors.New("kaboom")
				}
				return "ok", nil
			}))
			if result.Status != RunFailed || !strings.Contains(result.Error, tc.want) {
				t.Fatalf("got %s %q, want failure containing %q", result.Status, result.Error, tc.want)
			}
		})
	}
}

func TestUnconfiguredToolIsNeverCalled(t *testing.T) {
	g := mustGraph(t, `{"nodes":[{"id":"t","kind":"trigger"},{"id":"a","kind":"tool","serverSlug":"gmail","toolSlug":"__unconfigured__"}],
		"edges":[{"from":"t","to":"a"}]}`)
	r := &recorder{}
	Execute(context.Background(), g, r.env(func(ToolCall) (any, error) { return nil, nil }))
	if len(r.tools) != 0 {
		t.Fatalf("called %d tools", len(r.tools))
	}
}

func TestDeadlineStopsBetweenSteps(t *testing.T) {
	g := mustGraph(t, `{"nodes":[{"id":"t","kind":"trigger"},{"id":"a","kind":"tool","serverSlug":"s","toolSlug":"A"},{"id":"b","kind":"tool","serverSlug":"s","toolSlug":"B"}],
		"edges":[{"from":"t","to":"a"},{"from":"a","to":"b"}]}`)

	ctx, cancel := context.WithTimeout(context.Background(), time.Hour)
	defer cancel()

	r := &recorder{}
	result := Execute(ctx, g, r.env(func(call ToolCall) (any, error) {
		cancel() // the run's deadline passes while A is in flight
		return "a", nil
	}))
	if result.Status != RunFailed || len(r.tools) != 1 {
		t.Fatalf("status = %s, tools = %d, error = %q", result.Status, len(r.tools), result.Error)
	}
	if result.Output != "a" {
		t.Errorf("output = %#v, want the last successful step's output", result.Output)
	}
}

func TestStepLimit(t *testing.T) {
	g := mustGraph(t, `{"nodes":[{"id":"t","kind":"trigger"},{"id":"a","kind":"tool","serverSlug":"s","toolSlug":"A"},{"id":"b","kind":"tool","serverSlug":"s","toolSlug":"B"}],
		"edges":[{"from":"t","to":"a"},{"from":"a","to":"b"}]}`)
	r := &recorder{}
	env := r.env(func(ToolCall) (any, error) { return "x", nil })
	env.MaxSteps = 1
	result := Execute(context.Background(), g, env)
	if !strings.Contains(result.Error, "1-step limit") {
		t.Fatalf("error = %q", result.Error)
	}
}

func TestParallelPathsStartFromTheSameStep(t *testing.T) {
	g := mustGraph(t, `{
		"nodes": [
			{"id": "t", "kind": "trigger"},
			{"id": "fetch", "kind": "tool", "serverSlug": "gmail", "toolSlug": "FETCH"},
			{"id": "mail", "kind": "tool", "serverSlug": "gmail", "toolSlug": "SEND", "inputs": {"body": "{{previous.output}}"}},
			{"id": "after_mail", "kind": "tool", "serverSlug": "s", "toolSlug": "AFTER", "inputs": {"in": "{{previous.output}}"}},
			{"id": "event", "kind": "tool", "serverSlug": "calendar", "toolSlug": "CREATE", "inputs": {"title": "{{previous.output}}", "from": "{{steps.fetch.output}}"}}
		],
		"edges": [
			{"from": "t", "to": "fetch"},
			{"from": "fetch", "to": "mail"},
			{"from": "fetch", "to": "event"},
			{"from": "mail", "to": "after_mail"}
		]
	}`)

	r := &recorder{}
	result := Execute(context.Background(), g, r.env(func(call ToolCall) (any, error) {
		return "out of " + call.ToolSlug, nil
	}))

	if result.Status != RunSucceeded {
		t.Fatalf("status = %s, error = %q", result.Status, result.Error)
	}
	var order []string
	for _, call := range r.tools {
		order = append(order, call.ToolSlug)
	}
	// Depth first, in edge order: the mail path finishes before the event path.
	if want := []string{"FETCH", "SEND", "AFTER", "CREATE"}; !reflect.DeepEqual(order, want) {
		t.Fatalf("order = %v, want %v", order, want)
	}
	if got := r.tools[2].Inputs["in"]; got != "out of SEND" {
		t.Errorf("after_mail read %#v", got)
	}
	// The event follows fetch, so previous is fetch's output, not the mail path's.
	if got := r.tools[3].Inputs["title"]; got != "out of FETCH" {
		t.Errorf("event title = %#v, want fetch's output", got)
	}
	if got := r.tools[3].Inputs["from"]; got != "out of FETCH" {
		t.Errorf("event from = %#v", got)
	}
	if result.Output != "out of CREATE" {
		t.Errorf("output = %#v", result.Output)
	}
}

func TestSiblingPathOutputIsNotVisible(t *testing.T) {
	g := mustGraph(t, `{
		"nodes": [
			{"id": "t", "kind": "trigger"},
			{"id": "a", "kind": "tool", "serverSlug": "s", "toolSlug": "A"},
			{"id": "b", "kind": "tool", "serverSlug": "s", "toolSlug": "B", "inputs": {"x": "{{steps.a.output}}"}}
		],
		"edges": [{"from": "t", "to": "a"}, {"from": "t", "to": "b"}]
	}`)

	r := &recorder{}
	result := Execute(context.Background(), g, r.env(func(ToolCall) (any, error) { return "ok", nil }))
	// a ran first, but b is not downstream of it, so the reference must not
	// resolve depending on run order.
	if result.Status != RunFailed || !strings.Contains(result.Error, "which has not run") {
		t.Fatalf("got %s %q", result.Status, result.Error)
	}
}

func TestFailedPathDoesNotStopItsSibling(t *testing.T) {
	g := mustGraph(t, `{
		"nodes": [
			{"id": "t", "kind": "trigger"},
			{"id": "boom", "kind": "tool", "serverSlug": "s", "toolSlug": "BOOM"},
			{"id": "below", "kind": "tool", "serverSlug": "s", "toolSlug": "BELOW"},
			{"id": "fine", "kind": "tool", "serverSlug": "s", "toolSlug": "FINE"}
		],
		"edges": [
			{"from": "t", "to": "boom"},
			{"from": "boom", "to": "below"},
			{"from": "t", "to": "fine"}
		]
	}`)

	r := &recorder{}
	result := Execute(context.Background(), g, r.env(func(call ToolCall) (any, error) {
		if call.ToolSlug == "BOOM" {
			return nil, errors.New("kaboom")
		}
		return "ok", nil
	}))

	if result.Status != RunFailed || result.Error != "kaboom" {
		t.Fatalf("got %s %q", result.Status, result.Error)
	}
	var called []string
	for _, call := range r.tools {
		called = append(called, call.ToolSlug)
	}
	if want := []string{"BOOM", "FINE"}; !reflect.DeepEqual(called, want) {
		t.Fatalf("called %v, want %v", called, want)
	}
	if result.Output != "ok" {
		t.Errorf("output = %#v", result.Output)
	}
}

func TestEveryFailedPathIsCounted(t *testing.T) {
	g := mustGraph(t, `{
		"nodes": [
			{"id": "t", "kind": "trigger"},
			{"id": "a", "kind": "tool", "serverSlug": "s", "toolSlug": "BOOM"},
			{"id": "b", "kind": "tool", "serverSlug": "s", "toolSlug": "BOOM"}
		],
		"edges": [{"from": "t", "to": "a"}, {"from": "t", "to": "b"}]
	}`)

	r := &recorder{}
	result := Execute(context.Background(), g, r.env(func(ToolCall) (any, error) {
		return nil, errors.New("kaboom")
	}))
	if result.Status != RunFailed || result.Error != "kaboom (2 paths failed in total.)" {
		t.Fatalf("got %s %q", result.Status, result.Error)
	}
	if len(r.steps) != 2 {
		t.Errorf("recorded %d steps, want 2", len(r.steps))
	}
}

func TestBranchCanFanOutAndRejoinsAfterExclusivePaths(t *testing.T) {
	g := mustGraph(t, `{
		"nodes": [
			{"id": "t", "kind": "trigger"},
			{"id": "b", "kind": "branch", "condition": "true"},
			{"id": "yes", "kind": "tool", "serverSlug": "s", "toolSlug": "YES"},
			{"id": "also", "kind": "tool", "serverSlug": "s", "toolSlug": "ALSO"},
			{"id": "no", "kind": "tool", "serverSlug": "s", "toolSlug": "NO"},
			{"id": "end", "kind": "tool", "serverSlug": "s", "toolSlug": "END"}
		],
		"edges": [
			{"from": "t", "to": "b"},
			{"from": "b", "to": "yes", "when": "true"},
			{"from": "b", "to": "yes", "when": "always"},
			{"from": "b", "to": "also", "when": "always"},
			{"from": "b", "to": "no", "when": "false"},
			{"from": "yes", "to": "end"},
			{"from": "no", "to": "end"}
		]
	}`)

	r := &recorder{}
	result := Execute(context.Background(), g, r.env(func(ToolCall) (any, error) { return "ok", nil }))
	if result.Status != RunSucceeded {
		t.Fatalf("status = %s, error = %q", result.Status, result.Error)
	}
	var called []string
	for _, call := range r.tools {
		called = append(called, call.ToolSlug)
	}
	// "end" has two parents, but only one of them can run, so it is not a join.
	if want := []string{"YES", "END", "ALSO"}; !reflect.DeepEqual(called, want) {
		t.Fatalf("called %v, want %v", called, want)
	}
}
