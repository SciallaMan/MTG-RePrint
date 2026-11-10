import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { CARD_H_MM, CARD_W_MM, PAGE_MM, buildPdf, cutMarks, gridMargins, layout, mmToPt, pageCount, pdfFileName } from '../src/app/pdf/pdf.ts';

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

/** A tiny valid RGB PNG, made by hand. */
function makePng(w = 4, h = 6): Uint8Array {
  const chunk = (type: string, data: Uint8Array): Buffer => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    Buffer.from(data).copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const rows = Buffer.alloc((1 + w * 3) * h, 0x80);
  for (let y = 0; y < h; y++) rows[y * (1 + w * 3)] = 0; // filter: none
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', new Uint8Array()),
  ]);
}

test('the grid is centred and cards are 63 x 88 mm', () => {
  const m = gridMargins('a4');
  assert.equal(m.xMm, 10.5);
  assert.equal(m.yMm, 16.5);
  const slots = layout(Array.from({ length: 10 }, (_, i) => ({ image: `i${i}` })), 'a4');
  assert.deepEqual([slots[0]?.page, slots[8]?.page, slots[9]?.page], [0, 0, 1]);
  assert.equal((slots[1]?.xMm ?? 0) - (slots[0]?.xMm ?? 0), CARD_W_MM);
  assert.equal((slots[3]?.yMm ?? 0) - (slots[0]?.yMm ?? 0), CARD_H_MM);
  assert.equal(slots[9]?.xMm, m.xMm); // the 10th card starts a new page
  assert.equal(pageCount(9), 1);
  assert.equal(pageCount(10), 2);
});

test('cut marks stay inside the page for A4 and Letter', () => {
  for (const format of ['a4', 'letter'] as const) {
    const marks = cutMarks(format);
    assert.equal(marks.length, 4 * 2 * 2);
    const { w, h } = PAGE_MM[format];
    for (const s of marks) {
      for (const v of [s.x1, s.x2]) assert.ok(v >= 0 && v <= w, `${format} x ${v}`);
      for (const v of [s.y1, s.y2]) assert.ok(v >= 0 && v <= h, `${format} y ${v}`);
    }
  }
});

test('buildPdf makes pages of the right size and embeds each image once', async () => {
  const png = makePng();
  let loads = 0;
  const slots = [...Array.from({ length: 10 }, () => ({ image: 'same.png' })), { image: 'other.png' }];
  const bytes = await buildPdf(slots, {
    format: 'letter',
    cutMarks: true,
    loadImage: async () => {
      loads++;
      return png;
    },
  });
  assert.equal(loads, 2);
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 2);
  const size = doc.getPage(0).getSize();
  assert.ok(Math.abs(size.width - mmToPt(215.9)) < 0.01 && Math.abs(size.height - mmToPt(279.4)) < 0.01);
});

test('WebP goes through the converter, unknown formats fail clearly', async () => {
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]);
  const bytes = await buildPdf([{ image: 'a.webp' }], {
    format: 'a4',
    cutMarks: false,
    loadImage: async () => webp,
    toPng: async () => makePng(),
  });
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  await assert.rejects(buildPdf([{ image: 'a.webp' }], { format: 'a4', cutMarks: false, loadImage: async () => webp }), /Unsupported/);
  await assert.rejects(buildPdf([], { format: 'a4', cutMarks: false, loadImage: async () => webp }), /nothing to print/);
});

test('the PDF is named after the list: title and file name', async () => {
  const opts = { format: 'a4' as const, cutMarks: false, loadImage: async () => makePng() };
  const named = await PDFDocument.load(await buildPdf([{ image: 'a.png' }], { ...opts, title: ' Mono Red ' }));
  assert.equal(named.getTitle(), 'Mono Red');
  const untitled = await PDFDocument.load(await buildPdf([{ image: 'a.png' }], { ...opts, title: '  ' }));
  assert.equal(untitled.getTitle(), undefined);

  assert.equal(pdfFileName('Mono Red'), 'Mono Red.pdf');
  assert.equal(pdfFileName('Wishlist: 2026/11 "Commander"?'), 'Wishlist 2026 11 Commander.pdf');
  assert.equal(pdfFileName('a\\b|c*d<e>f\u0007g'), 'a b c d e f g.pdf');
  assert.equal(pdfFileName('...'), 'proxies.pdf');
  assert.equal(pdfFileName(''), 'proxies.pdf');
  assert.equal(pdfFileName(null), 'proxies.pdf');
  assert.equal(pdfFileName('x'.repeat(150)), `${'x'.repeat(100)}.pdf`);
});

test('card size constants', () => assert.deepEqual([CARD_W_MM, CARD_H_MM], [63, 88]));
