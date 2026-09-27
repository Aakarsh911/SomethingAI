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

// EvaluateCondition decides which way a branch goes.
//
// Deliberately not an expression evaluator: conditions come out of a language
// model and are stored in a JSON blob, so executing them as code would make
// every saved workflow a script. The grammar is small on purpose, and anything
// outside it fails loudly rather than defaulting to false — a branch that
// silently always takes one side is worse than one that stops.
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

	a, okA := jsNumber(left)
	b, okB := jsNumber(right)
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
