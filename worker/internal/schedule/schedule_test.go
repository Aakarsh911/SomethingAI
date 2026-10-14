package schedule

import (
	"testing"
	"time"
)

func TestNextFollowsDST(t *testing.T) {
	cases := []struct {
		after, want string
	}{
		// First Thursday of 2026 after New Year: EST, UTC-5.
		{"2026-01-01T00:00:00Z", "2026-01-01T14:00:00Z"},
		// July: EDT, UTC-4. Same 09:00 local, an hour earlier in UTC.
		{"2026-07-01T00:00:00Z", "2026-07-02T13:00:00Z"},
	}
	for _, tc := range cases {
		after, _ := time.Parse(time.RFC3339, tc.after)
		got, err := Next("0 9 * * 4", "America/New_York", after)
		if err != nil {
			t.Fatal(err)
		}
		if got.Format(time.RFC3339) != tc.want {
			t.Errorf("after %s: got %s, want %s", tc.after, got.Format(time.RFC3339), tc.want)
		}
		if got.Location() != time.UTC {
			t.Errorf("location = %v, want UTC", got.Location())
		}
	}
}

func TestNextIsStrictlyAfter(t *testing.T) {
	at, _ := time.Parse(time.RFC3339, "2026-03-10T09:00:00Z")
	got, err := Next("0 9 * * *", "UTC", at)
	if err != nil {
		t.Fatal(err)
	}
	if want := "2026-03-11T09:00:00Z"; got.Format(time.RFC3339) != want {
		t.Errorf("got %s, want %s", got.Format(time.RFC3339), want)
	}
}

func TestNextRejectsBadInput(t *testing.T) {
	if _, err := Next("0 9 * * *", "Mars/Phobos", time.Now()); err == nil {
		t.Error("accepted a nonsense timezone")
	}
	if _, err := Next("every day", "UTC", time.Now()); err == nil {
		t.Error("accepted a nonsense expression")
	}
}
