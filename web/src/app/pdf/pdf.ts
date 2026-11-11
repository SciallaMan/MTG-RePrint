import { PDFDocument, rgb } from 'pdf-lib';
import type { PDFImage } from 'pdf-lib';

// NOTE: this file imports nothing from the app on purpose, so that it can also be tested
// with plain Node (see web/test/pdf.test.ts).

export const CARD_W_MM = 63;
export const CARD_H_MM = 88;

export type PageFormat = 'a4' | 'a3' | 'letter' | 'legal';
export const PAGE_FORMATS: readonly PageFormat[] = ['a4', 'a3', 'letter', 'legal'];

export interface PageSpec {
  name: string;
  /** Page size in millimetres. */
  w: number;
  h: number;
  /** Cards per row and per column: as many as fit the page. */
  columns: number;
  rows: number;
}

export const PAGE_MM: Record<PageFormat, PageSpec> = {
  a4: { name: 'A4', w: 210, h: 297, columns: 3, rows: 3 },
  a3: { name: 'A3', w: 297, h: 420, columns: 4, rows: 4 },
  letter: { name: 'US Letter', w: 215.9, h: 279.4, columns: 3, rows: 3 },
  legal: { name: 'US Legal', w: 215.9, h: 355.6, columns: 3, rows: 4 },
};

/** The format with this name, A4 for anything else (an old or hand-edited setting). */
export function toPageFormat(value: string): PageFormat {
  return (PAGE_FORMATS as readonly string[]).includes(value) ? (value as PageFormat) : 'a4';
}

/** Cards on one page of this format. */
export function perPage(format: PageFormat): number {
  return PAGE_MM[format].columns * PAGE_MM[format].rows;
}

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

/** Margin around the grid of cards, so that it is centred on the page. */
export function gridMargins(format: PageFormat): { xMm: number; yMm: number } {
  const page = PAGE_MM[format];
  return { xMm: (page.w - page.columns * CARD_W_MM) / 2, yMm: (page.h - page.rows * CARD_H_MM) / 2 };
}

export function pageCount(slots: number, format: PageFormat): number {
  return Math.ceil(slots / perPage(format));
}

/** Place the slots left to right, top to bottom, as many per page as the format holds. */
export function layout(slots: readonly Slot[], format: PageFormat): Placement[] {
  const m = gridMargins(format);
  const { columns } = PAGE_MM[format];
  const onOne = perPage(format);
  return slots.map((slot, i) => {
    const onPage = i % onOne;
    return {
      page: Math.floor(i / onOne),
      xMm: m.xMm + (onPage % columns) * CARD_W_MM,
      yMm: m.yMm + Math.floor(onPage / columns) * CARD_H_MM,
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
  const { columns, rows } = PAGE_MM[format];
  const len = Math.min(lengthMm, m.xMm, m.yMm);
  const xs = Array.from({ length: columns + 1 }, (_, i) => m.xMm + i * CARD_W_MM);
  const ys = Array.from({ length: rows + 1 }, (_, i) => m.yMm + i * CARD_H_MM);
  const top = ys[0] as number;
  const bottom = ys[rows] as number;
  const left = xs[0] as number;
  const right = xs[columns] as number;
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
  /** Title of the document (shown by PDF viewers instead of the file name), e.g. the list name. */
  title?: string;
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

/**
 * File name of the PDF for a list name: the characters that are not allowed in file names
 * (Windows is the strictest) become spaces; without a usable name it is "proxies.pdf".
 */
export function pdfFileName(name: string | null | undefined): string {
  const base = (name ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 100)
    .trim();
  return `${base || 'proxies'}.pdf`;
}

/** Build the PDF: a grid of 63 x 88 mm cards per page (3x3 on A4 and Letter), optionally with cut marks. */
export async function buildPdf(slots: readonly Slot[], opts: PdfOptions): Promise<Uint8Array> {
  if (slots.length === 0) throw new Error('There is nothing to print');
  const doc = await PDFDocument.create();
  doc.setCreator('MTG RePrint');
  doc.setProducer('MTG RePrint');
  const title = opts.title?.trim();
  if (title) doc.setTitle(title, { showInWindowTitleBar: true });
  const page = PAGE_MM[opts.format];
  const pageW = mmToPt(page.w);
  const pageH = mmToPt(page.h);
  const placements = layout(slots, opts.format);
  const marks = opts.cutMarks ? cutMarks(opts.format) : [];

  const images = new Map<string, PDFImage>(); // each image is embedded once, however many copies
  const pages = Array.from({ length: pageCount(slots.length, opts.format) }, () => {
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
