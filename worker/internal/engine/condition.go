package engine

import (
	"fmt"
	"regexp"
	"strings"
)

// ConditionError is a branch condition the grammar cannot evaluate.
type ConditionError struct{ msg string }

func (e *ConditionError) Error() string { return e.msg }

var (
	literalTrue  = regexp.MustCompile(`(?i)^true$`)
	literalFalse = regexp.MustCompile(`(?i)^(false|)$`)
	isNotEmpty   = regexp.MustCompile(`(?i)^is not empty$`)
	comparison   = regexp.MustCompile(`(?i)^(.*?)\s*(==|!=|>=|<=|>|<|\bcontains\b|\bstarts with\b|\bends with\b)\s*(.*)$`)
)

// EvaluateCondition decides which way a branch goes. Conditions come from a
// model, so they are matched against a small fixed grammar instead of being
// executed, and anything outside it is an error rather than a silent false.
func EvaluateCondition(condition string, scope Scope) (bool, error) {
	value, err := Resolve(condition, scope)
	if err != nil {
		return false, err
	}
	resolved := strings.TrimSpace(jsString(value))

	if literalTrue.MatchString(resolved) {
		return true, nil
	}
	if literalFalse.MatchString(resolved) {
		return false, nil
	}

	match := comparison.FindStringSubmatch(resolved)
	if match == nil {
		if isNotEmpty.MatchString(resolved) {
			return false, nil
		}
		return false, &ConditionError{msg: fmt.Sprintf(
			"Cannot evaluate the branch condition %q. Supported forms are true/false, ==, !=, >, <, >=, <=, contains, starts with and ends with.",
			condition,
		)}
	}

	left := unquote(match[1])
	operator := strings.ToLower(match[2])
	right := unquote(match[3])

	switch operator {
	case "==":
		return left == right, nil
	case "!=":
		return left != right, nil
	case "contains":
		return strings.Contains(left, right), nil
	case "starts with":
		return strings.HasPrefix(left, right), nil
	case "ends with":
		return strings.HasSuffix(left, right), nil
	}

	a, okA := toNumber(left)
	b, okB := toNumber(right)
	if !okA || !okB {
		return false, &ConditionError{msg: fmt.Sprintf(
			"Branch condition %q compares values that are not numbers.", condition,
		)}
	}

	switch operator {
	case ">":
		return a > b, nil
	case "<":
		return a < b, nil
	case ">=":
		return a >= b, nil
	default:
		return a <= b, nil
	}
}

func unquote(value string) string {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) >= 2 {
		first, last := trimmed[0], trimmed[len(trimmed)-1]
		if (first == '"' || first == '\'') && first == last {
			return trimmed[1 : len(trimmed)-1]
		}
	}
	return trimmed
}
