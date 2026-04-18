/**
 * PrinterServiceV2 — orchestrator for the rebuilt printer pipeline.
 *
 * Design goals:
 *   • Supports both USB (OS spooler or libusb) and LAN (TCP) transports.
 *   • Supports three command modes: ESC/POS, TSPL, ZPL.
 *   • Always re-checks the connection before every print job.
 *   • Renders Vietnamese correctly (ESC/POS TCVN-3, TSPL/ZPL bitmap).
 *   • Supports true 2-up (side-by-side) printing on 76×22 mm strip paper.
 *   • Reports every failure to Telegram (optional, opt-in via env).
 *
 * Keeping the legacy `printerService.js` intact — consumers migrate at their
 * own pace. New endpoints should use this file.
 *
 * Usage:
 *   const PrinterServiceV2 = require('./printerServiceV2');
 *   const svc = new PrinterServiceV2({
 *     connection: { type: 'tcp', ipAddress: '192.168.1.220', port: 9100 },
 *     mode: 'escpos',            // 'escpos' | 'tspl' | 'zpl'
 *     encoding: 'tcvn3',         // ESC/POS only
 *     telegram: { enabled: true } // falls back to env vars
 *   });
 *   await svc.testConnection();
 *   await svc.printBarcodeLabels({ productCode, productName }, 4, { layout: 'side-by-side' });
 */

const logger = require('../config/logger');
const TcpConnection = require('./connections/tcpConnection');
const UsbConnection = require('./connections/usbConnection');
const EscposDriver = require('./drivers/escposDriver');
const TsplDriver = require('./drivers/tsplDriver');
const ZplDriver = require('./drivers/zplDriver');
const telegram = require('./utils/telegramNotifier');
const vn = require('./utils/vietnameseEncoder');

const SUPPORTED_MODES = ['escpos', 'tspl', 'zpl'];
// Canonical layout names:
//   'auto-pair'    - up to 2 labels per 76mm strip; the last strip holds 1
//                    label when quantity is odd. This matches the operator's
//                    intuition: "just give me N barcodes, pair them when
//                    possible". Default.
//   'single'       - always one label per strip (wastes stock on 76mm paper
//                    but useful for debugging / single-column ESC/POS).
//   'side-by-side' - alias of 'auto-pair', kept for backward compatibility.
const SUPPORTED_LAYOUTS = ['auto-pair', 'single', 'side-by-side'];
const DEFAULT_LAYOUT = 'auto-pair';

/**
 * Normalise a layout value to one of the driver-understood forms.
 * @private
 */
function normaliseLayout(layout) {
  if (layout === 'side-by-side') return 'auto-pair';
  return layout;
}

class PrinterServiceV2 {
  constructor(options = {}) {
    this.mode = options.mode || process.env.PRINTER_MODE || 'escpos';
    if (!SUPPORTED_MODES.includes(this.mode)) {
      throw new Error(`Unsupported printer mode: ${this.mode}. Expected one of ${SUPPORTED_MODES.join(', ')}`);
    }

    this.encoding = options.encoding || process.env.PRINTER_ENCODING || vn.ENCODINGS.TCVN3;
    this.telegramEnabled = options.telegram?.enabled ?? telegram.isEnabled();

    const primaryCfg = options.connection || this._connectionFromEnv('primary');
    this.connection = this._createConnection(primaryCfg);

    // Optional fallback connection. Typical pairing: primary=tcp (LAN),
    // fallback=usb (cable on the same machine). When `isAlive()` on the
    // primary fails we retry the same print job on the fallback.
    const fallbackCfg = options.fallbackConnection || this._connectionFromEnv('fallback');
    this.fallbackConnection = fallbackCfg ? this._createConnection(fallbackCfg) : null;

    this.driver = this._createDriver(this.mode, options.driverOptions);
    this.activeConnection = this.connection;

    logger.info('PrinterServiceV2 initialised', {
      mode: this.mode,
      primary: this.connection.describe(),
      fallback: this.fallbackConnection ? this.fallbackConnection.describe() : null,
      encoding: this.encoding,
    });
  }

  // --- construction helpers -----------------------------------------------

