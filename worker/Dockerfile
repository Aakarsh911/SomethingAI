# Build from the worker/ directory:
#   docker build -t somethingai-worker worker
FROM golang:1.27 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/worker ./cmd/worker

# distroless/static ships CA certificates (Composio and OpenAI are HTTPS) and
# the zone database is compiled into the binary (time/tzdata), so IANA zones
# resolve without an OS package.
FROM gcr.io/distroless/static-debian12
COPY --from=build /out/worker /worker
USER nonroot:nonroot
ENTRYPOINT ["/worker"]
