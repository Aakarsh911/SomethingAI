// Package runner connects the pure engine to the real world and keeps it fed.
//
// Three loops share one process:
//
//   - schedule: turns due workflows into QUEUED runs.
//   - claim:    moves QUEUED runs to RUNNING and executes each in its own
//     goroutine, up to Concurrency at once.
//   - reap:     fails runs whose worker died mid-run.
//
// Everything that differs between a real run and a rehearsal lives in the
// Env built here, so the engine never learns what a dry run is.
package runner

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"somethingai/worker/internal/composio"
	"somethingai/worker/internal/engine"
	"somethingai/worker/internal/graph"
	"somethingai/worker/internal/llm"
	"somethingai/worker/internal/schedule"
	"somethingai/worker/internal/store"
)

type Config struct {
	Concurrency      int
	PollInterval     time.Duration
	ScheduleInterval time.Duration
	ReapInterval     time.Duration
	// StepTimeout caps a single tool or model call.
	StepTimeout time.Duration
	// RunTimeout caps a whole run. A run older than this plus ReapGrace is
	// presumed dead.
	RunTimeout time.Duration
	ReapGrace  time.Duration
}

type Runner struct {
	cfg      Config
	store    *store.Store
	composio *composio.Client
	llm      *llm.Client
	log      *slog.Logger

	slots chan struct{}
	wake  chan struct{}
	wg    sync.WaitGroup
}

func New(cfg Config, st *store.Store, cc *composio.Client, lc *llm.Client, log *slog.Logger) *Runner {
	return &Runner{
		cfg:      cfg,
		store:    st,
		composio: cc,
		llm:      lc,
		log:      log,
		slots:    make(chan struct{}, cfg.Concurrency),
		wake:     make(chan struct{}, 1),
	}
}

// Run blocks until ctx is cancelled, then stops claiming new work and waits
// for in-flight runs to finish. In-flight runs are not cancelled with ctx:
// each already has its own RunTimeout, and cutting one off mid-step is how an
// email gets sent without the run log knowing.
func (r *Runner) Run(ctx context.Context) {
	r.reap(ctx)

	var loops sync.WaitGroup
	loops.Add(3)
	go func() { defer loops.Done(); r.every(ctx, r.cfg.ScheduleInterval, r.schedule) }()
	go func() { defer loops.Done(); r.claimLoop(ctx) }()
	go func() { defer loops.Done(); r.every(ctx, r.cfg.ReapInterval, r.reap) }()
	loops.Wait()

	r.log.Info("waiting for in-flight runs")
	r.wg.Wait()
}

func (r *Runner) every(ctx context.Context, interval time.Duration, fn func(context.Context)) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	fn(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			fn(ctx)
		}
	}
}

func (r *Runner) schedule(ctx context.Context) {
	now := time.Now()
	n, err := r.store.EnqueueDue(ctx, now, 100, func(w store.DueWorkflow) *time.Time {
		// A workflow that is no longer on a schedule keeps no slot, so it is
		// not picked up again. That includes ONCE: its one slot is this one.
		if w.Trigger != "SCHEDULE" || w.Cron == nil || w.Timezone == nil {
			return nil
		}
		next, err := schedule.Next(*w.Cron, *w.Timezone, now)
		if err != nil {
			// The app validated this on save, so reaching here means the two
			// cron implementations disagree. Run this slot, park the rest
			// rather than firing every tick, and make it loud.
			r.log.Error("cannot compute next run; schedule cleared", "workflow", w.ID, "err", err)
			return nil
		}
		return &next
	})
	if err != nil {
		if ctx.Err() == nil {
			r.log.Error("enqueue due workflows", "err", err)
		}
		return
	}
	if n > 0 {
		r.log.Info("enqueued scheduled runs", "count", n)
		r.poke()
	}
}

func (r *Runner) poke() {
	select {
	case r.wake <- struct{}{}:
	default:
	}
}

func (r *Runner) claimLoop(ctx context.Context) {
	ticker := time.NewTicker(r.cfg.PollInterval)
	defer ticker.Stop()
	for {
		r.claim(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-r.wake:
		}
	}
}

func (r *Runner) claim(ctx context.Context) {
	free := cap(r.slots) - len(r.slots)
	if free == 0 {
		return
	}

	runs, err := r.store.ClaimQueued(ctx, time.Now(), free)
	if err != nil {
		if ctx.Err() == nil {
			r.log.Error("claim queued runs", "err", err)
		}
		return
	}

	for _, run := range runs {
		r.slots <- struct{}{}
		r.wg.Add(1)
		go func() {
			defer func() {
				<-r.slots
				r.wg.Done()
				r.poke() // a slot opened; there may be more waiting
			}()
			r.execute(run)
		}()
	}
}

func (r *Runner) reap(ctx context.Context) {
	now := time.Now()
	n, err := r.store.ReapStale(ctx, now.Add(-(r.cfg.RunTimeout + r.cfg.ReapGrace)), now)
	if err != nil {
		if ctx.Err() == nil {
			r.log.Error("reap stale runs", "err", err)
		}
		return
	}
	if n > 0 {
		r.log.Warn("failed runs abandoned by a dead worker", "count", n)
	}
}

