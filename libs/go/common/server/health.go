package server

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

const checkTimeout = 2 * time.Second

type Check struct {
	Name string
	Fn   func(ctx context.Context) error
}

type ReadinessReport struct {
	Status string            `json:"status"`
	Checks map[string]string `json:"checks"`
}

func EvaluateReadiness(ctx context.Context, checks []Check) ReadinessReport {
	report := ReadinessReport{Status: "ok", Checks: make(map[string]string, len(checks))}
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, check := range checks {
		wg.Add(1)
		go func() {
			defer wg.Done()
			outcome := runCheck(ctx, check)
			mu.Lock()
			defer mu.Unlock()
			report.Checks[check.Name] = outcome
			if outcome != "ok" {
				report.Status = "unavailable"
			}
		}()
	}
	wg.Wait()
	return report
}

func runCheck(ctx context.Context, check Check) string {
	checkCtx, cancel := context.WithTimeout(ctx, checkTimeout)
	defer cancel()
	result := make(chan error, 1)
	go func() {
		result <- check.Fn(checkCtx)
	}()
	select {
	case err := <-result:
		if err != nil {
			return "failed"
		}
		return "ok"
	case <-checkCtx.Done():
		return "timeout"
	}
}

func NewHealthHandler(checks []Check) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /ready", func(w http.ResponseWriter, r *http.Request) {
		report := EvaluateReadiness(r.Context(), checks)
		status := http.StatusOK
		if report.Status != "ok" {
			status = http.StatusServiceUnavailable
		}
		writeJSON(w, status, report)
	})
	return mux
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
