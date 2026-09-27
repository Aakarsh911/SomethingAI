// Package schedule turns a cron expression plus an IANA zone into the next
// UTC instant.
//
// The zone is applied at evaluation time rather than baked in as an offset,
// so "0 9 * * 4" in America/New_York is 14:00Z in January and 13:00Z in July —
// 09:00 local both times. src/lib/workflows/schedule.ts computes the first
// nextRunAt when a workflow is saved; this computes every one after that.
package schedule

import (
	"fmt"
	"time"

	"github.com/robfig/cron/v3"
)

var parser = cron.NewParser(
	cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow | cron.Descriptor,
)

// Next returns the first time strictly after `after` that the schedule fires,
// in UTC.
func Next(expression, timezone string, after time.Time) (time.Time, error) {
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return time.Time{}, fmt.Errorf("%q is not a valid IANA timezone", timezone)
	}
	schedule, err := parser.Parse(expression)
	if err != nil {
		return time.Time{}, fmt.Errorf("%q is not a valid cron expression: %w", expression, err)
	}
	next := schedule.Next(after.In(location))
	if next.IsZero() {
		return time.Time{}, fmt.Errorf("%q never fires", expression)
	}
	return next.UTC(), nil
}
