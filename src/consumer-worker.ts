import { readFile } from 'node:fs/promises';
import { fingerprintForKey, isValidKey } from './shared/credentials.js';

export interface ConsumerStatus {
  status: 'not_started' | 'ok' | 'error';
  last_result: number | null;
  fingerprint: string | null;
  last_checked_at: string | null;
}

interface ConsumerWorkerOptions {
  apiUrl: string;
  keyPath: string;
  fetchFn?: typeof fetch;
  now?: () => Date;
  logger?: (line: string) => void;
}

export class ConsumerWorker {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;
  private readonly log: (line: string) => void;
  private timer: NodeJS.Timeout | undefined;
  private currentStatus: ConsumerStatus = {
    status: 'not_started',
    last_result: null,
    fingerprint: null,
    last_checked_at: null,
  };

  constructor(private readonly options: ConsumerWorkerOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.log = options.logger ?? ((line) => console.log(line));
  }

  start(intervalMs: number): void {
    if (this.timer) return;
    void this.callOnce();
    this.timer = setInterval(() => void this.callOnce(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async callOnce(): Promise<ConsumerStatus> {
    try {
      const key = (await readFile(this.options.keyPath, 'utf8')).trim();
      if (!isValidKey(key)) throw new Error('invalid_consumer_key_file');
      const fingerprint = fingerprintForKey(key);
      const response = await this.fetchFn(`${this.options.apiUrl}/v1/orders`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      this.currentStatus = {
        status: response.status === 200 ? 'ok' : 'error',
        last_result: response.status,
        fingerprint,
        last_checked_at: this.now().toISOString(),
      };
      this.log(JSON.stringify({ event: 'consumer_check', fingerprint, status: response.status }));
    } catch {
      this.currentStatus = {
        status: 'error',
        last_result: null,
        fingerprint: null,
        last_checked_at: this.now().toISOString(),
      };
      this.log(JSON.stringify({ event: 'consumer_check', status: 'error' }));
    }
    return this.currentStatus;
  }

  status(): ConsumerStatus {
    return this.currentStatus;
  }
}
