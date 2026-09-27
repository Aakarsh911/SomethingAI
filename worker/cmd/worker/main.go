// Command worker executes SomethingAI workflows.
//
// It is the only thing that runs workflows. The Next.js app enqueues runs by
// inserting QUEUED rows into WorkflowRun; this process claims them, runs them
// and records every step. It also owns the schedule: due workflows are turned
// into runs here, so no cron endpoint is needed.
//
// Any number of copies can run against the same database. Claims use
// FOR UPDATE SKIP LOCKED, so a run or a schedule slot is taken by exactly one.
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
	// Schedules are evaluated in the user's IANA zone. Embedding the zone
	// database means that works on a minimal image with no tzdata package,
	// instead of failing every scheduled workflow at runtime.
	_ "time/tzdata"

	"somethingai/worker/internal/composio"
	"somethingai/worker/internal/dotenv"
	"somethingai/worker/internal/llm"
	"somethingai/worker/internal/runner"
	"somethingai/worker/internal/store"
)

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))

	// Run from worker/ in development, the app's .env is one level up.
	if path, err := dotenv.Load(".env", "../.env"); err != nil {
		log.Error("load env file", "path", path, "err", err)
		os.Exit(1)
	} else if path != "" {
		log.Info("loaded env file", "path", path)
	}

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Error("DATABASE_URL is not set")
		os.Exit(1)
	}

	concurrency := envInt("WORKER_CONCURRENCY", 8)
	cfg := runner.Config{
		Concurrency:      concurrency,
		PollInterval:     envDuration("WORKER_POLL_INTERVAL", time.Second),
		ScheduleInterval: envDuration("WORKER_SCHEDULE_INTERVAL", 15*time.Second),
		ReapInterval:     time.Minute,
		StepTimeout:      60 * time.Second,
		RunTimeout:       envDuration("WORKER_RUN_TIMEOUT", 15*time.Minute),
		ReapGrace:        2 * time.Minute,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Each run holds a connection only while writing, but the claim and
	// schedule loops want one each on top of the runs.
	st, err := store.Open(ctx, databaseURL, int32(concurrency+4))
	if err != nil {
		log.Error("open database", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	model := firstNonEmpty(os.Getenv("OPENAI_STEP_MODEL"), os.Getenv("OPENAI_MODEL"), "gpt-5.5")

	r := runner.New(
		cfg,
		st,
		composio.New(os.Getenv("COMPOSIO_API_KEY"), os.Getenv("COMPOSIO_BASE_URL")),
		llm.New(os.Getenv("OPENAI_API_KEY"), os.Getenv("OPENAI_BASE_URL"), model),
		log,
	)

	log.Info("worker started", "concurrency", cfg.Concurrency, "runTimeout", cfg.RunTimeout, "model", model)
	r.Run(ctx)
	log.Info("worker stopped")
}

func envInt(name string, fallback int) int {
	if v, err := strconv.Atoi(os.Getenv(name)); err == nil && v > 0 {
		return v
	}
	return fallback
}

func envDuration(name string, fallback time.Duration) time.Duration {
	if v, err := time.ParseDuration(os.Getenv(name)); err == nil && v > 0 {
		return v
	}
	return fallback
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
