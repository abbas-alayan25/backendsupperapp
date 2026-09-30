package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/test/bufconn"
)

func TestHealthIsAlwaysOK(t *testing.T) {
	handler := NewHealthHandler([]Check{{Name: "db", Fn: func(context.Context) error { return errors.New("down") }}})
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/health", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status %d", recorder.Code)
	}
	if strings.TrimSpace(recorder.Body.String()) != `{"status":"ok"}` {
		t.Fatalf("body %s", recorder.Body.String())
	}
}

func TestReadyReflectsChecks(t *testing.T) {
	cases := []struct {
		name   string
		checks []Check
		status int
		want   ReadinessReport
	}{
		{"no checks", nil, http.StatusOK, ReadinessReport{Status: "ok", Checks: map[string]string{}}},
		{"passing", []Check{{Name: "db", Fn: func(context.Context) error { return nil }}}, http.StatusOK,
			ReadinessReport{Status: "ok", Checks: map[string]string{"db": "ok"}}},
		{"failing", []Check{
			{Name: "db", Fn: func(context.Context) error { return nil }},
			{Name: "kafka", Fn: func(context.Context) error { return errors.New("broker at kafka.internal down") }},
		}, http.StatusServiceUnavailable,
			ReadinessReport{Status: "unavailable", Checks: map[string]string{"db": "ok", "kafka": "failed"}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			NewHealthHandler(tc.checks).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/ready", nil))
			if recorder.Code != tc.status {
				t.Fatalf("status %d", recorder.Code)
			}
			if strings.Contains(recorder.Body.String(), "kafka.internal") {
				t.Fatalf("error details leaked: %s", recorder.Body.String())
			}
			var got ReadinessReport
			if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if got.Status != tc.want.Status || len(got.Checks) != len(tc.want.Checks) {
				t.Fatalf("got %+v want %+v", got, tc.want)
			}
			for name, outcome := range tc.want.Checks {
				if got.Checks[name] != outcome {
					t.Fatalf("check %s: got %s want %s", name, got.Checks[name], outcome)
				}
			}
		})
	}
}

func TestReadinessTimesOutHangingChecks(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	report := EvaluateReadiness(ctx, []Check{{Name: "slow", Fn: func(ctx context.Context) error {
		<-ctx.Done()
		time.Sleep(time.Second)
		return nil
	}}})
	if report.Status != "unavailable" || report.Checks["slow"] != "timeout" {
		t.Fatalf("got %+v", report)
	}
}

func TestGRPCHealthServing(t *testing.T) {
	listener := bufconn.Listen(1 << 20)
	server, healthServer := NewGRPCServer()
	go func() { _ = server.Serve(listener) }()
	defer server.Stop()

	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return listener.DialContext(ctx) }),
		grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close() }()
	client := healthpb.NewHealthClient(conn)

	response, err := client.Check(context.Background(), &healthpb.HealthCheckRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if response.GetStatus() != healthpb.HealthCheckResponse_SERVING {
		t.Fatalf("status %s", response.GetStatus())
	}
	healthServer.Shutdown()
	response, err = client.Check(context.Background(), &healthpb.HealthCheckRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if response.GetStatus() != healthpb.HealthCheckResponse_NOT_SERVING {
		t.Fatalf("status after shutdown %s", response.GetStatus())
	}
}

func TestMetricsEndpoint(t *testing.T) {
	recorder := httptest.NewRecorder()
	NewMetricsHandler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), "go_goroutines") {
		t.Fatalf("status %d body %.200s", recorder.Code, recorder.Body.String())
	}
}

func TestServeStartsAndStopsAllListeners(t *testing.T) {
	cfg := Config{Name: "test", HTTPAddr: "127.0.0.1:0", GRPCAddr: "127.0.0.1:0", MetricsAddr: "127.0.0.1:0"}
	listeners, err := Listen(cfg)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- Serve(ctx, cfg, listeners) }()

	for _, url := range []string{
		"http://" + listeners.HTTP.Addr().String() + "/health",
		"http://" + listeners.Metrics.Addr().String() + "/metrics",
	} {
		response, err := http.Get(url)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, response.Body)
		_ = response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("%s returned %d", url, response.StatusCode)
		}
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("serve returned %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("serve did not stop")
	}
	if response, err := http.Get("http://" + listeners.HTTP.Addr().String() + "/health"); err == nil {
		_ = response.Body.Close()
		t.Fatal("http listener still open after shutdown")
	}
}

func TestConfigFromEnv(t *testing.T) {
	t.Setenv("PORT", "4100")
	t.Setenv("GRPC_PORT", "")
	t.Setenv("METRICS_PORT", "19400")
	cfg, err := ConfigFromEnv("svc")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.HTTPAddr != ":4100" || cfg.GRPCAddr != ":50051" || cfg.MetricsAddr != ":19400" {
		t.Fatalf("got %+v", cfg)
	}
	t.Setenv("PORT", "70000")
	if _, err := ConfigFromEnv("svc"); err == nil {
		t.Fatal("expected invalid port error")
	}
}
