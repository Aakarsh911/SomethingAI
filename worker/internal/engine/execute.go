// Package engine walks a workflow graph and runs it. Every side effect comes
// through Env, so a dry run is just a different Env and the engine can be
// tested without a database or network.
package engine

import (
	"context"
	"errors"
	"fmt"
	"time"

	"somethingai/worker/internal/graph"
)

type StepStatus string

const (
	StepSucceeded StepStatus = "SUCCEEDED"
	StepFailed    StepStatus = "FAILED"
	StepSkipped   StepStatus = "SKIPPED"
)

type StepOutcome struct {
	NodeID     string
	Kind       graph.Kind
	ServerSlug string // empty unless Kind is tool
	ToolSlug   string // empty unless Kind is tool
	Status     StepStatus
	Input      any
	Output     any
	Error      string
	StartedAt  time.Time
	FinishedAt time.Time
}

type ToolCall struct {
	ServerSlug string
	ToolSlug   string
	Inputs     map[string]any
}

type ModelCall struct {
	Instruction string
	Input       any
}

type Env struct {
	CallTool  func(ctx context.Context, call ToolCall) (any, error)
	CallModel func(ctx context.Context, call ModelCall) (string, error)

	// OnStep is called as each step settles, so a crashed run still leaves a
	// readable log. An error here fails the run.
	OnStep func(StepOutcome) error

	Now func() time.Time

	// MaxSteps stops a graph that loops back on itself from running forever.
	MaxSteps int
}

type RunStatus string

const (
	RunSucceeded RunStatus = "SUCCEEDED"
	RunFailed    RunStatus = "FAILED"
)

type Result struct {
	Status RunStatus
	Steps  []StepOutcome
	Error  string
	// Output of the last step that produced one.
	Output any
}

const DefaultMaxSteps = 50

// ErrRunTimedOut is the message recorded when the run's context expires.
const ErrRunTimedOut = "This run ran out of time before it finished."

// Execute runs g to completion or the first failure. ctx's deadline caps the
// whole run and also cancels the step in flight.
func Execute(ctx context.Context, g *graph.Graph, env Env) Result {
	now := env.Now
	if now == nil {
		now = time.Now
	}
	maxSteps := env.MaxSteps
	if maxSteps == 0 {
		maxSteps = DefaultMaxSteps
	}

	var steps []StepOutcome

	byID := make(map[string]*graph.Node, len(g.Nodes))
	var trigger *graph.Node
	for i := range g.Nodes {
		node := &g.Nodes[i]
		byID[node.ID] = node
		if trigger == nil && node.Kind == graph.KindTrigger {
			trigger = node
		}
	}
	if trigger == nil {
		return Result{
			Status: RunFailed,
			Error:  "This workflow has no trigger node, so there is nowhere to start.",
		}
	}

	// Steps is keyed by node id, for {{steps.<id>.output}}.
	scope := Scope{Previous: nil, Steps: map[string]any{}}

	fail := func(message string) Result {
		return Result{Status: RunFailed, Steps: steps, Error: message, Output: scope.Previous}
	}

	visited := map[string]bool{}
	current := trigger

	for current != nil {
		if visited[current.ID] {
			return fail(fmt.Sprintf("This workflow loops back to %q. Runs must not revisit a step.", current.ID))
		}
		visited[current.ID] = true

		if len(steps) >= maxSteps {
			return fail(fmt.Sprintf("This workflow exceeded the %d-step limit for one run.", maxSteps))
		}
		if ctx.Err() != nil {
			return fail(ErrRunTimedOut)
		}

		// The trigger is an entry point, not work, so it is not a step.
		if current.Kind != graph.KindTrigger {
			outcome := runNode(ctx, current, env, now, scope)
			steps = append(steps, outcome)
			if env.OnStep != nil {
				if err := env.OnStep(outcome); err != nil {
					return fail(fmt.Sprintf("Could not record step %q: %v", current.ID, err))
				}
			}

			if outcome.Status == StepFailed {
				if outcome.Error == "" {
					return fail(fmt.Sprintf("Step %q failed.", current.ID))
				}
				return fail(outcome.Error)
			}

			// A branch routes rather than transforms, so its empty output must
			// not replace Previous, which its own condition reads next.
			if current.Kind != graph.KindBranch {
				scope.Steps[current.ID] = outcome.Output
				scope.Previous = outcome.Output
			}
		}

		next, err := chooseNext(current, g, byID, scope)
		if err != nil {
			return fail(err.Error())
		}
		current = next
	}

	return Result{Status: RunSucceeded, Steps: steps, Output: scope.Previous}
}

