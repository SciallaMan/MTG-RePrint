import { PDFDocument, rgb } from 'pdf-lib';
import type { PDFImage } from 'pdf-lib';

// NOTE: this file imports nothing from the app on purpose, so that it can also be tested
// with plain Node (see web/test/pdf.test.ts).

export const CARD_W_MM = 63;
export const CARD_H_MM = 88;
export const COLUMNS = 3;
export const ROWS = 3;
export const PER_PAGE = COLUMNS * ROWS;

export type PageFormat = 'a4' | 'letter';
export const PAGE_MM: Record<PageFormat, { w: number; h: number }> = {
  a4: { w: 210, h: 297 },
  letter: { w: 215.9, h: 279.4 },
};

const PT_PER_MM = 72 / 25.4;
export const mmToPt = (mm: number): number => mm * PT_PER_MM;

/** One card face to print: the cache file name of its image. */
export interface Slot {
  image: string;
}

export interface Placement {
  page: number;
  /** Position of the top-left corner of the card, in millimetres from the top-left of the page. */
  xMm: number;
  yMm: number;
  image: string;
}

/** Margin around the 3x3 grid, so that it is centred on the page. */
export function gridMargins(format: PageFormat): { xMm: number; yMm: number } {
  const page = PAGE_MM[format];
  return { xMm: (page.w - COLUMNS * CARD_W_MM) / 2, yMm: (page.h - ROWS * CARD_H_MM) / 2 };
}

export function pageCount(slots: number): number {
  return Math.ceil(slots / PER_PAGE);
}

/** Place the slots left to right, top to bottom, 9 per page. */
export function layout(slots: readonly Slot[], format: PageFormat): Placement[] {
  const m = gridMargins(format);
  return slots.map((slot, i) => {
    const onPage = i % PER_PAGE;
    return {
      page: Math.floor(i / PER_PAGE),
      xMm: m.xMm + (onPage % COLUMNS) * CARD_W_MM,
      yMm: m.yMm + Math.floor(onPage / COLUMNS) * CARD_H_MM,
      image: slot.image,
    };
  });
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Cut marks, in millimetres from the top-left: short lines in the margin, on the card edges. */
export function cutMarks(format: PageFormat, lengthMm = 4): Segment[] {
  const m = gridMargins(format);
  const len = Math.min(lengthMm, m.xMm, m.yMm);
  const xs = Array.from({ length: COLUMNS + 1 }, (_, i) => m.xMm + i * CARD_W_MM);
  const ys = Array.from({ length: ROWS + 1 }, (_, i) => m.yMm + i * CARD_H_MM);
  const top = ys[0] as number;
  const bottom = ys[ROWS] as number;
  const left = xs[0] as number;
  const right = xs[COLUMNS] as number;
  const segments: Segment[] = [];
  for (const x of xs) {
    segments.push({ x1: x, y1: top - len, x2: x, y2: top });
    segments.push({ x1: x, y1: bottom, x2: x, y2: bottom + len });
  }
  for (const y of ys) {
    segments.push({ x1: left - len, y1: y, x2: left, y2: y });
    segments.push({ x1: right, y1: y, x2: right + len, y2: y });
  }
  return segments;
}

export interface PdfOptions {
  format: PageFormat;
  cutMarks: boolean;
  /** Bytes of an image from the cache. */
  loadImage: (file: string) => Promise<Uint8Array>;
  /** Converts an image pdf-lib cannot read (WebP) to PNG. In the browser this uses a canvas. */
  toPng?: (data: Uint8Array) => Promise<Uint8Array>;
  onProgress?: (done: number, total: number) => void;
}

const isPng = (d: Uint8Array): boolean => d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47;
const isJpeg = (d: Uint8Array): boolean => d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff;

async function embed(doc: PDFDocument, data: Uint8Array, toPng: PdfOptions['toPng']): Promise<PDFImage> {
  if (isPng(data)) return doc.embedPng(data);
  if (isJpeg(data)) return doc.embedJpg(data);
  if (!toPng) throw new Error('Unsupported image format (only PNG and JPEG can be embedded)');
  return doc.embedPng(await toPng(data));
}

/** Build the PDF: 3x3 cards of 63 x 88 mm per page, optionally with cut marks. */
export async function buildPdf(slots: readonly Slot[], opts: PdfOptions): Promise<Uint8Array> {
  if (slots.length === 0) throw new Error('There is nothing to print');
  const doc = await PDFDocument.create();
  doc.setCreator('MTG RePrint');
  doc.setProducer('MTG RePrint');
  const page = PAGE_MM[opts.format];
  const pageW = mmToPt(page.w);
  const pageH = mmToPt(page.h);
  const placements = layout(slots, opts.format);
  const marks = opts.cutMarks ? cutMarks(opts.format) : [];

  const images = new Map<string, PDFImage>(); // each image is embedded once, however many copies
  const pages = Array.from({ length: pageCount(slots.length) }, () => {
    const p = doc.addPage([pageW, pageH]);
    for (const s of marks) {
      p.drawLine({
        start: { x: mmToPt(s.x1), y: pageH - mmToPt(s.y1) },
        end: { x: mmToPt(s.x2), y: pageH - mmToPt(s.y2) },
        thickness: 0.4,
        color: rgb(0, 0, 0),
      });
    }
    return p;
  });

  let done = 0;
  for (const placement of placements) {
    let image = images.get(placement.image);
    if (!image) {
      image = await embed(doc, await opts.loadImage(placement.image), opts.toPng);
      images.set(placement.image, image);
    }
    pages[placement.page]?.drawImage(image, {
      x: mmToPt(placement.xMm),
      y: pageH - mmToPt(placement.yMm + CARD_H_MM),
      width: mmToPt(CARD_W_MM),
      height: mmToPt(CARD_H_MM),
    });
    opts.onProgress?.(++done, placements.length);
  }
  return doc.save();
}
