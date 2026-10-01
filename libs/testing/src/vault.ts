import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

export const VAULT_TEST_IMAGE = 'hashicorp/vault:2.1.1';

export interface VaultFixture {
  readonly container: StartedTestContainer;
  readonly address: string;
  readonly token: string;
  stop(): Promise<void>;
}

export async function startVault(token = 'test-root'): Promise<VaultFixture> {
  const container = await new GenericContainer(VAULT_TEST_IMAGE)
    .withCommand(['server', '-dev', '-dev-listen-address=0.0.0.0:8200'])
    .withEnvironment({ VAULT_DEV_ROOT_TOKEN_ID: token })
    .withAddedCapabilities('IPC_LOCK')
    .withExposedPorts(8200)
    .withWaitStrategy(Wait.forHttp('/v1/sys/health', 8200).forStatusCode(200))
    .start();
  return {
    container,
    address: `http://${container.getHost()}:${String(container.getMappedPort(8200))}`,
    token,
    stop: async () => {
      await container.stop();
    },
  };
}
