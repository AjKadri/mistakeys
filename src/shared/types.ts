export type KeyState = 'pending' | 'active' | 'revoked';

export type RotationStatus = 'success' | 'failed' | 'failed_needs_human';

export type RotationStepName =
  | 'issue_replacement'
  | 'update_consumer'
  | 'verify_new_works'
  | 'activate_replacement'
  | 'revoke_old_key'
  | 'verify_old_rejected';

export interface KeyRecord {
  hash: string;
  fingerprint: string;
  state: KeyState;
  created_at: string;
  activated_at?: string;
  revoked_at?: string;
}

export interface RotationStepResult {
  step: RotationStepName;
  ok: boolean;
  at: string;
  fingerprint?: string;
  outcome: string;
}

export interface RotationResult {
  status: RotationStatus;
  credential_id: string;
  leaked_fingerprint: string;
  new_fingerprint?: string;
  overlap_seconds?: number;
  overlap_exceeded?: boolean;
  failed_step?: RotationStepName;
  steps: RotationStepResult[];
}

export interface HandledRotation {
  leaked_fingerprint: string;
  result: RotationResult;
  recorded_at: string;
}

export interface CredentialRecord {
  credential_id: string;
  consumer: string;
  keys: KeyRecord[];
  rotations: HandledRotation[];
}

export interface RegistryFile {
  version: 1;
  credentials: Record<string, CredentialRecord>;
}

export interface PublicKeyRecord {
  fingerprint: string;
  state: KeyState;
  created_at: string;
  activated_at?: string;
  revoked_at?: string;
}
