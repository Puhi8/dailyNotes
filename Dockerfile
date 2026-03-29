FROM golang:1.24 AS builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal

ARG TARGETOS=linux
ARG TARGETARCH=amd64
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/dailynotes-api ./cmd/api

FROM gcr.io/distroless/static-debian12

WORKDIR /app
COPY --from=builder /out/dailynotes-api /app/dailynotes-api

EXPOSE 5789
VOLUME ["/data"]

ENTRYPOINT ["/app/dailynotes-api"]
CMD ["/data"]
