// Package engine walks a workflow graph and runs it. Every side effect comes
// through Env, so a dry run is just a different Env and the engine can be
// tested without a database or network.
package engine

import (
	"context"
	"errors"
	"fmt"
	"slices"
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

	// TriggerInput is the webhook (or other inbound) payload. It becomes
	// Previous for the first step; nil for manual and scheduled runs.
	TriggerInput any

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

// Execute runs every path out of the trigger. A node with several outgoing
// edges starts each of them from its own output, one after another rather
// than at once: depth first, in edge order, so the run log reads one path at
// a time.
//
// A failed step stops only its own path. Its siblings still run, because one
// dead server should fail one node, not the run; the run is still FAILED.
// Anything that breaks the run as a whole (the deadline, the step limit, a
// loop, two paths merging) stops it at once.
//
// ctx's deadline caps the whole run and also cancels the step in flight.
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

	// Output of the last step that produced one, across all paths.
	var last any
	// Failures of individual paths, which do not stop the others.
	var failures []string

	fail := func(message string) Result {
		return Result{Status: RunFailed, Steps: steps, Error: message, Output: last}
	}

	// A path is the node to run next and the steps that led to it. The scope
	// is per path: a step reads its own ancestors' outputs, never a sibling
	// path's, so what it sees does not depend on which path happened to run
	// first.
	type path struct {
		node  *graph.Node
		scope Scope
		// Ancestors, trigger first, to tell a loop from two paths merging.
		trail []string
	}

	reached := map[string]bool{trigger.ID: true}
	start := Scope{Previous: env.TriggerInput, Steps: map[string]any{}}
	if env.TriggerInput != nil {
		start.Steps[trigger.ID] = env.TriggerInput
	}
	stack := []path{{node: trigger, scope: start}}

	for len(stack) > 0 {
		current := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		node, scope := current.node, current.scope

		if len(steps) >= maxSteps {
			return fail(fmt.Sprintf("This workflow exceeded the %d-step limit for one run.", maxSteps))
		}
		if ctx.Err() != nil {
			return fail(ErrRunTimedOut)
		}

		// The trigger is an entry point, not work, so it is not a step.
		if node.Kind != graph.KindTrigger {
			outcome := runNode(ctx, node, env, now, scope)
			steps = append(steps, outcome)
			if env.OnStep != nil {
				if err := env.OnStep(outcome); err != nil {
					return fail(fmt.Sprintf("Could not record step %q: %v", node.ID, err))
				}
			}

			if outcome.Status == StepFailed {
				message := outcome.Error
				if message == "" {
					message = fmt.Sprintf("Step %q failed.", node.ID)
				}
				if ctx.Err() != nil {
					return fail(message)
				}
				failures = append(failures, message)
				continue
			}

			// A branch routes rather than transforms, so its empty output must
			// not replace Previous, which its own condition reads next.
			if node.Kind != graph.KindBranch {
				scope = scope.with(node.ID, outcome.Output)
				last = outcome.Output
			}
		}

		next, err := chooseNext(node, g, byID, scope)
		if err != nil {
			failures = append(failures, err.Error())
			continue
		}

		trail := append(current.trail[:len(current.trail):len(current.trail)], node.ID)
		// Pushed in reverse so the first edge runs first.
		for i := len(next) - 1; i >= 0; i-- {
			child := next[i]
			if reached[child.ID] {
				if slices.Contains(trail, child.ID) {
					return fail(fmt.Sprintf("This workflow loops back to %q. Runs must not revisit a step.", child.ID))
				}
				// Waiting for every parent, or running once per parent, are
				// both plausible; until one is chosen, refuse rather than guess.
				return fail(fmt.Sprintf("Step %q is reached by more than one path. Paths that split cannot join again yet.", child.ID))
			}
			reached[child.ID] = true
			stack = append(stack, path{node: child, scope: scope, trail: trail})
		}
	}

	if len(failures) > 0 {
		message := failures[0]
		if len(failures) > 1 {
			message = fmt.Sprintf("%s (%d paths failed in total.)", message, len(failures))
		}
		return fail(message)
	}
	return Result{Status: RunSucceeded, Steps: steps, Output: last}
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

// chooseNext returns every node to run after current, in edge order.
func chooseNext(current *graph.Node, g *graph.Graph, byID map[string]*graph.Node, scope Scope) ([]*graph.Node, error) {
	var outgoing []graph.Edge
	for _, edge := range g.Edges {
		if edge.From == current.ID {
			outgoing = append(outgoing, edge)
		}
	}

	eligible := outgoing

	if current.Kind == graph.KindBranch && len(outgoing) > 0 {
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
	}

	var next []*graph.Node
	seen := map[string]bool{}
	for _, edge := range eligible {
		// Two edges to one child, e.g. "true" and "always" out of a branch,
		// still run it once.
		if seen[edge.To] {
			continue
		}
		seen[edge.To] = true
		node, ok := byID[edge.To]
		if !ok {
			return nil, fmt.Errorf("Edge points at unknown step %q.", edge.To)
		}
		next = append(next, node)
	}
	return next, nil
}

// describe turns a step error into its recorded message, reporting a run
// timeout as such instead of as the cancelled HTTP request's error.
func describe(ctx context.Context, err error) string {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return ErrRunTimedOut
	}
	return err.Error()
}
