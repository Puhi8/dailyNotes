FROM golang:1.24 AS builder

WORKDIR /src

COPY api/go.mod api/go.sum ./
RUN go mod download

COPY api/cmd ./cmd
COPY api/internal ./internal

ARG TARGETOS=linux
ARG TARGETARCH=amd64
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/dailynotes-api ./cmd/api

FROM gcr.io/distroless/static-debian12

LABEL org.opencontainers.image.source="https://github.com/Puhi8/dailyNotes"
LABEL org.opencontainers.image.description="Offline-first daily notes and tracking app with an optional backup API."
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app
COPY --from=builder /out/dailynotes-api /app/dailynotes-api

EXPOSE 5789
VOLUME ["/data"]

ENTRYPOINT ["/app/dailynotes-api"]
CMD ["/data"]
