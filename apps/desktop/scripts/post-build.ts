/** Electrobun's `postBuild` hook takes one script; the bundle carries two helpers. */
import embedOcrHelper from './embed-ocr-helper';
import embedSyncHelper from './embed-sync-helper';

export default function postBuild(): void {
  embedOcrHelper();
  embedSyncHelper();
}
