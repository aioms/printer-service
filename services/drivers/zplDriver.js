/**
 * ZPL driver for Zebra-compatible / XPrinter label mode.
 *
 * Produces a raw ZPL II command buffer for the 76 × 22 mm two-up layout.
 * Non-ASCII product names are rendered as a Graphic Field (GF) because ZPL
 * CP-1252 on XPrinter does not carry Vietnamese glyphs reliably.
 *
 * ZPL reference:
 *   ^XA / ^XZ            start/end format
 *   ^PW{dots}            print width
 *   ^LL{dots}            label length
 *   ^FO{x},{y}           field origin
 *   ^BY{w},{r},{h}       barcode defaults (module width, ratio, height)
 *   ^BCN,{h},{text},Y,N  CODE128 (N=orientation, h=height, text=Y/N below)
 *   ^A0N,{h},{w}         default font scaled to (w,h) dots
 *   ^FD ... ^FS          field data
 *   ^GFA,{bytes},{bytes},{bytesPerRow},{hex}  graphic field (ASCII hex)
 */

const { createCanvas } = require('canvas');
const logger = require('../../config/logger');
const vn = require('../utils/vietnameseEncoder');

const DPI = 203;
const MM_TO_DOTS = (mm) => Math.round((mm * DPI) / 25.4);

const PAPER_W_MM = 76;
const PAPER_H_MM = 22;
const PAPER_W_DOTS = MM_TO_DOTS(PAPER_W_MM);
const PAPER_H_DOTS = MM_TO_DOTS(PAPER_H_MM);
const LABEL_W_DOTS = MM_TO_DOTS(35);
const MARGIN_X_DOTS = MM_TO_DOTS(3);
const GAP_DOTS = PAPER_W_DOTS - 2 * LABEL_W_DOTS - 2 * MARGIN_X_DOTS;
const LEFT_X = MARGIN_X_DOTS;
const RIGHT_X = MARGIN_X_DOTS + LABEL_W_DOTS + GAP_DOTS;

class ZplDriver {
  constructor(options = {}) {
    this.paperWidthMm = options.paperWidthMm || PAPER_W_MM;
    this.paperHeightMm = options.paperHeightMm || PAPER_H_MM;
    this.barcodeHeightDots = options.barcodeHeight || 80;
    this.barcodeModuleWidth = options.moduleWidth || 2;
    this.mode = 'zpl';
  }

  async buildJob(item, quantity) {
    const { productCode, productName = '' } = item;
    if (!productCode) throw new Error('productCode is required');

    const total = Math.max(1, Math.floor(quantity));
    const strips = Math.ceil(total / 2);
    const chunks = [];

    const displayName = vn.sanitizeForBitmap(productName);
    const useBitmapText = hasNonAscii(displayName);
    const textGfa = displayName && useBitmapText
      ? renderTextAsGfa(displayName, { widthDots: LABEL_W_DOTS, heightDots: 28, fontPx: 18 })
      : null;

    for (let s = 0; s < strips; s++) {
      const labelsInStrip = Math.min(2, total - s * 2);
      const parts = [];
      parts.push('^XA');
      parts.push(`^PW${PAPER_W_DOTS}`);
      parts.push(`^LL${PAPER_H_DOTS}`);
      parts.push(`^LH0,0`);
      parts.push(`^PQ1,0,1,Y`); // print 1 copy, no pause, cut

      for (let slot = 0; slot < labelsInStrip; slot++) {
        const x = slot === 0 ? LEFT_X : RIGHT_X;
        parts.push(...this._buildSingleLabel({
          x,
          productCode,
          displayName,
          useBitmapText,
          textGfa,
        }));
      }

      parts.push('^XZ');
      chunks.push(Buffer.from(parts.join('\n') + '\n', 'ascii'));
    }

    return Buffer.concat(chunks);
  }

  _buildSingleLabel({ x, productCode, displayName, useBitmapText, textGfa }) {
    const parts = [];

    // Product name row
    const nameY = 10;
    if (displayName) {
      if (useBitmapText && textGfa) {
        parts.push(`^FO${x},${nameY}`);
        parts.push(`^GFA,${textGfa.totalBytes},${textGfa.totalBytes},${textGfa.bytesPerRow},${textGfa.hex}`);
        parts.push('^FS');
      } else {
        const safe = displayName
          .replace(/\\/g, '\\\\')
          .replace(/\^/g, '\\5E')
          .replace(/~/g, '\\7E');
        parts.push(`^FO${x},${nameY}`);
        parts.push(`^A0N,20,16^FD${safe}^FS`);
      }
    }

    // Barcode
    const barcodeY = 50;
    parts.push(`^FO${x},${barcodeY}`);
    parts.push(`^BY${this.barcodeModuleWidth},3,${this.barcodeHeightDots}`);
    parts.push(`^BCN,${this.barcodeHeightDots},Y,N,N`);
    parts.push(`^FD${productCode}^FS`);

    return parts;
  }

  logInfo(...args) { logger.info(...args); }
}

// --- helpers ---------------------------------------------------------------

function hasNonAscii(text) {
  return /[^\x00-\x7F]/.test(String(text || ''));
}

/**
 * Render a line of Vietnamese text as a ZPL ^GFA (ASCII-hex graphic field).
 * Returns { bytesPerRow, totalBytes, hex }.
 */
function renderTextAsGfa(text, { widthDots, heightDots, fontPx }) {
  const canvas = createCanvas(widthDots, heightDots);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, widthDots, heightDots);
  ctx.fillStyle = 'black';
  ctx.font = `${fontPx}px sans-serif`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  let display = text;
  while (display.length > 0 && ctx.measureText(display).width > widthDots - 4) {
    display = display.slice(0, -1);
  }
  if (display !== text) display = display.slice(0, Math.max(0, display.length - 3)) + '...';
  ctx.fillText(display, 2, 4);

  const bytesPerRow = Math.ceil(widthDots / 8);
  const totalBytes = bytesPerRow * heightDots;
  const bitmap = Buffer.alloc(totalBytes, 0x00);
  const imageData = ctx.getImageData(0, 0, widthDots, heightDots).data;
  for (let y = 0; y < heightDots; y++) {
    for (let x = 0; x < widthDots; x++) {
      const idx = (y * widthDots + x) * 4;
      const luminance = (imageData[idx] + imageData[idx + 1] + imageData[idx + 2]) / 3;
      if (luminance < 128) {
        const byteIdx = y * bytesPerRow + Math.floor(x / 8);
        const bit = 7 - (x % 8);
        bitmap[byteIdx] |= (1 << bit);
      }
    }
  }
  // ZPL ^GFA accepts ASCII hex for maximum compatibility.
  return { bytesPerRow, totalBytes, hex: bitmap.toString('hex').toUpperCase() };
}

module.exports = ZplDriver;
