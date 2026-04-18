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
const PAPER_W_MM = 76;
const PAPER_H_MM = 22;
const PAPER_W_DOTS = MM_TO_DOTS(PAPER_W_MM);  // ~607
const PAPER_H_DOTS = MM_TO_DOTS(PAPER_H_MM);  // ~176
const LABEL_W_DOTS = MM_TO_DOTS(35);          // ~280
const MARGIN_X_DOTS = MM_TO_DOTS(3);          // ~24
const GAP_DOTS = PAPER_W_DOTS - 2 * LABEL_W_DOTS - 2 * MARGIN_X_DOTS; // ~24

// Left/Right X anchors for the two labels.
const LEFT_X = MARGIN_X_DOTS;
const RIGHT_X = MARGIN_X_DOTS + LABEL_W_DOTS + GAP_DOTS;

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
   * @param {{productCode:string, productName?:string}} item
   * @param {number} quantity - total labels to print
   * @returns {Promise<Buffer>} TSPL ASCII commands + embedded BITMAP bytes.
   */
  async buildJob(item, quantity) {
    const { productCode, productName = '' } = item;
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
      `DIRECTION 1`,
      `REFERENCE 0,0`,
      `CLS`,
    ].join('\r\n') + '\r\n';
    chunks.push(Buffer.from(header, 'ascii'));

    // Pre-render product name bitmap once (if Vietnamese). Reuse across
    // labels so we don't redo canvas work per strip.
    const displayName = vn.sanitizeForBitmap(productName);
    const needsBitmapText = hasNonAscii(displayName);
    const textBitmap = displayName
      ? needsBitmapText
        ? await renderTextToBitmap(displayName, { widthDots: LABEL_W_DOTS, heightDots: 28, fontPx: 18 })
        : null
      : null;

    for (let s = 0; s < strips; s++) {
      const labelsInStrip = Math.min(2, total - s * 2);

      chunks.push(Buffer.from('CLS\r\n', 'ascii'));

      for (let slot = 0; slot < labelsInStrip; slot++) {
        const x = slot === 0 ? LEFT_X : RIGHT_X;
        const commands = await this._buildSingleLabel({
          xOrigin: x,
          productCode,
          displayName,
          textBitmap,
          needsBitmapText,
        });
        chunks.push(commands);
      }

      chunks.push(Buffer.from(`PRINT 1,1\r\n`, 'ascii'));
    }

    return Buffer.concat(chunks);
  }

  async _buildSingleLabel({ xOrigin, productCode, displayName, textBitmap, needsBitmapText }) {
    const parts = [];

    // --- Product name row ---
    const nameY = 8; // dots from top
    if (displayName) {
      if (needsBitmapText && textBitmap) {
        parts.push(buildBitmapCommand(xOrigin, nameY, textBitmap));
      } else {
        // TSPL TEXT: font "2" (8x12), scale 1×1 fits ~32 chars across 35 mm
        const safe = displayName.replace(/"/g, "'");
        parts.push(Buffer.from(
          `TEXT ${xOrigin},${nameY},"2",0,1,1,"${safe}"\r\n`,
          'ascii',
        ));
      }
    }

    // --- Barcode ---
    const barcodeY = 44;
    // BARCODE X,Y,"code_type",height,human_readable,rotation,narrow,wide,"content"
    // human_readable 2 = with HRI text below
    const narrow = 2; // 2 dots narrow bar (SMALL)
    const wide = 2;
    parts.push(Buffer.from(
      `BARCODE ${xOrigin},${barcodeY},"128",${this.barcodeHeight},2,0,${narrow},${wide},"${productCode}"\r\n`,
      'ascii',
    ));

    return Buffer.concat(parts);
  }

  logInfo(...args) { logger.info(...args); }
}

// --- helpers ---------------------------------------------------------------

function hasNonAscii(text) {
  return /[^\x00-\x7F]/.test(String(text || ''));
}

/**
 * Render text to a 1-bit bitmap (Buffer of raster bytes) suitable for the
 * TSPL `BITMAP` command. Returns { width, height, bytesPerRow, data }.
 */
async function renderTextToBitmap(text, { widthDots, heightDots, fontPx }) {
  const canvas = createCanvas(widthDots, heightDots);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, widthDots, heightDots);
  ctx.fillStyle = 'black';
  ctx.font = `${fontPx}px sans-serif`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  // Truncate by measuring.
  let display = text;
  while (display.length > 0 && ctx.measureText(display).width > widthDots - 4) {
    display = display.slice(0, -1);
  }
  if (display !== text) display = display.slice(0, Math.max(0, display.length - 3)) + '...';
  ctx.fillText(display, 2, 4);

  return canvasToTsplBitmap(canvas);
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
