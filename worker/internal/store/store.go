// Package store is the worker's view of the tables Prisma owns.
//
// Prisma remains the only thing that migrates the schema; this package just
// reads and writes rows. Two conventions run through every query:
//
//   - Statements run in exec mode (no named prepared statements) so the
//     worker can sit behind a transaction-pooling PgBouncer, the same pooled
//     DATABASE_URL the app uses. Parameters therefore arrive typed from Go,
//     which is why enums, JSON and timestamps are cast explicitly in SQL.
//
//   - Prisma's DateTime columns are TIMESTAMP(3) without a zone and hold UTC.
//     Times are passed as UTC text and cast to timestamp, so the session's
//     TimeZone setting can never shift them.
package store

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"somethingai/worker/internal/cuid"
)

type Store struct {
	pool *pgxpool.Pool
}

// prismaOnlyParams are connection-string options Prisma understands and
// Postgres does not. pgx forwards unknown options to the server as runtime
// parameters, which makes it refuse the connection outright.
var prismaOnlyParams = []string{
	"connection_limit", "pool_timeout", "pgbouncer", "statement_cache_size",
	"socket_timeout", "sslaccept",
}

func Open(ctx context.Context, databaseURL string, maxConns int32) (*Store, error) {
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("DATABASE_URL: %w", err)
	}
	query := parsed.Query()
	schema := query.Get("schema")
	query.Del("schema")
	for _, name := range prismaOnlyParams {
		query.Del(name)
	}
	parsed.RawQuery = query.Encode()

	config, err := pgxpool.ParseConfig(parsed.String())
	if err != nil {
		return nil, fmt.Errorf("DATABASE_URL: %w", err)
	}
	if schema != "" {
		config.ConnConfig.RuntimeParams["search_path"] = schema
	}
	config.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec
	if maxConns > 0 {
		config.MaxConns = maxConns
	}

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("connect to Postgres: %w", err)
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() { s.pool.Close() }

func ts(t time.Time) string {
	return t.UTC().Format("2006-01-02 15:04:05.000")
}

/* --------------------------------------------------------------- schedules */

// DueWorkflow is a scheduled workflow whose slot has come up.
type DueWorkflow struct {
	ID       string
	UserID   string
	Trigger  string
	Cron     *string
	Timezone *string
	Graph    string
	Version  int32
}

// EnqueueDue turns every due workflow into a QUEUED run and advances its
// nextRunAt, in one transaction.
//
// FOR UPDATE SKIP LOCKED is what makes this safe to run from several workers
// at once, or from one worker whose ticks overlap: a workflow row is claimed
// by exactly one transaction, and the slot is advanced before the lock is
// released, so no one else can see it as due again. nextOf is called under
// the lock to compute the following slot; returning nil clears it.
//
// nextRunAt is advanced whether the run later passes or fails, because a
// workflow that fails at 09:00 should next be considered at its next slot,
// not retried on every tick for the rest of the day.
func (s *Store) EnqueueDue(
	ctx context.Context,
	now time.Time,
	limit int,
	nextOf func(DueWorkflow) *time.Time,
) (enqueued int, err error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(context.WithoutCancel(ctx))
		}
	}()

	rows, err := tx.Query(ctx, `
		SELECT id, "userId", trigger::text, cron, timezone, graph::text, "graphVersion"
		FROM "Workflow"
		WHERE "isEnabled" = true AND "nextRunAt" <= $1::timestamp
		ORDER BY "nextRunAt"
		LIMIT $2
		FOR UPDATE SKIP LOCKED`,
		ts(now), limit,
	)
	if err != nil {
		return 0, err
	}
	due, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (DueWorkflow, error) {
		var w DueWorkflow
		err := row.Scan(&w.ID, &w.UserID, &w.Trigger, &w.Cron, &w.Timezone, &w.Graph, &w.Version)
		return w, err
	})
	if err != nil {
		return 0, err
	}

	for _, w := range due {
		var next *string
		if at := nextOf(w); at != nil {
			formatted := ts(*at)
			next = &formatted
		}

		if _, err := tx.Exec(ctx, `
			UPDATE "Workflow"
			SET "lastRunAt" = $2::timestamp, "nextRunAt" = $3::timestamp
			WHERE id = $1`,
			w.ID, ts(now), next,
		); err != nil {
			return 0, err
		}

		if _, err := tx.Exec(ctx, `
			INSERT INTO "WorkflowRun"
				(id, "workflowId", status, trigger, "graphSnapshot", "graphVersion", "dryRun", "createdAt")
			VALUES ($1, $2, 'QUEUED', 'SCHEDULE', $3::jsonb, $4, false, $5::timestamp)`,
			cuid.New(), w.ID, w.Graph, w.Version, ts(now),
		); err != nil {
			return 0, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(due), nil
}

/* -------------------------------------------------------------------- runs */

type ClaimedRun struct {
	ID            string
	WorkflowID    string
	UserID        string
	Trigger       string
	GraphSnapshot string
	DryRun        bool
}

// ClaimQueued moves up to limit QUEUED runs to RUNNING and returns them.
// SKIP LOCKED again: two workers polling at the same moment get disjoint
// sets, never the same run.
func (s *Store) ClaimQueued(ctx context.Context, now time.Time, limit int) ([]ClaimedRun, error) {
	rows, err := s.pool.Query(ctx, `
		UPDATE "WorkflowRun" AS r
		SET status = 'RUNNING', "startedAt" = $1::timestamp
		FROM "Workflow" AS w
		WHERE r."workflowId" = w.id
		  AND r.id IN (
			SELECT id FROM "WorkflowRun"
			WHERE status = 'QUEUED'
			ORDER BY "createdAt"
			LIMIT $2
			FOR UPDATE SKIP LOCKED
		  )
		RETURNING r.id, r."workflowId", w."userId", r.trigger::text, r."graphSnapshot"::text, r."dryRun"`,
		ts(now), limit,
	)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (ClaimedRun, error) {
		var r ClaimedRun
		err := row.Scan(&r.ID, &r.WorkflowID, &r.UserID, &r.Trigger, &r.GraphSnapshot, &r.DryRun)
		return r, err
	})
}

