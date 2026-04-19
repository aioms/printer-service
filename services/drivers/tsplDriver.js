/**
 * TSPL driver for XPrinter XP-365B (label mode).
 *
 * TSPL is the native command set for label printers and gives us precise
 * (x, y) positioning — ideal for the 76mm × 22mm two-up layout defined in
 * PRINTER_DIMENSIONS_GUIDE.md:
 *
 *   Paper: 76 mm × 22 mm (double-label strip)
 *   Label  : 35 mm × 22 mm each
 *   Dots   : 607 wide @ 203 DPI, ~176 tall
 *
 * Because XPrinter TSPL firmware does not render Vietnamese multi-byte text
 * reliably, Vietnamese product names are rendered client-side as bitmaps and
 * emitted with the TSPL `BITMAP` command. ASCII-only product names use the
 * native `TEXT` command for sharper output.
 */

const { createCanvas, loadImage, registerFont } = require('canvas');
const bwipjs = require('bwip-js');
const logger = require('../../config/logger');
const vn = require('../utils/vietnameseEncoder');

const DPI = 203;
const MM_TO_DOTS = (mm) => Math.round((mm * DPI) / 25.4);

// Layout constants (in dots) for a 76×22 mm two-up label.
// For standard 2-up 35mm label stock the two labels share the paper's full
// 76mm width (≈607 dots), i.e. labels start at the paper's left edge with the
// ~6mm dead zone between them serving as the inter-label gap. Setting a
// non-zero MARGIN_X_DOTS here would shift all content rightward within each
// label — which is exactly the bug we are fixing. Leave it at 0 by default
// and allow per-site calibration via env `TSPL_LABEL_OFFSET_X_MM`.
const PAPER_W_MM = 76;
const PAPER_H_MM = 22;
const PAPER_W_DOTS = MM_TO_DOTS(PAPER_W_MM);  // ~607
const PAPER_H_DOTS = MM_TO_DOTS(PAPER_H_MM);  // ~176
const LABEL_W_DOTS = MM_TO_DOTS(35);          // ~280
// Tunables (env-calibratable):
//   TSPL_LABEL_OFFSET_X_MM — left margin before the first label  (default 0)
//   TSPL_LABEL_GAP_MM      — gap between left and right labels    (default 1)
//   TSPL_LABEL_SAFE_PAD_MM — safety padding inside each label so
//                            content never touches the physical edge
//                            (default 2 → 1mm each side). Larger values
//                            shrink the printable content area.
// These determine where the RIGHT label starts and how much of each 35mm
// label is usable for content. If on a specific batch of label stock you
// see content drifting or getting clipped, nudge these values.
const OFFSET_X_MM   = parseFloat(process.env.TSPL_LABEL_OFFSET_X_MM || '0');
const GAP_MM        = parseFloat(process.env.TSPL_LABEL_GAP_MM      || '1');
const SAFE_PAD_MM   = parseFloat(process.env.TSPL_LABEL_SAFE_PAD_MM || '2');
const MARGIN_X_DOTS = Math.max(0, MM_TO_DOTS(OFFSET_X_MM));
const GAP_DOTS      = Math.max(0, MM_TO_DOTS(GAP_MM));
const SAFE_PAD_DOTS = Math.max(0, MM_TO_DOTS(SAFE_PAD_MM));

// Physical label anchors (left edge of each 35mm label).
const LEFT_LABEL_X  = MARGIN_X_DOTS;
const RIGHT_LABEL_X = MARGIN_X_DOTS + LABEL_W_DOTS + GAP_DOTS;

// Content anchors (inset by SAFE_PAD) and usable content width. All text,
// barcodes and price are rendered into this narrower zone so they stay
// fully inside the physical 35mm label even with small head drift.
const CONTENT_W_DOTS  = Math.max(32, LABEL_W_DOTS - 2 * SAFE_PAD_DOTS);
const LEFT_X  = LEFT_LABEL_X  + SAFE_PAD_DOTS;
const RIGHT_X = RIGHT_LABEL_X + SAFE_PAD_DOTS;

class TsplDriver {
  /**
   * @param {Object} options
   * @param {number} [options.paperWidthMm=76]
   * @param {number} [options.paperHeightMm=22]
   * @param {number} [options.gapMm=2]         gap between labels (feed gap)
   * @param {number} [options.speed=4]         print speed 1–5
   * @param {number} [options.density=8]       0–15
   * @param {number} [options.barcodeHeight=80] in dots
   */
  constructor(options = {}) {
    this.paperWidthMm = options.paperWidthMm || PAPER_W_MM;
    this.paperHeightMm = options.paperHeightMm || PAPER_H_MM;
    this.gapMm = options.gapMm != null ? options.gapMm : 2;
    this.speed = options.speed || 4;
    this.density = options.density != null ? options.density : 8;
    this.barcodeHeight = options.barcodeHeight || 80;
    this.mode = 'tspl';
  }

