import { readFile } from 'node:fs/promises';
import { atomicWriteJson, atomicWriteText, appendJsonLine, readJsonFile, safeErrorMessage } from './shared/files.js';
import { createKey, fingerprintForKey, hashKey, isFingerprint, isValidKey } from './shared/credentials.js';
import type {
  CredentialRecord,
  HandledRotation,
  KeyRecord,
  PublicKeyRecord,
  RegistryFile,
  RotationResult,
  RotationStepName,
  RotationStepResult,
} from './shared/types.js';

interface RotatorServiceOptions {
  registryPath: string;
  auditLogPath: string;
  consumerKeyPath: string;
  apiUrl: string;
  maxOverlapSeconds: number;
  fetchFn?: typeof fetch;
  now?: () => Date;
  logger?: (line: string) => void;
}

interface IssuedReplacement {
  credential_id: string;
  fingerprint: string;
  state: 'pending';
  rawKey: string;
}

interface OperationResult {
  ok: boolean;
  fingerprint?: string;
  outcome: string;
}

export interface AlreadyHandledResult {
  status: 'already_handled';
  credential_id: string;
  leaked_fingerprint: string;
  earlier_result: RotationResult;
}

export class RotatorOperationError extends Error {
  constructor(
    message: string,
    public readonly httpStatus = 409,
  ) {
    super(message);
  }
}

