package engine

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

// undefinedValue is what a template yields for a key that does not exist.
//
// It is kept distinct from nil (JSON null) because the two behave
// differently downstream, exactly as undefined and null did in the
// TypeScript engine this replaced: a tool argument that resolves to it is
// dropped rather than sent as null, and a branch condition reads it as
// "undefined" rather than "null".
type undefinedValue struct{}

var undefined = undefinedValue{}

// Scope is what templates can read.
type Scope struct {
	// Previous is the output of the last non-branch step.
	Previous any
	// Steps maps node id to output for every step that has run.
	Steps map[string]any
}

// TemplateError is a reference that cannot be resolved.
type TemplateError struct{ msg string }

func (e *TemplateError) Error() string { return e.msg }

func templateErrorf(format string, args ...any) error {
	return &TemplateError{msg: fmt.Sprintf(format, args...)}
}

// aliases normalises the spellings of {{previous.output}} the generator has
// emitted over time. Workflows saved with the older ones are already in the
// database, and normalising here is cheaper than a data migration.
var aliases = map[string]string{
	"previous_step_output": "previous.output",
	"previous_step.output": "previous.output",
	"previousstep.output":  "previous.output",
	"last.output":          "previous.output",
	"previous.output":      "previous.output",
	"output":               "previous.output",
}

var (
	placeholder      = regexp.MustCompile(`\{\{\s*([^{}]+?)\s*\}\}`)
	wholePlaceholder = regexp.MustCompile(`^\{\{\s*([^{}]+?)\s*\}\}$`)
)

// Resolve substitutes {{...}} placeholders anywhere inside value.
func Resolve(value any, scope Scope) (any, error) {
	switch v := value.(type) {
	case string:
		return resolveString(v, scope)
	case []any:
		out := make([]any, len(v))
		for i, entry := range v {
			resolved, err := Resolve(entry, scope)
			if err != nil {
				return nil, err
			}
			// JSON has no undefined; an array slot holding one serialises
			// as null.
			if resolved == undefined {
				resolved = nil
			}
			out[i] = resolved
		}
		return out, nil
	case map[string]any:
		out := make(map[string]any, len(v))
		for key, nested := range v {
			resolved, err := Resolve(nested, scope)
			if err != nil {
				return nil, err
			}
			// A key whose value does not exist is omitted, not sent as null.
			if resolved == undefined {
				continue
			}
			out[key] = resolved
		}
		return out, nil
	default:
		return value, nil
	}
}

func resolveString(value string, scope Scope) (any, error) {
	// A string that is nothing but a placeholder yields the raw value, so an
	// object or a number survives instead of becoming text.
	if whole := wholePlaceholder.FindStringSubmatch(value); whole != nil {
		return lookup(whole[1], scope)
	}

	var firstErr error
	out := placeholder.ReplaceAllStringFunc(value, func(match string) string {
		if firstErr != nil {
			return match
		}
		path := placeholder.FindStringSubmatch(match)[1]
		resolved, err := lookup(path, scope)
		if err != nil {
			firstErr = err
			return match
		}
		if s, ok := resolved.(string); ok {
			return s
		}
		return stringify(resolved)
	})
	if firstErr != nil {
		return nil, firstErr
	}
	return out, nil
}

func lookup(rawPath string, scope Scope) (any, error) {
	path := strings.TrimSpace(rawPath)
	normalized := path
	if alias, ok := aliases[strings.ToLower(path)]; ok {
		normalized = alias
	}

	var parts []string
	for _, part := range strings.Split(normalized, ".") {
		if part != "" {
			parts = append(parts, part)
		}
	}
	if len(parts) == 0 {
		return nil, templateErrorf("Unknown reference \"{{%s}}\".", rawPath)
	}

	switch parts[0] {
	case "previous":
		if len(parts) < 2 || parts[1] != "output" {
			return nil, templateErrorf("Unknown reference \"{{%s}}\".", rawPath)
		}
		return walk(scope.Previous, parts[2:], rawPath)

	case "steps":
		nodeID := ""
		if len(parts) > 1 {
			nodeID = parts[1]
		}
		output, ran := scope.Steps[nodeID]
		if nodeID == "" || !ran {
			return nil, templateErrorf("\"{{%s}}\" refers to step \"%s\", which has not run.", rawPath, nodeID)
		}
		if len(parts) < 3 || parts[2] != "output" {
			return nil, templateErrorf("Unknown reference \"{{%s}}\".", rawPath)
		}
		return walk(output, parts[3:], rawPath)
	}

	return nil, templateErrorf("Unknown reference \"{{%s}}\".", rawPath)
}

