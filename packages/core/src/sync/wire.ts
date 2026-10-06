/**
 * What crosses the pipe to the sync helper: one JSON request on stdin, one JSON
 * reply on stdout, then the process exits. `apps/desktop/sync-helper` is the
 * other end and must agree with this file.
 */
import {
  CLOUD_ERROR_CODES, CloudError, type CloudErrorCode, type CloudRecord, type CloudValue,
} from './cloud';

export type HelperRequest =
  | { readonly op: 'account' }
  | { readonly op: 'fingerprints'; readonly zone: string }
  | { readonly op: 'fetch'; readonly zone: string; readonly name: string }
  | { readonly op: 'save'; readonly zone: string; readonly records: readonly CloudRecord[]; readonly createZone?: boolean }
  | { readonly op: 'remove'; readonly zone: string; readonly names: readonly string[] }
  | { readonly op: 'dropZone'; readonly zone: string };

export interface HelperReply {
  readonly ok: true;
  readonly account?: string;
  readonly fingerprints?: Readonly<Record<string, string>>;
  /** `fetch`: null when the record or its zone does not exist. */
  readonly record?: { readonly type: string; readonly fields: Readonly<Record<string, CloudValue>> } | null;
}

/** A fetched record as the rest of core sees it; fields the wire cannot carry are dropped, not guessed. */
export function recordFrom(reply: HelperReply, name: string): CloudRecord | undefined {
  const record = reply.record;
  if (!record || typeof record.type !== 'string' || typeof record.fields !== 'object' || record.fields === null) {
    return undefined;
  }
  const fields: Record<string, CloudValue> = {};
  for (const [key, value] of Object.entries(record.fields as Record<string, unknown>)) {
    const v = value as { string?: unknown; int?: unknown };
    if (typeof v?.string === 'string') fields[key] = { string: v.string };
    else if (typeof v?.int === 'number' && Number.isFinite(v.int)) fields[key] = { int: v.int };
  }
  return { type: record.type, name, fields };
}

const DETAIL_CHARS = 400;

/** Throws `CloudError` for a failure the helper named, and for anything that is not a reply at all. */
export function parseReply(stdout: string): HelperReply {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new CloudError('failed', stdout.trim().slice(-DETAIL_CHARS) || 'no reply');
  }
  if (typeof value !== 'object' || value === null) throw new CloudError('failed', 'no reply');

  const reply = value as { ok?: unknown; error?: { code?: unknown; message?: unknown } };
  if (reply.ok === true) return value as HelperReply;

  const code = reply.error?.code;
  const message = typeof reply.error?.message === 'string' ? reply.error.message : undefined;
  throw new CloudError(isCloudErrorCode(code) ? code : 'failed', message);
}

function isCloudErrorCode(code: unknown): code is CloudErrorCode {
  return (CLOUD_ERROR_CODES as readonly unknown[]).includes(code);
}
