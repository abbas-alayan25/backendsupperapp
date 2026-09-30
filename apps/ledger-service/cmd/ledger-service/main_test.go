package main

import (
	"context"
	"testing"
	"time"
)

func TestRunStartsAndStops(t *testing.T) {
	t.Setenv("PORT", "0")
	t.Setenv("GRPC_PORT", "0")
	t.Setenv("METRICS_PORT", "0")
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- run(ctx) }()
	time.Sleep(100 * time.Millisecond)
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("run returned %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("run did not stop")
	}
}

func TestRunRejectsInvalidPorts(t *testing.T) {
	t.Setenv("PORT", "not-a-port")
	if err := run(context.Background()); err == nil {
		t.Fatal("expected an error")
	}
}
