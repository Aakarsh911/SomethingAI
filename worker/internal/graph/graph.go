// Package graph decodes the workflow graph blob stored in Workflow.graph and
// WorkflowRun.graphSnapshot.
//
// The Zod schema in src/lib/workflows/graph.ts is the source of truth and
// every write path goes through it, so this package does not try to be a
// second validator. It checks only what the engine would otherwise trip over
// mid-run: unknown node kinds, dangling edges, duplicate ids, and the trigger
// count.
package graph

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// UnconfiguredTool mirrors UNCONFIGURED_TOOL in graph.ts: the tool slug of a
// node placed on the canvas but never given a tool.
const UnconfiguredTool = "__unconfigured__"

func IsUnconfiguredTool(toolSlug string) bool {
	return toolSlug == "" || toolSlug == UnconfiguredTool
}

type Kind string

const (
	KindTrigger Kind = "trigger"
	KindTool    Kind = "tool"
	KindLLM     Kind = "llm"
	KindBranch  Kind = "branch"
)

// Node is every node kind flattened into one struct. Fields that do not
// apply to a kind are left zero.
type Node struct {
	ID    string  `json:"id"`
	Kind  Kind    `json:"kind"`
	Label *string `json:"label,omitempty"`

	// tool
	ServerSlug string         `json:"serverSlug,omitempty"`
	ToolSlug   string         `json:"toolSlug,omitempty"`
	Inputs     map[string]any `json:"inputs,omitempty"`

	// llm
	Instruction string `json:"instruction,omitempty"`

	// branch
	Condition string `json:"condition,omitempty"`
}

type When string

const (
	WhenAlways When = "always"
	WhenTrue   When = "true"
	WhenFalse  When = "false"
)

type Edge struct {
	From string `json:"from"`
	To   string `json:"to"`
	When When   `json:"when,omitempty"`
}

type Graph struct {
	Nodes []Node `json:"nodes"`
	Edges []Edge `json:"edges"`
}

// Parse decodes and checks a stored graph.
//
// Numbers are kept as json.Number so an id like 12345678901234567 in a tool
// argument reaches the tool intact instead of being rounded through float64.
func Parse(raw []byte) (*Graph, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()

	var g Graph
	if err := decoder.Decode(&g); err != nil {
		return nil, fmt.Errorf("decode graph: %w", err)
	}

	ids := make(map[string]bool, len(g.Nodes))
	triggers := 0
	for i := range g.Nodes {
		n := &g.Nodes[i]
		if n.ID == "" {
			return nil, fmt.Errorf("node %d has no id", i)
		}
		if ids[n.ID] {
			return nil, fmt.Errorf("duplicate node id %q", n.ID)
		}
		ids[n.ID] = true

		switch n.Kind {
		case KindTrigger:
			triggers++
		case KindTool:
			if n.ServerSlug == "" {
				return nil, fmt.Errorf("tool node %q has no serverSlug", n.ID)
			}
			if n.Inputs == nil {
				n.Inputs = map[string]any{}
			}
		case KindLLM:
			if n.Instruction == "" {
				return nil, fmt.Errorf("llm node %q has no instruction", n.ID)
			}
		case KindBranch:
		default:
			return nil, fmt.Errorf("node %q has unknown kind %q", n.ID, n.Kind)
		}
	}

	if triggers != 1 {
		return nil, fmt.Errorf("a workflow needs exactly one trigger node, found %d", triggers)
	}

	for i := range g.Edges {
		e := &g.Edges[i]
		if e.When == "" {
			e.When = WhenAlways
		}
		if e.When != WhenAlways && e.When != WhenTrue && e.When != WhenFalse {
			return nil, fmt.Errorf("edge %d has unknown when %q", i, e.When)
		}
		if !ids[e.From] {
			return nil, fmt.Errorf("edge references unknown node %q", e.From)
		}
		if !ids[e.To] {
			return nil, fmt.Errorf("edge references unknown node %q", e.To)
		}
	}

	return &g, nil
}
