import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';

export const REDIS_TEST_IMAGE = 'redis:8.10.2';

export interface RedisFixture {
  readonly container: StartedRedisContainer;
  readonly url: string;
  stop(): Promise<void>;
}

export async function startRedis(): Promise<RedisFixture> {
  const container = await new RedisContainer(REDIS_TEST_IMAGE).start();
  return {
    container,
    url: container.getConnectionUrl(),
    stop: async () => {
      await container.stop();
    },
  };
}
