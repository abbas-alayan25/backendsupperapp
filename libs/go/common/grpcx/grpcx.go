package grpcx

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

const (
	TenantIDKey       = "tenant-id"
	RequestIDKey      = "request-id"
	TraceparentKey    = "traceparent"
	IdempotencyKeyKey = "idempotency-key"
	ErrorCodeKey      = "error-code"
	DefaultDeadline   = 2 * time.Second
	healthServicePath = "/grpc.health.v1.Health/"
)

var serviceDeadlines = map[string]time.Duration{
	"ledger.v1.LedgerService": 300 * time.Millisecond,
	"risk.v1.RiskService":     300 * time.Millisecond,
}

type contextKey int

const (
	tenantContextKey contextKey = iota
	requestContextKey
	idempotencyContextKey
	traceparentContextKey
)

type CallContext struct {
	TenantID       string
	RequestID      string
	IdempotencyKey string
	Traceparent    string
}

func WithCallContext(ctx context.Context, call CallContext) context.Context {
	ctx = context.WithValue(ctx, tenantContextKey, call.TenantID)
	ctx = context.WithValue(ctx, requestContextKey, call.RequestID)
	ctx = context.WithValue(ctx, idempotencyContextKey, call.IdempotencyKey)
	return context.WithValue(ctx, traceparentContextKey, call.Traceparent)
}

func FromContext(ctx context.Context) CallContext {
	value := func(key contextKey) string {
		text, _ := ctx.Value(key).(string)
		return text
	}
	return CallContext{
		TenantID:       value(tenantContextKey),
		RequestID:      value(requestContextKey),
		IdempotencyKey: value(idempotencyContextKey),
		Traceparent:    value(traceparentContextKey),
	}
}

func TenantID(ctx context.Context) (string, bool) {
	tenantID := FromContext(ctx).TenantID
	return tenantID, tenantID != ""
}

func ServiceName(fullMethod string) string {
	trimmed := strings.TrimPrefix(fullMethod, "/")
	service, _, _ := strings.Cut(trimmed, "/")
	return service
}

func DeadlineFor(fullMethod string) time.Duration {
	if deadline, ok := serviceDeadlines[ServiceName(fullMethod)]; ok {
		return deadline
	}
	return DefaultDeadline
}

func first(md metadata.MD, key string) string {
	values := md.Get(key)
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func forbidden(reason string) error {
	return status.Error(codes.PermissionDenied, reason)
}

func UnaryServerInterceptor() grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		if strings.HasPrefix(info.FullMethod, healthServicePath) {
			return handler(ctx, req)
		}
		md, _ := metadata.FromIncomingContext(ctx)
		tenantID := strings.ToLower(first(md, TenantIDKey))
		if _, err := uuid.Parse(tenantID); err != nil || tenantID == "" {
			_ = grpc.SetTrailer(ctx, metadata.Pairs(ErrorCodeKey, "FORBIDDEN"))
			return nil, forbidden("TENANT_UNRESOLVED")
		}
		requestID := first(md, RequestIDKey)
		if requestID == "" {
			requestID = uuid.NewString()
		}
		return handler(WithCallContext(ctx, CallContext{
			TenantID:       tenantID,
			RequestID:      requestID,
			IdempotencyKey: first(md, IdempotencyKeyKey),
			Traceparent:    first(md, TraceparentKey),
		}), req)
	}
}

func UnaryClientInterceptor() grpc.UnaryClientInterceptor {
	return func(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
		call := FromContext(ctx)
		if call.TenantID == "" {
			return status.Error(codes.FailedPrecondition, "no tenant in the calling context")
		}
		pairs := []string{TenantIDKey, call.TenantID}
		for key, value := range map[string]string{
			RequestIDKey:      call.RequestID,
			IdempotencyKeyKey: call.IdempotencyKey,
			TraceparentKey:    call.Traceparent,
		} {
			if value != "" {
				pairs = append(pairs, key, value)
			}
		}
		ctx = metadata.AppendToOutgoingContext(ctx, pairs...)
		if _, ok := ctx.Deadline(); !ok {
			var cancel context.CancelFunc
			ctx, cancel = context.WithTimeout(ctx, DeadlineFor(method))
			defer cancel()
		}
		return invoker(ctx, method, req, reply, cc, opts...)
	}
}
