package server

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"

	"superapp/libs/go/common/grpcx"
)

const (
	DefaultHTTPPort    = 3000
	DefaultGRPCPort    = 50051
	DefaultMetricsPort = 9464
	shutdownTimeout    = 10 * time.Second
)

type Config struct {
	Name        string
	HTTPAddr    string
	GRPCAddr    string
	MetricsAddr string
	Checks      []Check
	Logger      *slog.Logger
}

func ConfigFromEnv(name string) (Config, error) {
	httpPort, err := portFromEnv("PORT", DefaultHTTPPort)
	if err != nil {
		return Config{}, err
	}
	grpcPort, err := portFromEnv("GRPC_PORT", DefaultGRPCPort)
	if err != nil {
		return Config{}, err
	}
	metricsPort, err := portFromEnv("METRICS_PORT", DefaultMetricsPort)
	if err != nil {
		return Config{}, err
	}
	return Config{
		Name:        name,
		HTTPAddr:    ":" + strconv.Itoa(httpPort),
		GRPCAddr:    ":" + strconv.Itoa(grpcPort),
		MetricsAddr: ":" + strconv.Itoa(metricsPort),
		Logger:      slog.New(slog.NewJSONHandler(os.Stdout, nil)).With("service", name),
	}, nil
}

func portFromEnv(key string, fallback int) (int, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}
	port, err := strconv.Atoi(value)
	if err != nil || port < 0 || port > 65535 {
		return 0, fmt.Errorf("invalid %s %q", key, value)
	}
	return port, nil
}

type Listeners struct {
	HTTP    net.Listener
	GRPC    net.Listener
	Metrics net.Listener
}

func Listen(cfg Config) (Listeners, error) {
	var listeners Listeners
	var err error
	if listeners.HTTP, err = net.Listen("tcp", cfg.HTTPAddr); err != nil {
		return Listeners{}, err
	}
	if listeners.GRPC, err = net.Listen("tcp", cfg.GRPCAddr); err != nil {
		_ = listeners.HTTP.Close()
		return Listeners{}, err
	}
	if listeners.Metrics, err = net.Listen("tcp", cfg.MetricsAddr); err != nil {
		_ = listeners.HTTP.Close()
		_ = listeners.GRPC.Close()
		return Listeners{}, err
	}
	return listeners, nil
}

func NewMetricsHandler() http.Handler {
	registry := prometheus.NewRegistry()
	registry.MustRegister(collectors.NewGoCollector(), collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))
	mux := http.NewServeMux()
	mux.Handle("GET /metrics", promhttp.HandlerFor(registry, promhttp.HandlerOpts{}))
	return mux
}

func NewGRPCServer() (*grpc.Server, *health.Server) {
	server := grpc.NewServer(grpc.ChainUnaryInterceptor(grpcx.UnaryServerInterceptor()))
	healthServer := health.NewServer()
	healthServer.SetServingStatus("", healthpb.HealthCheckResponse_SERVING)
	healthpb.RegisterHealthServer(server, healthServer)
	return server, healthServer
}

func Serve(ctx context.Context, cfg Config, listeners Listeners) error {
	logger := cfg.Logger
	if logger == nil {
		logger = slog.New(slog.DiscardHandler)
	}
	httpServer := &http.Server{Handler: NewHealthHandler(cfg.Checks), ReadHeaderTimeout: 5 * time.Second}
	metricsServer := &http.Server{Handler: NewMetricsHandler(), ReadHeaderTimeout: 5 * time.Second}
	grpcServer, healthServer := NewGRPCServer()

	errs := make(chan error, 3)
	var wg sync.WaitGroup
	serveHTTP := func(server *http.Server, listener net.Listener) {
		defer wg.Done()
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errs <- err
		}
	}
	wg.Add(3)
	go serveHTTP(httpServer, listeners.HTTP)
	go serveHTTP(metricsServer, listeners.Metrics)
	go func() {
		defer wg.Done()
		if err := grpcServer.Serve(listeners.GRPC); err != nil && !errors.Is(err, grpc.ErrServerStopped) {
			errs <- err
		}
	}()
	logger.Info("service started",
		"http", listeners.HTTP.Addr().String(),
		"grpc", listeners.GRPC.Addr().String(),
		"metrics", listeners.Metrics.Addr().String())

	var runErr error
	select {
	case <-ctx.Done():
	case runErr = <-errs:
	}

	logger.Info("shutting down")
	healthServer.Shutdown()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	grpcStopped := make(chan struct{})
	go func() {
		grpcServer.GracefulStop()
		close(grpcStopped)
	}()
	shutdownErr := errors.Join(httpServer.Shutdown(shutdownCtx), metricsServer.Shutdown(shutdownCtx))
	select {
	case <-grpcStopped:
	case <-shutdownCtx.Done():
		grpcServer.Stop()
	}
	wg.Wait()
	return errors.Join(runErr, shutdownErr)
}

func Run(ctx context.Context, cfg Config) error {
	listeners, err := Listen(cfg)
	if err != nil {
		return err
	}
	return Serve(ctx, cfg, listeners)
}
