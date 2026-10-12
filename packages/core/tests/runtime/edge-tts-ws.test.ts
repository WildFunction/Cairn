import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CairnError } from '../../src/errors';

/** What the service does to the next socket; the library only ever sees these events. */
let behaviour: 'refuse' | 'speak' = 'refuse';
/** Sockets refused before `speak` takes effect: the new host turns away about one in eight. */
let refusals = 0;
const opened: string[] = [];

const frame = (headers: string, body: Uint8Array): Buffer => {
  const head = Buffer.from(headers, 'utf8');
  const size = Buffer.alloc(2);
  size.writeUInt16BE(head.length);
  return Buffer.concat([size, head, body]);
};

class FakeSocket extends EventEmitter {
  constructor(url: string) {
    super();
    opened.push(url);
    queueMicrotask(() => {
      if (behaviour === 'refuse' || opened.length <= refusals) {
        this.emit('error', new Error('Unexpected server response: 403'));
        this.emit('close');
        return;
      }
      this.emit('open');
    });
  }

  send(data: string): void {
    if (!data.includes('Path:ssml')) return;
    this.emit('message', frame('Content-Type:audio/mpeg\r\nPath:audio\r\n', new Uint8Array([1, 2, 3])), true);
    this.emit('message', Buffer.from('Path:turn.end\r\n\r\n{}'), false);
  }

  close(): void {
    this.emit('close');
  }
}

mock.module('isomorphic-ws', () => ({ default: FakeSocket }));
// An earlier test file may have loaded the library with the real socket already bound
for (const loaded of ['edge-tts-universal', '../../src/runtime/edge-tts-ws']) {
  delete require.cache[Bun.resolveSync(loaded, import.meta.dir)];
}
const { ensureNarrationReachable, forgetNarrationProbe, speakSample } = await import('../../src/runtime/edge-tts-ws');

const dir = mkdtempSync(join(tmpdir(), 'cairn-tts-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  opened.length = 0;
  refusals = 0;
  forgetNarrationProbe();
});

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (cause) {
    return cause instanceof CairnError ? cause.code : String(cause);
  }
}

describe('a refused handshake', () => {
  // The service answered 403 and the stream waited for an `open` that never came: a book sat at 0/13
  test('fails the synthesis instead of waiting forever', async () => {
    behaviour = 'refuse';
    expect(await codeOf(speakSample('hello', 'en-US-EmmaNeural', join(dir, 'a.mp3')))).toBe('tts_failed');
  });

  // The voice list kept answering 200 while synthesis was refused, so listing voices proved nothing
  test('fails the check made before the first model call', async () => {
    behaviour = 'refuse';
    expect(await codeOf(ensureNarrationReachable())).toBe('tts_missing');
  });
});

describe('a service that speaks', () => {
  test('passes the check, once', async () => {
    behaviour = 'speak';
    await ensureNarrationReachable();
    await ensureNarrationReachable();
    expect(opened).toHaveLength(1);
  });

  // A failed synthesis fails the station, and the station's retry pays for its slides again
  test('is asked again when it turns one connection away', async () => {
    behaviour = 'speak';
    refusals = 2;
    expect(await codeOf(speakSample('hello', 'en-US-EmmaNeural', join(dir, 'b.mp3')))).toBeUndefined();
    expect(opened).toHaveLength(3);
  });

  test('is not asked forever', async () => {
    behaviour = 'speak';
    refusals = 99;
    expect(await codeOf(speakSample('hello', 'en-US-EmmaNeural', join(dir, 'c.mp3')))).toBe('tts_failed');
    expect(opened).toHaveLength(3);
  });

  test('is reached where Edge itself synthesises', async () => {
    behaviour = 'speak';
    await ensureNarrationReachable();
    expect(opened[0]).toStartWith('wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?Ocp-Apim-Subscription-Key=');
  });
});