// execute runs one claimed run to completion. It deliberately does not take
// the process context: see Run.
func (r *Runner) execute(run store.ClaimedRun) {
	log := r.log.With("run", run.ID, "workflow", run.WorkflowID, "trigger", run.Trigger, "dryRun", run.DryRun)
	started := time.Now()

	// Writes after the run's deadline must still land, or the run stays
	// RUNNING until the reaper finds it. Each gets its own short budget.
	persist := func(fn func(context.Context) error) error {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		return fn(ctx)
	}
	finish := func(status, message string, output any) {
		err := persist(func(ctx context.Context) error {
			return r.store.FinishRun(ctx, run.ID, status, message, output, time.Now())
		})
		if err != nil {
			log.Error("record run outcome", "err", err)
		}
		log.Info("run finished", "status", status, "tookMs", time.Since(started).Milliseconds(), "error", message)
	}

	defer func() {
		// The engine is written not to panic, so reaching here is a bug. The
		// run must not stay RUNNING because of it.
		if p := recover(); p != nil {
			log.Error("run panicked", "panic", p)
			finish("FAILED", fmt.Sprintf("The worker hit an internal error: %v", p), nil)
		}
	}()

	g, err := graph.Parse([]byte(run.GraphSnapshot))
	if err != nil {
		log.Warn("invalid graph snapshot", "err", err)
		finish("FAILED", "The stored workflow graph is invalid, so it cannot be run.", nil)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), r.cfg.RunTimeout)
	defer cancel()

	var env engine.Env
	if run.DryRun {
		env = dryRunEnv()
	} else {
		env, err = r.liveEnv(ctx, run.UserID)
		if err != nil {
			finish("FAILED", fmt.Sprintf("Could not prepare the run: %v", err), nil)
			return
		}
	}
	env.OnStep = func(outcome engine.StepOutcome) error {
		status := string(outcome.Status)
		if outcome.Status == engine.StepSkipped {
			status = "CANCELED"
		}
		return persist(func(ctx context.Context) error {
			return r.store.RecordStep(ctx, store.Step{
				RunID:      run.ID,
				NodeID:     outcome.NodeID,
				Status:     status,
				ServerSlug: outcome.ServerSlug,
				ToolSlug:   outcome.ToolSlug,
				Input:      outcome.Input,
				Output:     outcome.Output,
				Error:      outcome.Error,
				StartedAt:  outcome.StartedAt,
				FinishedAt: outcome.FinishedAt,
			})
		})
	}

	result := engine.Execute(ctx, g, env)
	finish(string(result.Status), result.Error, result.Output)
}

// liveEnv maps a graph's serverSlug onto the Composio account that backs it.
//
// Resolved once per run rather than per step: a ten-step Gmail workflow
// should not make ten identical lookups, and a mid-run disconnect changing
// behaviour between steps would be worse than failing consistently.
func (r *Runner) liveEnv(ctx context.Context, userID string) (engine.Env, error) {
	accounts, err := r.store.ConnectedAccounts(ctx, userID)
	if err != nil {
		return engine.Env{}, err
	}

	return engine.Env{
		CallTool: func(ctx context.Context, call engine.ToolCall) (any, error) {
			account, connected := accounts[call.ServerSlug]
			if !connected {
				return nil, fmt.Errorf("%s is not connected, so %q cannot run. Reconnect it under Integrations.", call.ServerSlug, call.ToolSlug)
			}
			return r.withStepTimeout(ctx, call.ToolSlug, func(ctx context.Context) (any, error) {
				return r.composio.Execute(ctx, composio.ExecuteRequest{
					UserID:             userID,
					ToolSlug:           call.ToolSlug,
					Arguments:          call.Inputs,
					ConnectedAccountID: account,
				})
			})
		},
		CallModel: func(ctx context.Context, call engine.ModelCall) (string, error) {
			out, err := r.withStepTimeout(ctx, "the model step", func(ctx context.Context) (any, error) {
				return r.llm.Transform(ctx, call.Instruction, call.Input)
			})
			if err != nil {
				return "", err
			}
			return out.(string), nil
		},
	}, nil
}

// withStepTimeout gives one call StepTimeout and names it if it runs over.
// A call cut short by the whole run expiring is left for the engine to
// describe, since that is a different failure.
func (r *Runner) withStepTimeout(ctx context.Context, name string, fn func(context.Context) (any, error)) (any, error) {
	stepCtx, cancel := context.WithTimeout(ctx, r.cfg.StepTimeout)
	defer cancel()

	out, err := fn(stepCtx)
	if err != nil && ctx.Err() == nil && errors.Is(stepCtx.Err(), context.DeadlineExceeded) {
		return nil, fmt.Errorf("%s took longer than %s", name, r.cfg.StepTimeout)
	}
	return out, err
}

// dryRunEnv records what would have happened, calling nothing.
//
// Every workflow here sends real email the first time it succeeds, so there
// has to be a way to prove the wiring — templates, ordering, branches —
// without doing that.
func dryRunEnv() engine.Env {
	return engine.Env{
		CallTool: func(_ context.Context, call engine.ToolCall) (any, error) {
			return map[string]any{
				"dryRun":     true,
				"serverSlug": call.ServerSlug,
				"toolSlug":   call.ToolSlug,
				"arguments":  call.Inputs,
			}, nil
		},
		CallModel: func(_ context.Context, call engine.ModelCall) (string, error) {
			return "[dry run] would run the model with: " + call.Instruction, nil
		},
	}
}