func runNode(ctx context.Context, node *graph.Node, env Env, now func() time.Time, scope Scope) StepOutcome {
	base := StepOutcome{NodeID: node.ID, Kind: node.Kind, StartedAt: now()}
	if node.Kind == graph.KindTool {
		base.ServerSlug = node.ServerSlug
		base.ToolSlug = node.ToolSlug
	}

	settle := func(status StepStatus, input, output any, message string) StepOutcome {
		out := base
		out.Status = status
		out.Input = input
		out.Output = output
		out.Error = message
		out.FinishedAt = now()
		return out
	}
	failed := func(input any, err error) StepOutcome {
		return settle(StepFailed, input, nil, describe(ctx, err))
	}

	switch node.Kind {
	case graph.KindBranch:
		// Decided in chooseNext; recorded so the branch shows in the run log.
		return settle(StepSucceeded, node.Condition, nil, "")

	case graph.KindLLM:
		resolved, err := Resolve(node.Instruction, scope)
		if err != nil {
			return failed(node.Instruction, err)
		}
		instruction := jsString(resolved)
		input := map[string]any{"instruction": instruction}

		output, err := env.CallModel(ctx, ModelCall{Instruction: instruction, Input: scope.Previous})
		if err != nil {
			return failed(input, err)
		}
		return settle(StepSucceeded, input, output, "")
	}

	// Caught here, or Composio would reject the sentinel slug and it would
	// read as a Composio fault rather than an unfinished step.
	if graph.IsUnconfiguredTool(node.ToolSlug) {
		name := node.ServerSlug
		if node.Label != nil {
			name = *node.Label
		}
		return settle(StepFailed, node.Inputs, nil, fmt.Sprintf(
			"%q has no tool selected yet. Open it on the canvas and choose one.", name,
		))
	}

	resolved, err := Resolve(node.Inputs, scope)
	if err != nil {
		return failed(node.Inputs, err)
	}
	inputs := resolved.(map[string]any)

	output, err := env.CallTool(ctx, ToolCall{
		ServerSlug: node.ServerSlug,
		ToolSlug:   node.ToolSlug,
		Inputs:     inputs,
	})
	if err != nil {
		return failed(inputs, err)
	}
	return settle(StepSucceeded, inputs, output, "")
}

func chooseNext(current *graph.Node, g *graph.Graph, byID map[string]*graph.Node, scope Scope) (*graph.Node, error) {
	var outgoing []graph.Edge
	for _, edge := range g.Edges {
		if edge.From == current.ID {
			outgoing = append(outgoing, edge)
		}
	}
	if len(outgoing) == 0 {
		return nil, nil
	}

	eligible := outgoing

	if current.Kind == graph.KindBranch {
		taken, err := EvaluateCondition(current.Condition, scope)
		if err != nil {
			return nil, err
		}
		wanted := graph.WhenFalse
		if taken {
			wanted = graph.WhenTrue
		}
		// An "always" edge out of a branch fires whichever way it went.
		eligible = nil
		for _, edge := range outgoing {
			if edge.When == wanted || edge.When == graph.WhenAlways {
				eligible = append(eligible, edge)
			}
		}
		if len(eligible) == 0 {
			return nil, nil
		}
	}

	if len(eligible) > 1 {
		// Picking one would be silently wrong; running both needs a merge rule.
		return nil, fmt.Errorf("Step %q has %d outgoing paths. Parallel branches are not supported yet.", current.ID, len(eligible))
	}

	node, ok := byID[eligible[0].To]
	if !ok {
		return nil, fmt.Errorf("Edge points at unknown step %q.", eligible[0].To)
	}
	return node, nil
}

// describe turns a step error into its recorded message, reporting a run
// timeout as such instead of as the cancelled HTTP request's error.
func describe(ctx context.Context, err error) string {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return ErrRunTimedOut
	}
	return err.Error()
}
