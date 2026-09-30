package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"superapp/libs/go/common/server"
)

const serviceName = "ledger-service"

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := run(ctx); err != nil {
		slog.Error("service failed", "service", serviceName, "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	cfg, err := server.ConfigFromEnv(serviceName)
	if err != nil {
		return err
	}
	return server.Run(ctx, cfg)
}