class RotationStepFailure extends Error {
  constructor(
    public readonly step: RotationStepName,
    message: string,
  ) {
    super(message);
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function nowIso(now: () => Date): string {
  return now().toISOString();
}

export class RotatorService {
  private registry: RegistryFile | undefined;
  private readonly keyMaterial = new Map<string, string>();
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;
  private readonly log: (line: string) => void;

  constructor(private readonly options: RotatorServiceOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.log = options.logger ?? ((line) => console.log(line));
  }

  async init(): Promise<void> {
    try {
      this.registry = await readJsonFile<RegistryFile>(this.options.registryPath);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      this.registry = { version: 1, credentials: {} };
    }

    const credential = this.registry.credentials['orders-api'];
    if (!credential) {
      const rawKey = createKey();
      const keyRecord: KeyRecord = {
        hash: hashKey(rawKey),
        fingerprint: fingerprintForKey(rawKey),
        state: 'active',
        created_at: nowIso(this.now),
        activated_at: nowIso(this.now),
      };
      this.registry.credentials['orders-api'] = {
        credential_id: 'orders-api',
        consumer: 'orders-worker',
        keys: [keyRecord],
        rotations: [],
      };
      this.keyMaterial.set(keyRecord.fingerprint, rawKey);
      await atomicWriteText(this.options.consumerKeyPath, rawKey);
      await this.saveRegistry();
      this.log(JSON.stringify({ event: 'credential_seeded', credential_id: 'orders-api', fingerprint: keyRecord.fingerprint }));
      return;
    }

    try {
      const rawKey = (await readFile(this.options.consumerKeyPath, 'utf8')).trim();
      if (isValidKey(rawKey)) this.keyMaterial.set(fingerprintForKey(rawKey), rawKey);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }

  async issueReplacement(credentialId: string): Promise<IssuedReplacement> {
    const credential = this.credential(credentialId);
    const rawKey = createKey();
    const keyRecord: KeyRecord = {
      hash: hashKey(rawKey),
      fingerprint: fingerprintForKey(rawKey),
      state: 'pending',
      created_at: nowIso(this.now),
    };
    credential.keys.push(keyRecord);
    this.keyMaterial.set(keyRecord.fingerprint, rawKey);
    await this.saveRegistry();
    return {
      credential_id: credentialId,
      fingerprint: keyRecord.fingerprint,
      state: 'pending',
      rawKey,
    };
  }

  async activateReplacement(credentialId: string, fingerprint: string): Promise<OperationResult> {
    const key = this.key(credentialId, fingerprint);
    if (key.state === 'revoked') throw new RotatorOperationError('revoked_key_cannot_be_activated');
    if (key.state === 'active') return { ok: true, fingerprint, outcome: 'already_active' };
    key.state = 'active';
    key.activated_at = nowIso(this.now);
    await this.saveRegistry();
    return { ok: true, fingerprint, outcome: 'activated' };
  }

  async updateConsumer(credentialId: string, fingerprint: string): Promise<OperationResult> {
    const key = this.key(credentialId, fingerprint);
    if (key.state === 'revoked') throw new RotatorOperationError('revoked_key_cannot_update_consumer');
    if (key.state !== 'pending') throw new RotatorOperationError('replacement_must_be_pending');
    const rawKey = this.keyMaterial.get(fingerprint);
    if (!rawKey) throw new RotatorOperationError('replacement_key_material_unavailable', 500);
    await atomicWriteText(this.options.consumerKeyPath, rawKey);
    return { ok: true, fingerprint, outcome: 'consumer_updated' };
  }

  async verifyNewWorks(credentialId: string): Promise<OperationResult> {
    const rawKey = await readFile(this.options.consumerKeyPath, 'utf8').then((value) => value.trim());
    const fingerprint = fingerprintForKey(rawKey);
    const status = await this.callOrdersApi(rawKey);
    if (status !== 200) throw new RotatorOperationError(`new_key_api_status_${status}`);
    const key = this.key(credentialId, fingerprint);
    if (key.state === 'revoked') throw new RotatorOperationError('new_key_is_revoked');
    return { ok: true, fingerprint, outcome: 'api_returned_200' };
  }

  async revokeOldKey(credentialId: string, fingerprint: string): Promise<OperationResult> {
    const key = this.key(credentialId, fingerprint);
    if (key.state === 'revoked') return { ok: true, fingerprint, outcome: 'already_revoked' };
    if (key.state !== 'active') throw new RotatorOperationError('only_active_keys_can_be_revoked');
    key.state = 'revoked';
    key.revoked_at = nowIso(this.now);
    await this.saveRegistry();
    return { ok: true, fingerprint, outcome: 'revoked' };
  }

  async verifyOldRejected(credentialId: string, fingerprint: string): Promise<OperationResult> {
    this.key(credentialId, fingerprint);
    const rawKey = this.keyMaterial.get(fingerprint);
    if (!rawKey) throw new RotatorOperationError('old_key_material_unavailable', 500);
    const status = await this.callOrdersApi(rawKey);
    if (status !== 401) throw new RotatorOperationError(`old_key_api_status_${status}`);
    return { ok: true, fingerprint, outcome: 'api_returned_401' };
  }

  async rotate(credentialId: string, leakedFingerprint: string): Promise<RotationResult | AlreadyHandledResult> {
    if (!isFingerprint(leakedFingerprint)) throw new RotatorOperationError('invalid_leaked_fingerprint', 400);
    const credential = this.credential(credentialId);
    const handled = credential.rotations.find((rotation) => rotation.leaked_fingerprint === leakedFingerprint);
    if (handled) {
      return {
        status: 'already_handled',
        credential_id: credentialId,
        leaked_fingerprint: leakedFingerprint,
        earlier_result: handled.result,
      };
    }

    const oldKey = this.key(credentialId, leakedFingerprint);
    if (oldKey.state !== 'active') throw new RotatorOperationError('leaked_key_not_active');

    const steps: RotationStepResult[] = [];
    let newFingerprint: string | undefined;
    let overlapSeconds: number | undefined;
    let overlapExceeded = false;
    let revoked = false;
    let activeStep: RotationStepName = 'issue_replacement';
    const issuedAt = this.now().getTime();

    const runStep = async <T extends OperationResult>(step: RotationStepName, operation: () => Promise<T>): Promise<T> => {
      activeStep = step;
      try {
        const result = await operation();
        steps.push({
          step,
          ok: true,
          at: nowIso(this.now),
          ...(result.fingerprint ? { fingerprint: result.fingerprint } : {}),
          outcome: result.outcome,
        });
        return result;
      } catch (error) {
        steps.push({ step, ok: false, at: nowIso(this.now), outcome: safeErrorMessage(error) });
        throw new RotationStepFailure(step, safeErrorMessage(error));
      }
    };

    let result: RotationResult;
    try {
      await runStep('issue_replacement', async () => {
        const replacement = await this.issueReplacement(credentialId);
        newFingerprint = replacement.fingerprint;
        return { ok: true, fingerprint: replacement.fingerprint, outcome: 'replacement_pending' };
      });
      await runStep('update_consumer', () => this.updateConsumer(credentialId, newFingerprint!));
      await runStep('verify_new_works', () => this.verifyNewWorks(credentialId));
      await runStep('activate_replacement', () => this.activateReplacement(credentialId, newFingerprint!));
      overlapSeconds = (this.now().getTime() - issuedAt) / 1000;
      overlapExceeded = overlapSeconds >= this.options.maxOverlapSeconds;
      await runStep('revoke_old_key', () => this.revokeOldKey(credentialId, leakedFingerprint));
      revoked = true;
      await runStep('verify_old_rejected', () => this.verifyOldRejected(credentialId, leakedFingerprint));
      result = {
        status: 'success',
        credential_id: credentialId,
        leaked_fingerprint: leakedFingerprint,
        new_fingerprint: newFingerprint,
        overlap_seconds: overlapSeconds,
        overlap_exceeded: overlapExceeded,
        steps,
      };
    } catch (error) {
      const failedStep = error instanceof RotationStepFailure ? error.step : activeStep;
      result = {
        status: revoked ? 'failed_needs_human' : 'failed',
        credential_id: credentialId,
        leaked_fingerprint: leakedFingerprint,
        ...(newFingerprint ? { new_fingerprint: newFingerprint } : {}),
        ...(overlapSeconds !== undefined ? { overlap_seconds: overlapSeconds } : {}),
        ...(overlapSeconds !== undefined ? { overlap_exceeded: overlapExceeded } : {}),
        failed_step: failedStep,
        steps,
      };
    }

    const handledRotation: HandledRotation = {
      leaked_fingerprint: leakedFingerprint,
      result,
      recorded_at: nowIso(this.now),
    };
    await appendJsonLine(this.options.auditLogPath, {
      recorded_at: handledRotation.recorded_at,
      credential_id: credentialId,
      leaked_fingerprint: leakedFingerprint,
      new_fingerprint: result.new_fingerprint,
      steps: result.steps,
      final_status: result.status,
      overlap_seconds: result.overlap_seconds,
      overlap_exceeded: result.overlap_exceeded,
    });
    credential.rotations.push(handledRotation);
    await this.saveRegistry();
    return result;
  }

  status(credentialId: string): {
    credential_id: string;
    consumer: string;
    keys: PublicKeyRecord[];
    rotations: HandledRotation[];
  } {
    const credential = this.credential(credentialId);
    return {
      credential_id: credential.credential_id,
      consumer: credential.consumer,
      keys: credential.keys.map(({ hash: _hash, ...publicKey }) => publicKey),
      rotations: credential.rotations,
    };
  }

  private credential(credentialId: string): CredentialRecord {
    if (!this.registry) throw new RotatorOperationError('rotator_not_initialized', 503);
    const credential = this.registry.credentials[credentialId];
    if (!credential) throw new RotatorOperationError('credential_not_found', 404);
    return credential;
  }

  private key(credentialId: string, fingerprint: string): KeyRecord {
    const key = this.credential(credentialId).keys.find((candidate) => candidate.fingerprint === fingerprint);
    if (!key) throw new RotatorOperationError('fingerprint_not_found', 404);
    return key;
  }

  private async saveRegistry(): Promise<void> {
    if (!this.registry) throw new RotatorOperationError('rotator_not_initialized', 503);
    await atomicWriteJson(this.options.registryPath, this.registry);
  }

  private async callOrdersApi(rawKey: string): Promise<number> {
    const response = await this.fetchFn(`${this.options.apiUrl}/v1/orders`, {
      headers: { Authorization: `Bearer ${rawKey}` },
    });
    return response.status;
  }
}