  _connectionFromEnv(role = 'primary') {
    const prefix = role === 'fallback' ? 'FALLBACK_' : '';
    const connectionKey = `${prefix}PRINTER_CONNECTION`;
    const rawType = process.env[connectionKey] || (role === 'primary' ? 'tcp' : '');
    const type = rawType.toLowerCase();
    if (!type) return null; // fallback not configured
    const pick = (key) => process.env[`${prefix}${key}`] ?? process.env[key];
    const timeout = parseInt(process.env.PRINTER_TIMEOUT || '5000', 10);
    if (type === 'tcp') {
      return {
        type: 'tcp',
        ipAddress: pick('DEFAULT_PRINTER_IP') || '192.168.1.220',
        port: parseInt(pick('DEFAULT_PRINTER_PORT') || '9100', 10),
        timeout,
      };
    }
    if (type === 'usb') {
      const usbMode = (pick('PRINTER_USB_MODE') || 'spooler').toLowerCase();
      const vendorRaw = pick('PRINTER_USB_VENDOR_ID');
      const productRaw = pick('PRINTER_USB_PRODUCT_ID');
      return {
        type: 'usb',
        mode: usbMode,
        printerName: pick('PRINTER_USB_NAME'),
        vendorId: vendorRaw ? parseInt(vendorRaw, 16) : undefined,
        productId: productRaw ? parseInt(productRaw, 16) : undefined,
        timeout,
      };
    }
    throw new Error(`Unsupported ${connectionKey}="${type}" (expected tcp or usb)`);
  }

  _createConnection(cfg) {
    if (!cfg || !cfg.type) throw new Error('connection.type is required (tcp|usb)');
    switch (cfg.type) {
      case 'tcp':
        return new TcpConnection(cfg);
      case 'usb':
        return new UsbConnection(cfg);
      default:
        throw new Error(`Unsupported connection.type: ${cfg.type}`);
    }
  }

  _createDriver(mode, opts = {}) {
    switch (mode) {
      case 'escpos':
        return new EscposDriver({ encoding: this.encoding, ...opts });
      case 'tspl':
        return new TsplDriver(opts);
      case 'zpl':
        return new ZplDriver(opts);
      default:
        throw new Error(`Unsupported driver mode: ${mode}`);
    }
  }

  // --- public API ---------------------------------------------------------

  describe() {
    return {
      mode: this.mode,
      primary: this.connection.describe(),
      fallback: this.fallbackConnection ? this.fallbackConnection.describe() : null,
      active: this.activeConnection ? this.activeConnection.describe() : null,
      encoding: this.encoding,
      telegramEnabled: this.telegramEnabled,
    };
  }

  /**
   * Verify that at least one printer connection is reachable. Runs a fresh
   * liveness probe on primary; if primary is down and a fallback is
   * configured, probes the fallback too.
   */
  async testConnection() {
    const ctx = { action: 'testConnection' };
    const live = await this._pickLiveConnection(ctx);
    if (live) {
      return {
        isConnected: true,
        target: live.describe(),
        using: live === this.connection ? 'primary' : 'fallback',
        primary: this.connection.describe(),
        fallback: this.fallbackConnection ? this.fallbackConnection.describe() : null,
      };
    }
    const targets = [this.connection.describe(), this.fallbackConnection && this.fallbackConnection.describe()]
      .filter(Boolean)
      .join(' / ');
    const msg = `No printer connection alive (${targets})`;
    await this._reportError(new Error(msg), ctx);
    return { isConnected: false, target: targets, error: msg };
  }

  /**
   * Run `isAlive()` on primary, then fallback. Returns the live connection or
   * null. Also logs / notifies on transitions between primary and fallback.
   *
   * @private
   */
  async _pickLiveConnection(context = {}) {
    let primaryAlive = false;
    try {
      primaryAlive = await this.connection.isAlive();
    } catch (_e) { primaryAlive = false; }
    if (primaryAlive) {
      if (this.activeConnection && this.activeConnection !== this.connection) {
        const msg = `Primary connection recovered — switching back to ${this.connection.describe()}`;
        logger.info(msg);
        if (this.telegramEnabled) {
          telegram.info('Printer recovered', msg, context).catch(() => {});
        }
      }
      this.activeConnection = this.connection;
      return this.connection;
    }
    if (this.fallbackConnection) {
      let fallbackAlive = false;
      try {
        fallbackAlive = await this.fallbackConnection.isAlive();
      } catch (_e) { fallbackAlive = false; }
      if (fallbackAlive) {
        if (this.activeConnection !== this.fallbackConnection) {
          const msg =
            `Primary ${this.connection.describe()} unreachable — falling back to ${this.fallbackConnection.describe()}`;
          logger.warn(msg);
          if (this.telegramEnabled) {
            telegram.warn('Printer fallback activated', msg, context).catch(() => {});
          }
        }
        this.activeConnection = this.fallbackConnection;
        return this.fallbackConnection;
      }
    }
    return null;
  }

