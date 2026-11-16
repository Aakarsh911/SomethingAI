// Command worker runs SomethingAI workflows: it claims the QUEUED runs the app
// inserts, executes them, records each step, and turns due schedules into
// runs. Copies can run side by side; claims use FOR UPDATE SKIP LOCKED.
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
	// Embedded so IANA zones resolve on a minimal image with no tzdata.
	_ "time/tzdata"

	"github.com/joho/godotenv"

	"somethingai/worker/internal/composio"
	"somethingai/worker/internal/llm"
	"somethingai/worker/internal/runner"
	"somethingai/worker/internal/store"
)

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))

	// Development only: load the app's .env (one level up from worker/).
	// Variables already set in the environment win.
	for _, path := range []string{".env", "../.env"} {
		if _, err := os.Stat(path); err != nil {
			continue
		}
		if err := godotenv.Load(path); err != nil {
			log.Error("load env file", "path", path, "err", err)
			os.Exit(1)
		}
		log.Info("loaded env file", "path", path)
		break
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
		MisfireGrace:     envDuration("WORKER_MISFIRE_GRACE", 24*time.Hour),
		ReapInterval:     time.Minute,
		StepTimeout:      60 * time.Second,
		RunTimeout:       envDuration("WORKER_RUN_TIMEOUT", 15*time.Minute),
		ReapGrace:        2 * time.Minute,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// One connection per run, plus spares for the claim and schedule loops.
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
