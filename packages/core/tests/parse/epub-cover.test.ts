import { expect, test } from 'bun:test';
import JSZip from 'jszip';
import { parseEpub } from '../../src/parse/epub';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

/** A one-chapter EPUB whose OPF metadata and image entries the test chooses. */
async function epubWith({ metadata = '', items = '', files = {} }: {
  metadata?: string;
  items?: string;
  files?: Record<string, Uint8Array>;
}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>');
  zip.file('OPS/book.opf', `<package><metadata><dc:title>Pro Git</dc:title>${metadata}</metadata>
    <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>${items}</manifest>
    <spine><itemref idref="c1"/></spine></package>`);
  zip.file('OPS/c1.xhtml', `<html><body><h1>Getting Started</h1><p>${'Git tracks content. '.repeat(400)}</p></body></html>`);
  for (const [path, bytes] of Object.entries(files)) zip.file(path, bytes);
  return zip.generateAsync({ type: 'uint8array' });
}

test('an EPUB 3 cover-image is read, wherever it sits relative to the OPF', async () => {
  const book = await parseEpub(await epubWith({
    items: '<item id="img" href="../images/front.jpg" media-type="image/jpeg" properties="cover-image"/>',
    files: { 'images/front.jpg': JPEG },
  }), 'x.epub');
  expect(book.cover).toEqual({ data: JPEG, mediaType: 'image/jpeg' });
});

test('an EPUB 2 cover is the item the cover meta names', async () => {
  const book = await parseEpub(await epubWith({
    metadata: '<meta content="cover-id" name="cover"/>',
    items: '<item id="other" href="a.png" media-type="image/png"/><item id="cover-id" href="b.png" media-type="image/png"/>',
    files: { 'OPS/a.png': new Uint8Array([9]), 'OPS/b.png': new Uint8Array([7, 7]) },
  }), 'x.epub');
  expect(book.cover).toEqual({ data: new Uint8Array([7, 7]), mediaType: 'image/png' });
});

test('with neither, an image named for the cover will do', async () => {
  const book = await parseEpub(await epubWith({
    items: '<item id="i1" href="img/fig1.jpg" media-type="image/jpeg"/><item id="i2" href="img/Cover.jpg" media-type="image/jpeg"/>',
    files: { 'OPS/img/fig1.jpg': new Uint8Array([1]), 'OPS/img/Cover.jpg': JPEG },
  }), 'x.epub');
  expect(book.cover?.data).toEqual(JPEG);
});

test('no cover is not a failure: a missing file, an SVG or nothing declared all leave it out', async () => {
  const cases = [
    epubWith({}),
    epubWith({ items: '<item id="c" href="gone.jpg" media-type="image/jpeg" properties="cover-image"/>' }),
    epubWith({
      items: '<item id="c" href="c.svg" media-type="image/svg+xml" properties="cover-image"/>',
      files: { 'OPS/c.svg': new Uint8Array([60]) },
    }),
  ];
  for (const bytes of cases) expect((await parseEpub(await bytes, 'x.epub')).cover).toBeUndefined();
});

test('the description loses its markup and entities, and an empty one is left out', async () => {
  const book = await parseEpub(await epubWith({
    metadata: '<dc:description>&lt;p&gt;Everything you need to know about &lt;b&gt;Git&lt;/b&gt;.&lt;/p&gt;\n  &lt;p&gt;Second  edition.&lt;/p&gt;</dc:description>',
  }), 'x.epub');
  expect(book.description).toBe('Everything you need to know about Git. Second edition.');
  const blank = await parseEpub(await epubWith({ metadata: '<dc:description>  </dc:description>' }), 'x.epub');
  expect(blank.description).toBeUndefined();
});