// FinishRun records a run's outcome.
//
// Guarded on RUNNING so a run the reaper has already given up on is not
// resurrected by a worker that turns out to have been alive after all.
func (s *Store) FinishRun(ctx context.Context, runID, status, message string, output any, at time.Time) error {
	encoded, err := encodeJSON(output)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
		UPDATE "WorkflowRun"
		SET status = $2::"RunStatus", error = $3, output = $4::jsonb, "finishedAt" = $5::timestamp
		WHERE id = $1 AND status = 'RUNNING'`,
		runID, status, nullable(message), encoded, ts(at),
	)
	return err
}

// ReapStale fails runs that have been RUNNING since before cutoff.
//
// A run cannot legitimately outlive its deadline, so one that has is a run
// whose worker died — a deploy, an OOM, a lost host. It is failed rather than
// requeued: re-running from the top could send an email a second time, and
// never double-sending matters more than finishing.
func (s *Store) ReapStale(ctx context.Context, cutoff, now time.Time) (int64, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE "WorkflowRun"
		SET status = 'FAILED',
		    error = 'The worker running this stopped before it finished. It was not retried, so nothing was sent twice.',
		    "finishedAt" = $2::timestamp
		WHERE status = 'RUNNING' AND "startedAt" < $1::timestamp`,
		ts(cutoff), ts(now),
	)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

type Step struct {
	RunID      string
	NodeID     string
	Status     string
	ServerSlug string
	ToolSlug   string
	Input      any
	Output     any
	Error      string
	StartedAt  time.Time
	FinishedAt time.Time
}

// RecordStep appends one attempt at one node. Attempts are always 1 for now;
// `@@unique([runId, nodeId, attempt])` turns a double-write into an error
// rather than a silent duplicate.
func (s *Store) RecordStep(ctx context.Context, step Step) error {
	input, err := encodeJSON(step.Input)
	if err != nil {
		return err
	}
	output, err := encodeJSON(step.Output)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO "WorkflowStepRun"
			(id, "runId", "nodeId", "serverSlug", "toolSlug", status, attempt,
			 input, output, error, "startedAt", "finishedAt", "createdAt")
		VALUES ($1, $2, $3, $4, $5, $6::"RunStatus", 1,
			$7::jsonb, $8::jsonb, $9, $10::timestamp, $11::timestamp, $11::timestamp)`,
		cuid.New(), step.RunID, step.NodeID, nullable(step.ServerSlug), nullable(step.ToolSlug), step.Status,
		input, output, nullable(step.Error), ts(step.StartedAt), ts(step.FinishedAt),
	)
	return err
}

/* ------------------------------------------------------------- connections */

// ConnectedAccounts maps each MCP server slug the user has connected (and
// that is still enabled) to its Composio connected account id. The id can be
// empty for servers that need none.
func (s *Store) ConnectedAccounts(ctx context.Context, userID string) (map[string]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT s.slug, c."externalAccountId"
		FROM "UserMcpConnection" AS c
		JOIN "McpServer" AS s ON s.id = c."serverId"
		WHERE c."userId" = $1 AND c.status = 'CONNECTED' AND s."isEnabled" = true`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	accounts := map[string]string{}
	for rows.Next() {
		var slug string
		var account *string
		if err := rows.Scan(&slug, &account); err != nil {
			return nil, err
		}
		if account != nil {
			accounts[slug] = *account
		} else {
			accounts[slug] = ""
		}
	}
	return accounts, rows.Err()
}

/* ----------------------------------------------------------------- helpers */

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// encodeJSON renders a value for a jsonb column; nil becomes SQL NULL.
func encodeJSON(value any) (*string, error) {
	if value == nil {
		return nil, nil
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("encode JSON: %w", err)
	}
	// jsonb rejects the NUL character outright, and tool output scraped from
	// the web occasionally contains one. Stripping it beats losing the whole
	// step record.
	if bytes.Contains(encoded, []byte(`\u0000`)) {
		encoded, err = json.Marshal(stripNUL(value))
		if err != nil {
			return nil, fmt.Errorf("encode JSON: %w", err)
		}
	}
	text := string(encoded)
	return &text, nil
}

func stripNUL(value any) any {
	switch v := value.(type) {
	case string:
		return strings.ReplaceAll(v, "\x00", "")
	case []any:
		out := make([]any, len(v))
		for i, entry := range v {
			out[i] = stripNUL(entry)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(v))
		for key, entry := range v {
			out[strings.ReplaceAll(key, "\x00", "")] = stripNUL(entry)
		}
		return out
	default:
		return v
	}
}
