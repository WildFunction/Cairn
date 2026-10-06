/**
 * The cloud a library syncs to, as the rest of core sees it: zones of named
 * records. CloudKit is the one implementation (`runtime/cloudkit-helper.ts`);
 * nothing that imports this knows that, which is what lets `push.ts` be tested
 * without an Apple account.
 */

export type CloudValue =
  | { readonly string: string }
  | { readonly int: number }
  /** A file on this machine, by absolute path. */
  | { readonly asset: string };

export interface CloudRecord {
  readonly type: string;
  readonly name: string;
  readonly fields: Readonly<Record<string, CloudValue>>;
}

export type CloudAccount = 'available' | 'no_account' | 'restricted' | 'unknown';

export interface CloudStore {
  account(): Promise<CloudAccount>;
  /** One record's fields, or nothing when it or its zone does not exist. Assets are not fetched. */
  read(zone: string, name: string): Promise<CloudRecord | undefined>;
  /** Each record's `fingerprint` field by record name; empty for a zone that does not exist. */
  fingerprints(zone: string): Promise<ReadonlyMap<string, string>>;
  /**
   * A record that already exists is overwritten whole. The zone is created when missing unless
   * `createZone` is false, in which case a missing zone is a `zone_missing` error.
   */
  save(zone: string, records: readonly CloudRecord[], options?: { readonly createZone?: boolean }): Promise<void>;
  remove(zone: string, names: readonly string[]): Promise<void>;
  dropZone(zone: string): Promise<void>;
}

export const CLOUD_ERROR_CODES = [
  'no_account', 'quota_exceeded', 'network', 'rejected', 'incomplete', 'helper_missing', 'zone_missing', 'failed',
] as const;

export type CloudErrorCode = (typeof CLOUD_ERROR_CODES)[number];

/** Only `network` is worth retrying; `rejected` is the server refusing the request as built. */
export class CloudError extends Error {
  constructor(readonly code: CloudErrorCode, readonly detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'CloudError';
  }
}
