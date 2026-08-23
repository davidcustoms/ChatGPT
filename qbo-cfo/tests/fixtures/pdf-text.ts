import { inflateSync } from 'node:zlib';

/**
 * Minimal PDF inspection for tests.
 *
 * Page content streams are Flate-compressed and @react-pdf writes its text as
 * hex strings inside TJ arrays, so streams are inflated and both hex and
 * literal string forms decoded. That is enough to assert a figure actually
 * reached the page rather than being clipped, truncated or silently dropped,
 * which is what PDF QA is really about.
 *
 * It is not a general-purpose PDF parser: it assumes the single-byte
 * encoding this application's fonts use, and would need a CMap for anything
 * else.
 */

export interface PdfInspection {
  pageCount: number;
  /** Recovered text of each page, in page order. */
  pages: string[];
  /** Every page's text joined, with a PAGE marker between pages. */
  text: string;
}

const ESCAPES: Record<string, string> = {
  n: ' ', r: ' ', t: ' ', b: '', f: ' ',
};

function unescapeLiteral(value: string): string {
  return value
    .replace(/\\([nrtbf()\\])/g, (_m, c: string) => ESCAPES[c] ?? c)
    .replace(/\\([0-7]{1,3})/g, (_m, oct: string) => String.fromCharCode(parseInt(oct, 8)));
}

function decodeHex(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  let out = '';
  for (let i = 0; i + 1 < clean.length; i += 2) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  }
  return out;
}

/** Recovers the drawn text from one inflated content stream. */
function textOfStream(stream: string): string {
  const out: string[] = [];
  // <hex> is what @react-pdf emits; (literal) is the other legal form.
  const pattern = /<([0-9a-fA-F\s]*)>|\((?:[^()\\]|\\.)*\)/g;
  let match: RegExpExecArray | null = pattern.exec(stream);
  while (match !== null) {
    if (match[1] !== undefined) out.push(decodeHex(match[1]));
    else out.push(unescapeLiteral(match[0].slice(1, -1)));
    match = pattern.exec(stream);
  }
  return out.join('');
}

export function inspectPdf(buffer: Buffer): PdfInspection {
  const raw = buffer.toString('latin1');
  const declared = /\/Count\s+(\d+)/.exec(raw);
  const pages: string[] = [];

  let cursor = 0;
  for (;;) {
    const open = raw.indexOf('stream', cursor);
    if (open === -1) break;
    // Skip the tail of an 'endstream' keyword.
    if (raw.startsWith('endstream', open - 3)) {
      cursor = open + 'stream'.length;
      continue;
    }
    let start = open + 'stream'.length;
    if (raw[start] === '\r') start += 1;
    if (raw[start] === '\n') start += 1;
    const end = raw.indexOf('endstream', start);
    if (end === -1) break;

    let inflated = '';
    try {
      inflated = inflateSync(buffer.subarray(start, end)).toString('latin1');
    } catch {
      // Not an inflatable stream (an embedded font subset, say). Skipped.
      inflated = '';
    }
    // A page's content stream is the one that opens text and sets a font.
    if (inflated.includes('BT') && inflated.includes('Tf')) {
      pages.push(textOfStream(inflated));
    }
    cursor = end + 'endstream'.length;
  }

  return {
    pageCount: declared ? Number(declared[1]) : pages.length,
    pages,
    text: pages.join('\nPAGE\n'),
  };
}
