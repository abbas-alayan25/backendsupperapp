package grpcx

import (
	"context"
	"net"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	testpb "google.golang.org/grpc/interop/grpc_testing"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

const tenant = "0192f5a0-0000-7000-8000-000000000001"

type recordingService struct {
	testpb.UnimplementedTestServiceServer
	seen  chan CallContext
	delay time.Duration
}

func (s *recordingService) EmptyCall(ctx context.Context, _ *testpb.Empty) (*testpb.Empty, error) {
	s.seen <- FromContext(ctx)
	if s.delay > 0 {
		select {
		case <-time.After(s.delay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	return &testpb.Empty{}, nil
}

func start(t *testing.T, delay time.Duration) (*grpc.ClientConn, *recordingService) {
	t.Helper()
	listener := bufconn.Listen(1 << 20)
	server := grpc.NewServer(grpc.ChainUnaryInterceptor(UnaryServerInterceptor()))
	service := &recordingService{seen: make(chan CallContext, 1), delay: delay}
	testpb.RegisterTestServiceServer(server, service)
	healthpb.RegisterHealthServer(server, health.NewServer())
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(server.Stop)
	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return listener.DialContext(ctx) }),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithChainUnaryInterceptor(UnaryClientInterceptor()))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn, service
}

func TestPropagatesCallContext(t *testing.T) {
	conn, service := start(t, 0)
	ctx := WithCallContext(context.Background(), CallContext{
		TenantID:       tenant,
		RequestID:      "req-1",
		IdempotencyKey: "idem-1",
		Traceparent:    "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
	})
	if _, err := testpb.NewTestServiceClient(conn).EmptyCall(ctx, &testpb.Empty{}); err != nil {
		t.Fatal(err)
	}
	got := <-service.seen
	if got.TenantID != tenant || got.RequestID != "req-1" || got.IdempotencyKey != "idem-1" || got.Traceparent == "" {
		t.Fatalf("got %+v", got)
	}
}

func TestClientRefusesCallsWithoutTenant(t *testing.T) {
	conn, _ := start(t, 0)
	_, err := testpb.NewTestServiceClient(conn).EmptyCall(context.Background(), &testpb.Empty{})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("got %v", err)
	}
}

func TestServerRejectsMissingOrInvalidTenant(t *testing.T) {
	listener := bufconn.Listen(1 << 20)
	server := grpc.NewServer(grpc.ChainUnaryInterceptor(UnaryServerInterceptor()))
	testpb.RegisterTestServiceServer(server, &recordingService{seen: make(chan CallContext, 1)})
	go func() { _ = server.Serve(listener) }()
	defer server.Stop()
	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return listener.DialContext(ctx) }),
		grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close() }()
	client := testpb.NewTestServiceClient(conn)
	for _, md := range []metadata.MD{{}, metadata.Pairs(TenantIDKey, "not-a-uuid")} {
		var trailer metadata.MD
		_, err := client.EmptyCall(metadata.NewOutgoingContext(context.Background(), md), &testpb.Empty{}, grpc.Trailer(&trailer))
		if status.Code(err) != codes.PermissionDenied {
			t.Fatalf("got %v", err)
		}
		if got := trailer.Get(ErrorCodeKey); len(got) != 1 || got[0] != "FORBIDDEN" {
			t.Fatalf("trailer %v", trailer)
		}
	}
}

func TestHealthChecksNeedNoTenant(t *testing.T) {
	conn, _ := start(t, 0)
	raw := healthpb.NewHealthClient(conn)
	if _, err := raw.Check(WithCallContext(context.Background(), CallContext{TenantID: tenant}), &healthpb.HealthCheckRequest{}); err != nil {
		t.Fatal(err)
	}
}

func TestDefaultDeadlines(t *testing.T) {
	if DeadlineFor("/ledger.v1.LedgerService/PostEntry") != 300*time.Millisecond {
		t.Fatal("ledger deadline")
	}
	if DeadlineFor("/risk.v1.RiskService/Evaluate") != 300*time.Millisecond {
		t.Fatal("risk deadline")
	}
	if DeadlineFor("/wallet.v1.WalletService/GetWallet") != DefaultDeadline {
		t.Fatal("default deadline")
	}
}

func TestClientAppliesDefaultDeadline(t *testing.T) {
	conn, _ := start(t, 3*time.Second)
	ctx := WithCallContext(context.Background(), CallContext{TenantID: tenant})
	started := time.Now()
	_, err := testpb.NewTestServiceClient(conn).EmptyCall(ctx, &testpb.Empty{})
	if status.Code(err) != codes.DeadlineExceeded {
		t.Fatalf("got %v", err)
	}
	if elapsed := time.Since(started); elapsed < 1500*time.Millisecond || elapsed > 2800*time.Millisecond {
		t.Fatalf("deadline took %s", elapsed)
	}
}
