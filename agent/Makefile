BINARY_NAME=allay-agent
BUILD_DIR=bin
VERSION=$(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
LDFLAGS=-ldflags "-s -w -X main.version=$(VERSION)"

.PHONY: all build run test lint clean deps

all: build

deps:
	go mod tidy
	go mod download

build: deps
	CGO_ENABLED=0 go build $(LDFLAGS) -o $(BUILD_DIR)/$(BINARY_NAME) ./cmd/agent

build-linux: deps
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build $(LDFLAGS) -o $(BUILD_DIR)/$(BINARY_NAME)-linux-amd64 ./cmd/agent
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build $(LDFLAGS) -o $(BUILD_DIR)/$(BINARY_NAME)-linux-arm64 ./cmd/agent

run: build
	./$(BUILD_DIR)/$(BINARY_NAME)

test:
	go test ./... -v -race

lint:
	go vet ./...

clean:
	rm -rf $(BUILD_DIR)

dev:
	go run ./cmd/agent
