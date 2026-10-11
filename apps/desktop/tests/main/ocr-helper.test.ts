import { expect, test } from 'bun:test';
import { ocrHelperPath } from '../../src/main/ocr-helper';

test('the OCR helper sits in the bundle beside the main process', () => {
  expect(ocrHelperPath('/Applications/Cairn.app/Contents/MacOS/cottontail'))
    .toBe('/Applications/Cairn.app/Contents/Helpers/cairn-ocr');
});
