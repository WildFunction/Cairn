import { expect, test } from 'bun:test';
import { qrPath } from '../../src/settings/QrCode';

test('a sign-in URL encodes to a square of unit modules, with the finder patterns set', () => {
  const { size, d } = qrPath('https://weread.qq.com/web/confirm?uid=0817da3c-1f2e-4b5a-9c8d-7e6f5a4b3c2d');
  expect(size).toBeGreaterThanOrEqual(21);
  expect((size - 17) % 4).toBe(0);
  // Every QR code's top-left finder starts dark at the origin
  expect(d.startsWith('M0 0h1v1h-1z')).toBe(true);
  expect(d).toMatch(/^(M\d+ \d+h1v1h-1z)+$/);
});
