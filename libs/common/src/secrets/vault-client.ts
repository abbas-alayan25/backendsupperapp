export interface VaultClientOptions {
  readonly address: string;
  readonly token: string;
  readonly kvMount?: string;
  readonly transitMount?: string;
  readonly timeoutMs?: number;
}

export class VaultError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
  ) {
    super(`Vault ${operation} failed with status ${String(status)}`);
    this.name = 'VaultError';
  }
}

const SAFE_PATH = /^[A-Za-z0-9._/-]+$/;

function checkPath(path: string): string {
  if (!SAFE_PATH.test(path) || path.includes('..')) {
    throw new RangeError(`Invalid Vault path ${path}`);
  }
  return path;
}

export class VaultClient {
  private readonly kvMount: string;
  private readonly transitMount: string;

  constructor(private readonly options: VaultClientOptions) {
    this.kvMount = options.kvMount ?? 'secret';
    this.transitMount = options.transitMount ?? 'transit';
  }

  async readKv(path: string): Promise<Record<string, string> | undefined> {
    const response = await this.request('GET', `${this.kvMount}/data/${checkPath(path)}`);
    if (response.status === 404) {
      return undefined;
    }
    const body = (await response.json()) as { data: { data: Record<string, string> } };
    return body.data.data;
  }

  async writeKv(path: string, data: Record<string, string>): Promise<void> {
    await this.request('POST', `${this.kvMount}/data/${checkPath(path)}`, { data });
  }

  async encrypt(keyName: string, plaintext: Buffer): Promise<string> {
    const response = await this.request(
      'POST',
      `${this.transitMount}/encrypt/${checkPath(keyName)}`,
      {
        plaintext: plaintext.toString('base64'),
      },
    );
    const body = (await response.json()) as { data: { ciphertext: string } };
    return body.data.ciphertext;
  }

  async decrypt(keyName: string, ciphertext: string): Promise<Buffer> {
    const response = await this.request(
      'POST',
      `${this.transitMount}/decrypt/${checkPath(keyName)}`,
      {
        ciphertext,
      },
    );
    const body = (await response.json()) as { data: { plaintext: string } };
    return Buffer.from(body.data.plaintext, 'base64');
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const response = await fetch(`${this.options.address}/v1/${path}`, {
      method,
      headers: { 'X-Vault-Token': this.options.token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 5_000),
    });
    if (!response.ok && !(method === 'GET' && response.status === 404)) {
      throw new VaultError(`${method} ${path.split('/')[0] ?? ''}`, response.status);
    }
    return response;
  }
}
