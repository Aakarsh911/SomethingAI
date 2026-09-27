// Package dotenv loads the app's .env for local development, so the worker
// and `npm run dev` read the same DATABASE_URL and keys without duplicating
// them. Variables already set in the environment win; in production nothing
// is loaded because there is no file.
package dotenv

import (
	"bufio"
	"os"
	"strings"
)

// Load reads the first of paths that exists. A missing file is not an error.
func Load(paths ...string) (loaded string, err error) {
	for _, path := range paths {
		file, err := os.Open(path)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return "", err
		}
		defer file.Close()

		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			key, value, ok := parseLine(scanner.Text())
			if !ok {
				continue
			}
			if _, set := os.LookupEnv(key); !set {
				os.Setenv(key, value)
			}
		}
		return path, scanner.Err()
	}
	return "", nil
}

func parseLine(line string) (key, value string, ok bool) {
	line = strings.TrimSpace(line)
	if line == "" || strings.HasPrefix(line, "#") {
		return "", "", false
	}
	line = strings.TrimPrefix(line, "export ")
	key, value, ok = strings.Cut(line, "=")
	if !ok {
		return "", "", false
	}
	key = strings.TrimSpace(key)
	value = strings.TrimSpace(value)

	if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') {
		quote := value[0]
		if end := strings.IndexByte(value[1:], quote); end >= 0 {
			value = value[1 : end+1]
			if quote == '"' {
				value = strings.ReplaceAll(value, `\n`, "\n")
			}
			return key, value, key != ""
		}
	}
	// Unquoted: a " #" starts a trailing comment.
	if i := strings.Index(value, " #"); i >= 0 {
		value = strings.TrimSpace(value[:i])
	}
	return key, value, key != ""
}
