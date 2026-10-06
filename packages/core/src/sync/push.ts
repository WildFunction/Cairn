import { normalizeEntry } from '../store/library';
import { BOOK_RECORD, type BookSource, bookRecords, planPush, zoneOf } from './book';
import { CloudError, type CloudStore } from './cloud';

export interface PushReport {
  readonly saved: number;
  readonly skipped: number;
  readonly removed: number;
}

/**
 * One record per request: a station is a megabyte of audio, and an upload cut
 * short should cost the station in flight, not the book. Re-running resumes.
 */
export async function pushBook(
  cloud: CloudStore,
  source: BookSource,
  onRecord?: (done: number, total: number) => void,
): Promise<PushReport> {
  if (!normalizeEntry(source.entry).complete) throw new CloudError('incomplete', source.entry.id);

  const zone = zoneOf(source.entry.id);
  const records = bookRecords(source);
  const plan = planPush(records, await cloud.fingerprints(zone));

  const stations = plan.save.filter((record) => record.name !== BOOK_RECORD);
  const book = plan.save.filter((record) => record.name === BOOK_RECORD);
  let done = 0;
  const send = async (batch: typeof plan.save): Promise<void> => {
    for (const record of batch) {
      await cloud.save(zone, [record]);
      done += 1;
      onRecord?.(done, plan.save.length);
    }
  };

  await send(stations);
  if (plan.remove.length > 0) await cloud.remove(zone, plan.remove);
  await send(book);

  return {
    saved: plan.save.length,
    skipped: records.length - plan.save.length,
    removed: plan.remove.length,
  };
}
