// Package schedule computes a cron expression's next run in an IANA zone, as
// UTC. The zone is applied at evaluation, so 09:00 stays 09:00 across DST.
// The app computes the first nextRunAt on save; the worker computes the rest.
package schedule

import (
	"fmt"
	"time"

	"github.com/robfig/cron/v3"
)

var parser = cron.NewParser(
	cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow | cron.Descriptor,
)

// Next returns the first firing strictly after `after`, in UTC.
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