func walk(value any, parts []string, rawPath string) (any, error) {
	cursor := value
	for _, part := range parts {
		switch c := cursor.(type) {
		case nil, undefinedValue:
			return nil, templateErrorf("\"{{%s}}\" reads past a missing value.", rawPath)
		case []any:
			index, ok := arrayIndex(part)
			if !ok {
				return nil, templateErrorf("\"{{%s}}\" indexes an array with \"%s\".", rawPath, part)
			}
			if index < 0 || index >= len(c) {
				cursor = undefined
			} else {
				cursor = c[index]
			}
		case map[string]any:
			next, ok := c[part]
			if !ok {
				cursor = undefined
			} else {
				cursor = next
			}
		default:
			return nil, templateErrorf("\"{{%s}}\" reads \"%s\" off a non-object.", rawPath, part)
		}
	}
	return cursor, nil
}

func arrayIndex(part string) (int, bool) {
	f, ok := jsNumber(part)
	if !ok || math.IsInf(f, 0) || f != math.Trunc(f) {
		return 0, false
	}
	if f < math.MinInt32 || f > math.MaxInt32 {
		return -1, true
	}
	return int(f), true
}

// stringify renders a value spliced into the middle of a string.
func stringify(value any) string {
	switch v := value.(type) {
	case nil, undefinedValue:
		return ""
	case map[string]any, []any:
		return marshalIndent(v)
	default:
		return scalarString(v)
	}
}

// jsString is String(value) in JavaScript, which is how a branch condition
// and an llm instruction were coerced. Kept faithful so a saved condition
// evaluates the same way it did before the engine moved.
func jsString(value any) string {
	switch v := value.(type) {
	case nil:
		return "null"
	case undefinedValue:
		return "undefined"
	case map[string]any:
		return "[object Object]"
	case []any:
		parts := make([]string, len(v))
		for i, entry := range v {
			if entry == nil || entry == undefined {
				continue
			}
			parts[i] = jsString(entry)
		}
		return strings.Join(parts, ",")
	default:
		return scalarString(v)
	}
}

func scalarString(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case bool:
		return strconv.FormatBool(v)
	case json.Number:
		return v.String()
	case float64:
		return formatNumber(v)
	case int:
		return strconv.Itoa(v)
	case int64:
		return strconv.FormatInt(v, 10)
	default:
		return fmt.Sprint(v)
	}
}

func formatNumber(f float64) string {
	switch {
	case math.IsNaN(f):
		return "NaN"
	case math.IsInf(f, 1):
		return "Infinity"
	case math.IsInf(f, -1):
		return "-Infinity"
	case math.Abs(f) >= 1e21:
		return strconv.FormatFloat(f, 'g', -1, 64)
	default:
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
}

// marshalIndent is JSON.stringify(value, null, 2): two-space indent, and no
// escaping of <, > and & — this text is read by people and models, not
// embedded in HTML.
func marshalIndent(value any) string {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		return fmt.Sprint(value)
	}
	return strings.TrimSuffix(buf.String(), "\n")
}

var jsDecimal = regexp.MustCompile(`^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$`)

// jsNumber is Number(text) in JavaScript, restricted to the forms a person
// would actually type into a condition. Blank text is 0, as it is there.
func jsNumber(text string) (float64, bool) {
	s := strings.TrimSpace(text)
	if s == "" {
		return 0, true
	}
	switch s {
	case "Infinity", "+Infinity":
		return math.Inf(1), true
	case "-Infinity":
		return math.Inf(-1), true
	}
	lower := strings.ToLower(s)
	for prefix, base := range map[string]int{"0x": 16, "0o": 8, "0b": 2} {
		if strings.HasPrefix(lower, prefix) {
			n, err := strconv.ParseUint(s[2:], base, 64)
			if err != nil {
				return 0, false
			}
			return float64(n), true
		}
	}
	if !jsDecimal.MatchString(s) {
		return 0, false
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		// Out of range still parses to ±Inf in JavaScript.
		if ne, ok := err.(*strconv.NumError); ok && ne.Err == strconv.ErrRange {
			return f, true
		}
		return 0, false
	}
	return f, true
}
