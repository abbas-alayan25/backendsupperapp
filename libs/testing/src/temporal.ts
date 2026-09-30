import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

export const TEMPORAL_TEST_IMAGE = 'temporalio/temporal:1.9.1';

export interface TemporalFixture {
  readonly container: StartedTestContainer;
  readonly address: string;
  readonly namespace: string;
  stop(): Promise<void>;
}

export async function startTemporal(): Promise<TemporalFixture> {
  const container = await new GenericContainer(TEMPORAL_TEST_IMAGE)
    .withCommand([
      'server',
      'start-dev',
      '--ip',
      '0.0.0.0',
      '--headless',
      '--search-attribute',
      'tenantId=Keyword',
    ])
    .withExposedPorts(7233)
    .withWaitStrategy(Wait.forListeningPorts())
    .withStartupTimeout(120_000)
    .start();
  return {
    container,
    address: `${container.getHost()}:${String(container.getMappedPort(7233))}`,
    namespace: 'default',
    stop: async () => {
      await container.stop();
    },
  };
}
