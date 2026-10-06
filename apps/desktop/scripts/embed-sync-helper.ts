/**
 * Electrobun's `postBuild` hook: builds the CloudKit helper, signs it with its own
 * entitlements and provisioning profile, and puts it in the app bundle before the
 * packager signs and notarizes the rest. The packager would then re-sign the helper
 * with the app's entitlements, so `scripts/signing` must be first on PATH.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PROJECT = 'sync-helper/CairnSync.xcodeproj';
const DERIVED = 'sync-helper/build';
const BUILT = join(DERIVED, 'Build/Products/Release/CairnSync.app');
const ENTITLEMENTS = 'sync-helper/CairnSync/CairnSync.release.entitlements';
const SHIM = 'scripts/signing/codesign';
const CODESIGN = '/usr/bin/codesign';

function run(command: string, args: readonly string[]): void {
  execFileSync(command, [...args], { stdio: 'inherit' });
}

export default function embedSyncHelper(): void {
  const env = process.env;
  if (env.ELECTROBUN_OS !== 'macos' || env.ELECTROBUN_BUILD_ENV !== 'stable') return;

  const identity = env.ELECTROBUN_DEVELOPER_ID;
  const profile = env.CAIRN_SYNC_PROFILE;
  if (!identity || !profile) {
    // A checkout without the certificate still packages; release.yml refuses to publish the result.
    console.log('packaging without the iCloud helper: it needs ELECTROBUN_DEVELOPER_ID and CAIRN_SYNC_PROFILE');
    return;
  }
  if (!existsSync(profile)) throw new Error(`CAIRN_SYNC_PROFILE names no file: ${profile}`);
  if (!env.ELECTROBUN_BUILD_DIR || !env.ELECTROBUN_APP_NAME) throw new Error('not run as an Electrobun build hook');
  if (execFileSync('which', ['codesign'], { encoding: 'utf8' }).trim() !== resolve(SHIM)) {
    throw new Error(`put ${resolve('scripts/signing')} first on PATH, or the packager strips the helper's iCloud entitlement`);
  }

  run('xcodebuild', [
    '-project', PROJECT, '-scheme', 'CairnSync', '-configuration', 'Release', '-derivedDataPath', DERIVED,
    'CODE_SIGNING_ALLOWED=NO', '-quiet', 'build',
  ]);

  const helpers = join(env.ELECTROBUN_BUILD_DIR, `${env.ELECTROBUN_APP_NAME}.app`, 'Contents/Helpers');
  const helper = join(helpers, 'CairnSync.app');
  rmSync(helper, { recursive: true, force: true });
  mkdirSync(helpers, { recursive: true });
  run('ditto', [BUILT, helper]);
  copyFileSync(profile, join(helper, 'Contents/embedded.provisionprofile'));
  run(CODESIGN, [
    '--force', '--options', 'runtime', '--timestamp', '--entitlements', ENTITLEMENTS, '--sign', identity, helper,
  ]);
  run(CODESIGN, ['--verify', '--strict', helper]);
}