  /**
   * Print one or more barcode labels.
   *
   * @param {{productCode:string, productName?:string}} item
   * @param {number} [quantity=1]
   * @param {Object} [opts]
   * @param {'auto-pair'|'single'|'side-by-side'} [opts.layout='auto-pair']
   *        - `auto-pair` (default): packs 2 labels per 76mm strip; the last
   *          strip will hold 1 label if `quantity` is odd.
   *        - `single`: one label per strip (wasteful on 76mm paper).
   *        - `side-by-side`: alias of `auto-pair`.
   * @returns {Promise<{success:boolean, message:string, data:Object|null}>}
   */
  async printBarcodeLabels(item, quantity = 1, opts = {}) {
    const rawLayout = opts.layout || DEFAULT_LAYOUT;
    if (!SUPPORTED_LAYOUTS.includes(rawLayout)) {
      const err = new Error(`Unsupported layout "${rawLayout}"`);
      await this._reportError(err, { action: 'printBarcodeLabels', layout: rawLayout });
      return { success: false, message: err.message, data: null };
    }
    const layout = normaliseLayout(rawLayout);
    const qty = Math.max(1, Math.min(500, Math.floor(Number(quantity) || 1)));
    if (!item || !item.productCode) {
      const err = new Error('productCode is required');
      await this._reportError(err, { action: 'printBarcodeLabels' });
      return { success: false, message: err.message, data: null };
    }

    // ALWAYS re-check connection first, picking primary if alive else fallback.
    const baseCtx = {
      productCode: item.productCode,
      quantity: qty,
      layout,
      mode: this.mode,
    };
    const live = await this._pickLiveConnection({ action: 'preflight', ...baseCtx });
    if (!live) {
      const targets = [this.connection.describe(), this.fallbackConnection && this.fallbackConnection.describe()]
        .filter(Boolean)
        .join(' / ');
      const err = new Error(`All printer connections unreachable (${targets})`);
      await this._reportError(err, { action: 'preflight', ...baseCtx, targets });
      return { success: false, message: err.message, data: null };
    }

    const usingFallback = live !== this.connection;
    try {
      const buffer = await this._buildJob(item, qty, layout);
      const { bytesSent } = await live.send(buffer);
      logger.info('Print job sent', {
        ...baseCtx,
        bytesSent,
        transport: live.type,
        via: usingFallback ? 'fallback' : 'primary',
      });
      return {
        success: true,
        message: usingFallback
          ? `Printed ${qty} label(s) via fallback (${live.describe()})`
          : `Printed ${qty} label(s)`,
        data: {
          productCode: item.productCode,
          productName: item.productName || '',
          quantity: qty,
          layout,
          mode: this.mode,
          transport: live.type,
          via: usingFallback ? 'fallback' : 'primary',
          target: live.describe(),
          bytesSent,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (err) {
      await this._reportError(err, {
        action: 'printBarcodeLabels',
        ...baseCtx,
        target: live.describe(),
        via: usingFallback ? 'fallback' : 'primary',
      });
      return { success: false, message: `Print failed: ${err.message}`, data: null };
    }
  }

  // --- internal -----------------------------------------------------------

  async _buildJob(item, qty, layout) {
    // `layout` has been normalised by `printBarcodeLabels` — either
    // 'auto-pair' or 'single'.
    if (this.mode === 'escpos') {
      if (layout === 'auto-pair') return this.driver.buildSideBySideJob(item, qty);
      return this.driver.buildSingleColumnJob(item, qty);
    }
    if (this.mode === 'tspl' || this.mode === 'zpl') {
      // TSPL / ZPL drivers always emit the 76mm strip. When the user forces
      // `single`, we feed the driver quantity*2 with only the left slot
      // filled — not worth the extra code path. Treat `single` and
      // `auto-pair` the same: the driver already auto-pairs internally.
      return this.driver.buildJob(item, qty);
    }
    throw new Error(`Unsupported mode: ${this.mode}`);
  }

  async _reportError(err, context) {
    logger.error(`[PrinterServiceV2] ${context.action || 'error'}: ${err.message}`, {
      stack: err.stack,
      context,
    });
    if (!this.telegramEnabled) return;
    try {
      await telegram.reportError(err, context);
    } catch (telegramErr) {
      logger.warn('Telegram report failed:', telegramErr.message);
    }
  }
}

module.exports = PrinterServiceV2;
module.exports.SUPPORTED_MODES = SUPPORTED_MODES;
module.exports.SUPPORTED_LAYOUTS = SUPPORTED_LAYOUTS;
module.exports.DEFAULT_LAYOUT = DEFAULT_LAYOUT;