  /**
   * Build TSPL command buffer.
   *
   * @param {{productCode:string, productName?:string, price?:number}} item
   * @param {number} quantity - total labels to print
   * @returns {Promise<Buffer>} TSPL ASCII commands + embedded BITMAP bytes.
   */
  async buildJob(item, quantity) {
    const { productCode, productName = '', price = null } = item;
    if (!productCode) throw new Error('productCode is required');

    const total = Math.max(1, Math.floor(quantity));
    // Two labels per strip; each PRINT command advances one strip.
    const strips = Math.ceil(total / 2);
    const chunks = [];

    const header = [
      `SIZE ${this.paperWidthMm} mm, ${this.paperHeightMm} mm`,
      `GAP ${this.gapMm} mm, 0 mm`,
      `SPEED ${this.speed}`,
      `DENSITY ${this.density}`,
      `DIRECTION 0`,
      `REFERENCE 0,0`,
      `CLS`,
    ].join('\r\n') + '\r\n';
    chunks.push(Buffer.from(header, 'ascii'));

    // Pre-render product name bitmap once with word-wrap (up to 2 lines,
    // "..." appended on overflow). Reuse across labels so we don't redo
    // canvas work per strip.
    const displayName = vn.sanitizeForBitmap(productName);
    const priceText = formatVnd(price);
    // When price is present we shrink text to 1 line to make room.
    const textBitmap = displayName
      ? await renderTextToBitmap(displayName, {
          widthDots: CONTENT_W_DOTS,
          fontPx: priceText ? 16 : 18,
          maxLines: priceText ? 1 : 2,
          lineGap: 2,
          align: 'center',
        })
      : null;
    const priceBitmap = priceText
      ? await renderTextToBitmap(priceText, {
          widthDots: CONTENT_W_DOTS,
          fontPx: 18,
          maxLines: 1,
          lineGap: 0,
          align: 'center',
          bold: true,
        })
      : null;

    for (let s = 0; s < strips; s++) {
      const labelsInStrip = Math.min(2, total - s * 2);

      chunks.push(Buffer.from('CLS\r\n', 'ascii'));

      for (let slot = 0; slot < labelsInStrip; slot++) {
        const x = slot === 0 ? LEFT_X : RIGHT_X;
        const commands = await this._buildSingleLabel({
          xOrigin: x,
          productCode,
          textBitmap,
          priceBitmap,
        });
        chunks.push(commands);
      }

      chunks.push(Buffer.from(`PRINT 1,1\r\n`, 'ascii'));
    }

    return Buffer.concat(chunks);
  }

  async _buildSingleLabel({ xOrigin, productCode, textBitmap, priceBitmap }) {
    const parts = [];

    // --- Product name (centered bitmap) ---
    const topPad = 6;
    let cursorY = topPad;
    if (textBitmap) {
      parts.push(buildBitmapCommand(xOrigin, cursorY, textBitmap));
      cursorY += textBitmap.height + 4;
    }

    // --- Barcode (centered by offsetting X by estimated barcode width) ---
    const narrow = 2;
    const wide = 2;
    // Shrink barcode when price is present so everything fits in 22mm (~176 dots).
    const barcodeHeight = priceBitmap ? 56 : this.barcodeHeight;
    const barcodeWidth = estimateCode128Width(productCode, narrow);
    const barcodeX = xOrigin + Math.max(0, Math.floor((CONTENT_W_DOTS - barcodeWidth) / 2));
    // BARCODE X,Y,"code_type",height,human_readable,rotation,narrow,wide,"content"
    parts.push(Buffer.from(
      `BARCODE ${barcodeX},${cursorY},"128",${barcodeHeight},2,0,${narrow},${wide},"${productCode}"\r\n`,
      'ascii',
    ));
    // Advance past barcode bars + HRI text (~20 dots) + small gap.
    cursorY += barcodeHeight + 22;

    // --- Price (optional, centered bitmap below barcode) ---
    if (priceBitmap) {
      parts.push(buildBitmapCommand(xOrigin, cursorY, priceBitmap));
    }

    return Buffer.concat(parts);
  }

  logInfo(...args) { logger.info(...args); }
}

// --- helpers ---------------------------------------------------------------

/**
 * Wrap `text` into at most `maxLines` lines that each fit within `maxWidth`.
 * Breaks on whitespace; falls back to character-level breaking for words
 * longer than the line. If content overflows `maxLines`, the last line is
 * trimmed and suffixed with "…".
 */
