FROM golang:1.24-alpine AS builder

WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o allay-agent ./cmd/agent

FROM eclipse-temurin:21-jre-alpine

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /opt/allay-agent

COPY --from=builder /build/allay-agent .

RUN mkdir -p data/servers data/backups data/jars

EXPOSE 4000

ENTRYPOINT ["./allay-agent"]
