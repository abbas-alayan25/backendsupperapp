import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, type SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { TenantSpanProcessor } from './tenant-span-processor.js';

export const METRICS_PORT = 9464;

export interface TelemetryOptions {
  serviceName: string;
  userIdHashKey: string | Uint8Array;
  metricsPort?: number;
  traceEndpoint?: string;
}

export interface Telemetry {
  shutdown(): Promise<void>;
}

export function startTelemetry(options: TelemetryOptions): Telemetry {
  const spanProcessors: SpanProcessor[] = [new TenantSpanProcessor(options.userIdHashKey)];
  if (options.traceEndpoint) {
    spanProcessors.push(
      new BatchSpanProcessor(new OTLPTraceExporter({ url: options.traceEndpoint })),
    );
  }
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: options.serviceName }),
    metricReader: new PrometheusExporter({ port: options.metricsPort ?? METRICS_PORT }),
    spanProcessors,
    instrumentations: [new HttpInstrumentation(), new PinoInstrumentation()],
  });
  sdk.start();
  return { shutdown: () => sdk.shutdown() };
}