function wrapTextLines(ctx, text, maxWidth, maxLines) {
  const words = String(text).trim().split(/\s+/);
  const lines = [];
  let current = '';
  let overflow = false;

  const pushCurrent = () => { if (current) { lines.push(current); current = ''; } };

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const trial = current ? current + ' ' + word : word;
    if (ctx.measureText(trial).width <= maxWidth) {
      current = trial;
      continue;
    }
    // Doesn't fit; commit the current line and start a new one.
    pushCurrent();
    if (lines.length >= maxLines) { overflow = true; break; }

    if (ctx.measureText(word).width <= maxWidth) {
      current = word;
    } else {
      // Word itself is too long — break char-by-char.
      let part = '';
      for (const ch of word) {
        if (ctx.measureText(part + ch).width <= maxWidth) {
          part += ch;
        } else {
          if (part) {
            lines.push(part);
            if (lines.length >= maxLines) { overflow = true; break; }
          }
          part = ch;
        }
      }
      if (overflow) break;
      current = part;
    }
  }
  if (!overflow && current) {
    if (lines.length < maxLines) lines.push(current);
    else overflow = true;
  }

  if (overflow && lines.length > 0) {
    let last = lines[lines.length - 1];
    while (last.length > 0 && ctx.measureText(last + '...').width > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[lines.length - 1] = last + '...';
  }
  return lines;
}

/**
 * Render text to a 1-bit bitmap (Buffer of raster bytes) suitable for the
 * TSPL `BITMAP` command. Supports word-wrap up to `maxLines` with "…"
 * overflow. Returns { width, height, bytesPerRow, data }.
 */
async function renderTextToBitmap(text, {
  widthDots,
  fontPx,
  maxLines = 2,
  lineGap = 2,
  align = 'left',
  bold = false,
}) {
  const fontSpec = `${bold ? 'bold ' : ''}${fontPx}px sans-serif`;

  // Measure with a throwaway context first to decide final height.
  const measureCanvas = createCanvas(widthDots, fontPx + 4);
  const mctx = measureCanvas.getContext('2d');
  mctx.font = fontSpec;

  const lines = wrapTextLines(mctx, text, widthDots - 4, maxLines);
  const lineHeight = fontPx + lineGap;
  const heightDots = Math.max(1, lines.length) * lineHeight + 4;

  const canvas = createCanvas(widthDots, heightDots);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, widthDots, heightDots);
  ctx.fillStyle = 'black';
  ctx.font = fontSpec;
  ctx.textBaseline = 'top';
  ctx.textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';

  const xAnchor = align === 'center'
    ? Math.floor(widthDots / 2)
    : align === 'right' ? widthDots - 2 : 2;

  lines.forEach((line, i) => {
    ctx.fillText(line, xAnchor, 2 + i * lineHeight);
  });

  return canvasToTsplBitmap(canvas);
}

/**
 * Format a numeric price as Vietnamese đồng using '.' as thousands separator.
 * Accepts number or numeric string; returns null for null/undefined/empty/invalid.
 * Example: 1000000 → "1.000.000 đ"
 */
function formatVnd(price) {
  if (price == null || price === '') return null;
  const n = Number(price);
  if (!Number.isFinite(n) || n < 0) return null;
  const digits = Math.round(n).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${grouped} đ`;
}

/**
 * Estimate the printed width in dots for a Code128 barcode, assuming
 * subset B (worst-case; subsets A/C may be slightly narrower due to digit
 * pair compression). Close enough for centering purposes.
 */
function estimateCode128Width(text, narrow) {
  const n = String(text || '').length;
  const modules = 11 * (n + 2) + 13; // start + n data + check + stop
  return modules * narrow;
}

/**
 * Convert a canvas to TSPL BITMAP raster bytes.
 * TSPL expects: 1 bit per pixel, MSB first, 1 = background (white), 0 = black.
 * Note: some XPrinter firmware inverts this — test on hardware and flip
 * `INVERT` below if the output is reversed.
 */
function canvasToTsplBitmap(canvas) {
  const INVERT = true; // 0 = black, 1 = white (standard TSPL)
  const width = canvas.width;
  const height = canvas.height;
  const bytesPerRow = Math.ceil(width / 8);
  const data = Buffer.alloc(bytesPerRow * height, INVERT ? 0xff : 0x00);
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, width, height).data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = imageData[idx];
      const g = imageData[idx + 1];
      const b = imageData[idx + 2];
      const luminance = (r + g + b) / 3;
      const isBlack = luminance < 128;
      const byteIdx = y * bytesPerRow + Math.floor(x / 8);
      const bit = 7 - (x % 8);
      if (INVERT) {
        // Default byte is 0xff; clear bit for black pixels.
        if (isBlack) data[byteIdx] &= ~(1 << bit);
      } else {
        if (isBlack) data[byteIdx] |= (1 << bit);
      }
    }
  }

  return { width, height, bytesPerRow, data };
}

function buildBitmapCommand(x, y, bmp) {
  // TSPL: BITMAP X,Y,width(bytes),height,mode,data
  // mode 0 = OVERWRITE
  const header = Buffer.from(
    `BITMAP ${x},${y},${bmp.bytesPerRow},${bmp.height},0,`,
    'ascii',
  );
  const tail = Buffer.from('\r\n', 'ascii');
  return Buffer.concat([header, bmp.data, tail]);
}

module.exports = TsplDriver;
