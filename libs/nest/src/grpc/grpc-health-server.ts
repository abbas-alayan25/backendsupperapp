import {
  Server,
  ServerCredentials,
  type ServiceDefinition,
  type UntypedServiceImplementation,
} from '@grpc/grpc-js';
import { HealthImplementation } from 'grpc-health-check';

export const GRPC_PORT = 50051;

export type ServingStatus = 'SERVING' | 'NOT_SERVING';

export interface GrpcServiceBinding {
  readonly definition: ServiceDefinition;
  readonly implementation: UntypedServiceImplementation;
}

export interface GrpcHealthServer {
  readonly port: number;
  setStatus(status: ServingStatus, service?: string): void;
  shutdown(): Promise<void>;
}

export async function startGrpcHealthServer(options: {
  port: number;
  host?: string;
  services?: readonly GrpcServiceBinding[];
}): Promise<GrpcHealthServer> {
  const server = new Server();
  const health = new HealthImplementation({ '': 'SERVING' });
  health.addToServer(server);
  for (const service of options.services ?? []) {
    server.addService(service.definition, service.implementation);
  }
  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync(
      `${options.host ?? '0.0.0.0'}:${String(options.port)}`,
      ServerCredentials.createInsecure(),
      (error, boundPort) => {
        if (error) {
          reject(error);
        } else {
          resolve(boundPort);
        }
      },
    );
  });
  return {
    port,
    setStatus: (status, service = '') => {
      health.setStatus(service, status);
    },
    shutdown: () =>
      new Promise<void>((resolve) => {
        health.setStatus('', 'NOT_SERVING');
        server.tryShutdown(() => {
          resolve();
        });
      }),
  };
}
