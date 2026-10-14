package engine

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// undefinedValue is what a template yields for a missing key. Unlike nil
// (JSON null), a tool argument resolving to it is dropped, and a condition
// reads it as "undefined".
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

// aliases maps older spellings of {{previous.output}}, still present in saved
// workflows, to the current one.
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
			// JSON has no undefined; in an array it becomes null.
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
	// A lone placeholder yields the raw value, so objects and numbers keep
	// their type.
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
		return Stringify(resolved)
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
			index, err := strconv.Atoi(part)
			if err != nil {
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

// Stringify renders a value for splicing into text: objects as indented JSON,
// missing values as "".
func Stringify(value any) string {
	switch v := value.(type) {
	case nil, undefinedValue:
		return ""
	case map[string]any, []any:
		return marshalIndent(v)
	default:
		return scalarString(v)
	}
}

// jsString is JavaScript's String(value), which saved conditions and llm
// instructions were written against.
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

// scalarString renders strings, bools and numbers, a float64 without an
// exponent.
func scalarString(value any) string {
	if f, ok := value.(float64); ok {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	return fmt.Sprint(value)
}

// marshalIndent is JSON.stringify(value, null, 2), without HTML escaping.
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

// toNumber reads a number for a comparison. Blank is 0, as in JavaScript.
func toNumber(text string) (float64, bool) {
	s := strings.TrimSpace(text)
	if s == "" {
		return 0, true
	}
	f, err := strconv.ParseFloat(s, 64)
	return f, err == nil
}
