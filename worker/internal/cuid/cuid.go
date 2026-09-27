// Package cuid mints primary keys for rows the worker inserts.
//
// Prisma's @default(cuid()) is applied by the Prisma client, not by Postgres,
// so a row written from Go has to bring its own id. These match the shape of
// Prisma's — 25 lowercase alphanumerics starting with "c" — so nothing that
// validates or displays ids can tell the two apart. Time-prefixed so ids from
// one worker sort roughly by creation.
package cuid

import (
	"crypto/rand"
	"strconv"
	"strings"
	"time"
)

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"

func New() string {
	var b strings.Builder
	b.Grow(25)
	b.WriteByte('c')

	stamp := strconv.FormatInt(time.Now().UnixMilli(), 36)
	if len(stamp) < 8 {
		stamp = strings.Repeat("0", 8-len(stamp)) + stamp
	}
	b.WriteString(stamp[len(stamp)-8:])

	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		panic(err) // crypto/rand does not fail on supported platforms
	}
	for _, v := range random {
		b.WriteByte(alphabet[int(v)%len(alphabet)])
	}
	return b.String()
}
