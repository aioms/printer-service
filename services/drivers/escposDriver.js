/**
 * ESC/POS driver for XPrinter XP-365B.
 *
 * Builds a raw ESC/POS command buffer using `node-thermal-printer` as a
 * command-builder (we call `.getBuffer()` and pipe the bytes through our own
 * connection layer so the same driver works with TCP or USB transports).
 *
 * Supports:
 *  - Native CODE128 for single/vertical labels
 *  - Side-by-side (2 × 35mm) via composed bitmap (bwip-js + canvas)
 *  - Vietnamese via TCVN-3 code page with Windows-1258 / ASCII fallback
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  ThermalPrinter,
  PrinterTypes,
  CharacterSet,
  BreakLine,
} = require('node-thermal-printer');
const bwipjs = require('bwip-js');
const { createCanvas, loadImage } = require('canvas');
const logger = require('../../config/logger');
const vn = require('../utils/vietnameseEncoder');

// ESC/POS command fragments we need to emit directly.
const ESC = 0x1b;
// ESC t n  — select character code page
const ESCPOS_SELECT_CODEPAGE = (n) => Buffer.from([ESC, 0x74, n]);
// ESC R n — select international character set (n=0 USA)
const ESCPOS_INT_CHARSET = (n) => Buffer.from([ESC, 0x52, n]);

// Code-page ids for XP-365B firmware (verified against XPrinter manual).
const CODEPAGE = {
  PC437_USA: 0,
  TCVN3: 30,      // Vietnam (TCVN-3)
  CP1258: 45,     // Vietnam (Windows-1258)
};

// Map our public encoding ids to (codepage, encoder) pairs.
function resolveEncoder(encoding) {
  switch (encoding) {
    case vn.ENCODINGS.TCVN3:
      return { codepage: CODEPAGE.TCVN3, encode: vn.toTcvn3 };
    case vn.ENCODINGS.CP1258:
      return { codepage: CODEPAGE.CP1258, encode: vn.toWindows1258 };
    case vn.ENCODINGS.ASCII:
    default:
      return {
        codepage: CODEPAGE.PC437_USA,
        encode: (t) => Buffer.from(vn.toAscii(t), 'ascii'),
      };
  }
}

function truncate(text, max) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 3) + '...' : text;
}

class EscposDriver {
  /**
   * @param {Object} options
   * @param {string} [options.encoding]      - 'tcvn3' | 'cp1258' | 'ascii'
   * @param {number} [options.paperWidthMm]  - default 76
   * @param {number} [options.charsPerLine]  - default 48 (Font B)
   */
  constructor(options = {}) {
    this.encoding = options.encoding || vn.ENCODINGS.TCVN3;
    this.paperWidthMm = options.paperWidthMm || 76;
    this.charsPerLine = options.charsPerLine || 48;
    this.mode = 'escpos';
  }

  /**
   * Returns the list of encoding ids to try (primary first, then fallbacks).
   * The orchestrator can re-run build() with each id on Vietnamese rendering
   * failure. We keep ASCII as the ultimate safety net.
   */
  getEncodingChain() {
    const base = this.encoding;
    const chain = [base];
    for (const fallback of [vn.ENCODINGS.CP1258, vn.ENCODINGS.ASCII]) {
      if (!chain.includes(fallback)) chain.push(fallback);
    }
    return chain;
  }

  _newBuilder() {
    // Interface is never used for I/O (we call getBuffer() only), but the
    // constructor requires a valid string. tcp://127.0.0.1:0 is a safe dummy.
    const builder = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: 'tcp://127.0.0.1:9100',
      characterSet: CharacterSet.PC437_USA,
      removeSpecialCharacters: false,
      lineCharacter: '=',
      breakLine: BreakLine.WORD,
      width: this.charsPerLine,
    });
    builder.clear();
    return builder;
  }

  /**
   * Build an ESC/POS buffer that prints `quantity` vertically-stacked labels.
   * One label per strip — simplest/most reliable path.
   *
   * @param {{productCode:string, productName?:string}} item
   * @param {number} quantity
   * @param {Object} [opts]
   * @param {string} [opts.encoding] - override default encoding
   */
  async buildSingleColumnJob(item, quantity, opts = {}) {
    const { productCode, productName = '' } = item;
    if (!productCode) throw new Error('productCode is required');

    const { codepage, encode } = resolveEncoder(opts.encoding || this.encoding);
    const name = truncate(vn.sanitizeForBitmap(productName), 32);

    const printer = this._newBuilder();
    // Switch code page for Vietnamese glyphs.
    printer.raw(ESCPOS_INT_CHARSET(0));
    printer.raw(ESCPOS_SELECT_CODEPAGE(codepage));

    for (let i = 0; i < quantity; i++) {
      printer.alignCenter();
      printer.setTypeFontB();
      if (name) {
        printer.raw(encode(name));
        printer.newLine();
      }
      printer.code128(productCode, { width: 'MEDIUM', height: 60, text: 2 });
      printer.newLine();
      printer.newLine();
      if (i < quantity - 1) {
        printer.drawLine();
        printer.newLine();
      }
    }
    printer.cut();
    return printer.getBuffer();
  }

  /**
   * Build an ESC/POS buffer that prints a 2-up (side-by-side) layout using
   * a composed bitmap for the barcode pair.
   *
   * 76mm paper → label layout 35mm | 6mm | 35mm.
   *
   * @param {{productCode:string, productName?:string}} item
   * @param {number} quantity  total labels to print
   * @param {Object} [opts]
   */
  async buildSideBySideJob(item, quantity, opts = {}) {
    const { productCode, productName = '' } = item;
    if (!productCode) throw new Error('productCode is required');

    const { codepage, encode } = resolveEncoder(opts.encoding || this.encoding);
    const name = truncate(vn.sanitizeForBitmap(productName), 22);
    const rows = Math.ceil(quantity / 2);

    const printer = this._newBuilder();
    printer.raw(ESCPOS_INT_CHARSET(0));
    printer.raw(ESCPOS_SELECT_CODEPAGE(codepage));

    // Render Vietnamese product name as a centred text strip, so it renders
    // identically regardless of printer code-page. Optional: only use for
    // characters outside the active code page.
    for (let r = 0; r < rows; r++) {
      const remaining = quantity - r * 2;
      const labelsInRow = Math.min(2, remaining);

      printer.setTypeFontB();
      if (name) {
        if (labelsInRow === 2) {
          printer.tableCustom([
            { text: '', align: 'LEFT', width: 0.02 },
            { text: name, align: 'CENTER', width: 0.45 },
            { text: '', align: 'CENTER', width: 0.06 },
            { text: name, align: 'CENTER', width: 0.45 },
            { text: '', align: 'RIGHT', width: 0.02 },
          ]);
        } else {
          printer.alignCenter();
          printer.raw(encode(name));
          printer.newLine();
        }
      }

      // Compose barcode image (single or pair).
      const imageBuf = labelsInRow === 2
        ? await this._composeBarcodePair(productCode, productCode)
        : await this._composeBarcodeSingle(productCode);

      const tmp = path.join(os.tmpdir(), `aiom-barcode-${Date.now()}-${r}.png`);
      fs.writeFileSync(tmp, imageBuf);
      try {
        printer.alignCenter();
        await printer.printImage(tmp);
      } finally {
        try { fs.unlinkSync(tmp); } catch (_e) { /* ignore */ }
      }

      if (labelsInRow === 2) {
        printer.tableCustom([
          { text: '', align: 'LEFT', width: 0.02 },
          { text: productCode, align: 'CENTER', width: 0.45 },
          { text: '', align: 'CENTER', width: 0.06 },
          { text: productCode, align: 'CENTER', width: 0.45 },
          { text: '', align: 'RIGHT', width: 0.02 },
        ]);
      } else {
        printer.alignCenter();
        printer.println(productCode);
      }

      printer.newLine();
      printer.newLine();
    }
    printer.cut();
    return printer.getBuffer();
  }

  async _composeBarcodeSingle(code) {
    const img = await bwipjs.toBuffer({
      bcid: 'code128', text: code, scale: 2, height: 12, includetext: false,
    });
    return img;
  }

  async _composeBarcodePair(code1, code2) {
    const [buf1, buf2] = await Promise.all([
      bwipjs.toBuffer({ bcid: 'code128', text: code1, scale: 2, height: 12, includetext: false }),
      bwipjs.toBuffer({ bcid: 'code128', text: code2, scale: 2, height: 12, includetext: false }),
    ]);
    const [img1, img2] = await Promise.all([loadImage(buf1), loadImage(buf2)]);

    // Target canvas width = PAPER_WIDTH_DOTS (607) scaled; we use a uniform
    // pixel canvas matching ~600px so thermal rasteriser renders crisply.
    const CANVAS_W = 600;
    const GAP = 40;
    const labelWidth = (CANVAS_W - GAP) / 2;

    const maxH = Math.max(img1.height, img2.height);
    const canvas = createCanvas(CANVAS_W, maxH);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, CANVAS_W, maxH);

    // Scale each barcode to the label width while keeping aspect ratio.
    const scale1 = labelWidth / img1.width;
    const scale2 = labelWidth / img2.width;
    ctx.drawImage(img1, 0, 0, labelWidth, img1.height * scale1);
    ctx.drawImage(img2, labelWidth + GAP, 0, labelWidth, img2.height * scale2);

    return canvas.toBuffer('image/png');
  }

  logInfo(...args) { logger.info(...args); }
}

module.exports = EscposDriver;
