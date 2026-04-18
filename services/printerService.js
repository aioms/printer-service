/**
 * Thermal Printer Service for XPrinter XP-365B
 *
 * PRINTER SPECIFICATIONS:
 * - Model: XPrinter XP-365B
 * - Technology: Direct Thermal
 * - Resolution: 203 DPI (dots per inch)
 * - Paper width: 20-82mm (typically using 80mm thermal paper)
 * - Print speed: 127mm/s
 * - Processor: 32-bit RISC CPU
 * - Memory: Flash 4MB / SDRAM 4MB
 * - Connection: USB, Network (TCP/IP)
 *
 * PAPER & DIMENSION CALCULATIONS:
 * - Paper width: 76mm usable area (80mm paper with margins)
 * - Paper width in dots: 76mm × 203 DPI ÷ 25.4mm/inch = ~607 dots
 * - Characters per line: 48 characters (standard for 80mm thermal paper)
 * - Font A: 12×24 dots (larger font)
 * - Font B: 9×17 dots (smaller font, more characters per line)
 *
 * LABEL DIMENSIONS:
 * - Single label: 35mm × 22mm
 * - Two labels side-by-side: 70mm total (fits in 76mm with margins)
 * - Label width in dots: 35mm × 203 DPI ÷ 25.4mm = ~280 dots per label
 * - Label height in dots: 22mm × 203 DPI ÷ 25.4mm = ~176 dots
 *
 * BARCODE SIZING:
 * - CODE128 barcode format
 * - Width settings: SMALL (2 dots), MEDIUM (3 dots), LARGE (4 dots)
 * - Height: 50-80 dots (6.3-10mm) depending on label size
 * - For single label (35mm): Use MEDIUM width, 60 height
 * - For dual labels (35mm each): Use SMALL width, 50 height
 *
 * TEXT SIZING:
 * - Font B recommended for product names (more compact)
 * - Single label: ~32 characters max
 * - Dual labels: ~22 characters per label
 * - Vietnamese text supported with proper Unicode ranges
 *
 * LAYOUT FORMATS:
 * 1. Single label (printBarcodeLabel):
 *    - Full width (35mm)
 *    - Product name (centered, Font B)
 *    - Barcode (CODE128, medium width, 60 height)
 *    - Product code below barcode
 *    - Uses native thermal printer commands
 *
 * 2. Multiple labels - Side-by-Side (printSideBySideBarcodes):
 *    - Two labels per row (35mm each)
 *    - Product names in table layout (48% + 4% spacing + 48%)
 *    - Barcodes side-by-side using image generation
 *    - Product codes below each barcode
 *    - Uses bwip-js + canvas (slower, more precise)
 *    - Best for label sheets or specific layout requirements
 *
 * 3. Multiple labels - Vertical Stack (printHorizontalBarcodes):
 *    - Labels printed vertically (stacked)
 *    - Each label: Product name + Barcode + Product code
 *    - Separated by dashed lines
 *    - Uses native CODE128 commands (fast, reliable)
 *    - Recommended for most use cases

 *
 * IMPLEMENTATION NOTES:
 * - printBarcodeLabel: Native commands, single label
 * - printHorizontalBarcodes: Native commands, vertical layout (FAST)
 * - printSideBySideBarcodes: Image-based, side-by-side layout (PRECISE)
 */

const { ThermalPrinter, PrinterTypes, CharacterSet, BreakLine } = require('node-thermal-printer');
const logger = require('../config/logger');
const bwipjs = require('bwip-js');
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

class PrinterService {
  constructor(config = {}) {
    this.config = {
      ipAddress: config.ipAddress || process.env.DEFAULT_PRINTER_IP || '192.168.1.220',
      port: config.port || parseInt(process.env.DEFAULT_PRINTER_PORT) || 9100,
      timeout: config.timeout || parseInt(process.env.PRINTER_TIMEOUT) || 5000,
      ...config
    };

    // XPrinter XP-365B specifications
    // Resolution: 203 DPI
    // Paper width: 76mm (typical for 80mm thermal paper with margins)
    // 76mm × 203 DPI / 25.4mm = ~607 dots width
    // Character width: 48 characters per line (standard for 80mm paper)
    this.PRINTER_SPECS = {
      DPI: 203,
      PAPER_WIDTH_MM: 76,
      PAPER_WIDTH_DOTS: 607,
      CHARS_PER_LINE: 48,
      LABEL_WIDTH_MM: 35,
      LABEL_HEIGHT_MM: 22,
      MARGIN_MM: 3
    };

    this.printer = null;
    this.isConnected = false;
  }

  /**
   * Initialize printer connection
   */
  async initialize() {
    try {
      this.printer = new ThermalPrinter({
        type: PrinterTypes.EPSON,
        interface: `tcp://${this.config.ipAddress}:${this.config.port}`,
        characterSet: CharacterSet.PC437_USA,
        removeSpecialCharacters: false,
        lineCharacter: "=",
        breakLine: BreakLine.WORD,
        width: this.PRINTER_SPECS.CHARS_PER_LINE, // 48 characters per line for 76-80mm paper
        options: {
          timeout: this.config.timeout,
        }
      });

      // Test connection
      const isConnected = await this.printer.isPrinterConnected();
      this.isConnected = isConnected;

      if (isConnected) {
        logger.info(`Printer connected successfully at ${this.config.ipAddress}:${this.config.port}`);
      } else {
        logger.warn(`Printer not responding at ${this.config.ipAddress}:${this.config.port}`);
      }

      return { success: isConnected, message: isConnected ? 'Connected' : 'Not responding' };
    } catch (error) {
      logger.error('Failed to initialize printer:', error);
      this.isConnected = false;
      return { success: false, message: error.message };
    }
  }

  /**
   * Test printer connection
   */
  async testConnection() {
    try {
      if (!this.printer) {
        await this.initialize();
      }

      const isConnected = await this.printer.isPrinterConnected();
      this.isConnected = isConnected;

      return {
        isConnected,
        ipAddress: this.config.ipAddress,
        port: this.config.port,
        errorMessage: isConnected ? null : 'Printer not responding'
      };
    } catch (error) {
      logger.error('Connection test failed:', error);
      this.isConnected = false;
      return {
        isConnected: false,
        ipAddress: this.config.ipAddress,
        port: this.config.port,
        errorMessage: error.message
      };
    }
  }

  /**
   * Print barcode labels optimized for XPrinter XP-365B
   * Paper: 76mm thermal paper (203 DPI)
   * Label dimensions: 35mm × 22mm
   * @param {Object} productData - Product information {productCode, productName}
   * @param {number} quantity - Number of labels to print
   */
  async printBarcodeLabel(productData, quantity = 1) {
    try {
      if (!this.printer) {
        const initResult = await this.initialize();
        if (!initResult.success) {
          throw new Error(`Printer initialization failed: ${initResult.message}`);
        }
      }

      if (!this.isConnected) {
        const testResult = await this.testConnection();
        if (!testResult.isConnected) {
          throw new Error(`Printer not connected: ${testResult.errorMessage}`);
        }
      }

      const { productCode, productName } = productData;

      if (!productCode) {
        throw new Error('Product code is required for barcode printing');
      }

      logger.info(`Printing ${quantity} barcode labels for product: ${productCode}`);

      this.printer.clear();

      // Sanitize and truncate product name
      const sanitizedName = this.sanitizeText(productName || '');
      const charsPerLine = 32; // ~32 chars for full width label at Font B
      const truncatedName = sanitizedName.length > charsPerLine
        ? sanitizedName.substring(0, charsPerLine - 3) + '...'
        : sanitizedName;

      for (let i = 0; i < quantity; i++) {
        // Product name (if provided)
        if (truncatedName) {
          this.printer.alignCenter();
          this.printer.setTypeFontB(); // Smaller font for product name
          this.printer.println(truncatedName);
          this.printer.newLine();
        }

        // Barcode - centered
        // For 35mm width label: ~280 dots at 203 DPI
        // Using CODE128 with optimal sizing
        this.printer.alignCenter();
        this.printer.code128(productCode, {
          width: "MEDIUM",   // Medium width for single label (width=3 dots)
          height: 60,        // ~7.5mm height (60 dots / 203 DPI * 25.4mm)
          text: 2            // Text below barcode
        });

        // Spacing before cut
        this.printer.newLine();
        this.printer.newLine();

        // Cut paper after each label (if supported)
        if (i < quantity - 1) {
          this.printer.cut();
        }
      }

      // Final cut
      this.printer.cut();

      // Execute print job
      const result = await this.printer.execute();

      if (result) {
        logger.info(`Successfully printed ${quantity} barcode labels`);
        return {
          success: true,
          message: `Successfully printed ${quantity} barcode label(s)`,
          data: {
            productCode,
            productName: truncatedName,
            quantity,
            timestamp: new Date().toISOString()
          }
        };
      } else {
        throw new Error('Print execution failed');
      }
    } catch (error) {
      logger.error('Barcode printing failed:', error);
      return {
        success: false,
        message: `Printing failed: ${error.message}`,
        data: null
      };
    }
  }

  /**
   * Sanitize text for thermal printer compatibility
   * Preserves Vietnamese accented characters by keeping them in composed form
   * @param {string} text - Text to sanitize
   * @returns {string} - Sanitized text safe for thermal printing
   */
  sanitizeText(text) {
    if (!text) return '';
    // Keep Vietnamese characters intact, only remove truly incompatible characters
    // Vietnamese Unicode ranges:
    // - Basic Latin: \u0020-\u007E (space to ~)
    // - Latin-1 Supplement: \u00C0-\u00FF (À-ÿ)
    // - Vietnamese specific: \u0102-\u0103 (Ă ă), \u0110-\u0111 (Đ đ)
    // - Latin Extended Additional: \u01A0-\u01B0 (Ơ ơ Ư ư)
    // - Combining diacritics: \u0300-\u0323 (tone marks)
    return text
      .replace(/[^\u0020-\u007E\u00C0-\u00FF\u0102-\u0103\u0110-\u0111\u01A0-\u01B0\u0300-\u0323]/g, '')
      .trim();
  }

  /**
   * Sanitize text to ASCII-only (fallback for maximum compatibility)
   * @param {string} text - Text to sanitize
   * @returns {string} - ASCII-only text
   */
  sanitizeTextASCII(text) {
    if (!text) return '';
    return text
      .normalize('NFD') // Decompose unicode characters
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
      .replace(/[^\x20-\x7E]/g, '?') // Replace non-ASCII with ?
      .trim();
  }

  /**
   * Generate a single barcode image buffer
   * @private
   * @param {string} text - Barcode text
   * @param {Object} options - Barcode generation options
   * @returns {Promise<Buffer>} PNG buffer
   */
  async _generateBarcodeImage(text, options = {}) {
    try {
      const png = await bwipjs.toBuffer({
        bcid: 'code128',
        text,
        scale: options.scale || 2,
        height: options.height || 10,
        includetext: options.includetext || false,
        textxalign: 'center',
      });
      return png;
    } catch (err) {
      logger.error('Error generating barcode image:', err);
      throw err;
    }
  }

  /**
   * Create side-by-side barcode image for dual label printing
   * @private
   * @param {string} code1 - First barcode text
   * @param {string} code2 - Second barcode text
   * @returns {Promise<Buffer>} Combined PNG buffer
   */
  async _createSideBySideBarcodes(code1, code2) {
    try {
      // Generate both barcodes
      const barcode1 = await this._generateBarcodeImage(code1);
      const barcode2 = await this._generateBarcodeImage(code2);

      // Load barcodes as images
      const img1 = await loadImage(barcode1);
      const img2 = await loadImage(barcode2);

      // Create canvas with width for both barcodes
      // Spacing: 20px left margin + img1 + 60px gap + img2 + 20px right margin
      const canvas = createCanvas(
        img1.width + img2.width + 100,
        Math.max(img1.height, img2.height)
      );
      const ctx = canvas.getContext('2d');

      // Fill white background
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw both barcodes
      ctx.drawImage(img1, 20, 0);
      ctx.drawImage(img2, img1.width + 80, 0);

      // Return buffer instead of writing to file
      return canvas.toBuffer('image/png');
    } catch (err) {
      logger.error('Error combining barcodes:', err);
      throw err;
    }
  }

  /**
   * Create single barcode image
   * @private
   * @param {string} code - Barcode text
   * @returns {Promise<Buffer>} PNG buffer
   */
  async _createSingleBarcode(code) {
    try {
      // Generate barcode image
      const barcode = await this._generateBarcodeImage(code);

      // Load barcode as image
      const img = await loadImage(barcode);

      // Create canvas with padding
      const canvas = createCanvas(img.width + 40, img.height);
      const ctx = canvas.getContext('2d');

      // Fill white background
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw barcode
      ctx.drawImage(img, 20, 0);

      // Return buffer
      return canvas.toBuffer('image/png');
    } catch (err) {
      logger.error('Error creating single barcode:', err);
      throw err;
    }
  }

  /**
   * Print side-by-side barcode labels using image-based approach
   * Prints two barcodes per row on 76mm thermal paper (35mm width each label)
   * Paper specs: 76mm width × 203 DPI = ~607 dots, 48 chars/line
   * Label specs: 35mm × 22mm per label
   *
   * This method uses image generation for true side-by-side printing.
   * More resource-intensive but provides precise layout control.
   *
   * @param {Object} productData - Product information {productCode, productName}
   * @param {number} quantity - Number of labels to print
   * @returns {Promise<Object>} Print result
   */
  async printSideBySideBarcodes(productData, quantity = 1) {
    try {
      if (!this.printer) {
        const initResult = await this.initialize();
        if (!initResult.success) {
          throw new Error(`Printer initialization failed: ${initResult.message}`);
        }
      }

      if (!this.isConnected) {
        const testResult = await this.testConnection();
        if (!testResult.isConnected) {
          throw new Error(`Printer not connected: ${testResult.errorMessage}`);
        }
      }

      const { productCode, productName } = productData;

      if (!productCode) {
        throw new Error('Product code is required for barcode printing');
      }

      logger.info(`Printing ${quantity} side-by-side barcode labels for product: ${productCode}`);

      // Calculate rows needed (2 barcodes per row)
      const rows = Math.ceil(quantity / 2);

      // Sanitize product name for thermal printer
      const sanitizedName = this.sanitizeText(productName || '');

      // Calculate text width for each label (22 chars per 35mm label)
      // 48 chars total / 2 labels = 24 chars per label, minus spacing = ~22 chars
      const charsPerLabel = 22;
      const truncatedName = sanitizedName.length > charsPerLabel
        ? sanitizedName.substring(0, charsPerLabel - 3) + '...'
        : sanitizedName;

      this.printer.clear();

      // Create temporary directory for images if it doesn't exist
      const tempDir = path.join(__dirname, '../temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      for (let row = 0; row < rows; row++) {
        const startIndex = row * 2;
        const barcodesInRow = Math.min(2, quantity - startIndex);

        this.printer.setTypeFontB();

        if (barcodesInRow === 2) {
          // Two labels side by side
          // Product names header
          this.printer.tableCustom([
            { text: truncatedName, align: "CENTER", width: 0.48 },
            { text: '', align: "CENTER", width: 0.04 }, // Spacing
            { text: truncatedName, align: "CENTER", width: 0.48 }
          ]);

          // Generate combined barcode image
          const barcodeImageBuffer = await this._createSideBySideBarcodes(productCode, productCode);
          const tempImagePath = path.join(tempDir, `barcode_${Date.now()}_${row}.png`);
          fs.writeFileSync(tempImagePath, barcodeImageBuffer);

          // Print barcode image
          await this.printer.printImage(tempImagePath);

          // Clean up temp file
          fs.unlinkSync(tempImagePath);

          // Product codes below barcodes
          this.printer.tableCustom([
            { text: productCode, align: "CENTER", width: 0.48 },
            { text: '', align: "CENTER", width: 0.04 },
            { text: productCode, align: "CENTER", width: 0.48 }
          ]);

        } else {
          // Single label (odd quantity last item)
          this.printer.tableCustom([
            { text: truncatedName, align: "CENTER", width: 0.48 }
          ]);

          // Generate single barcode image
          const barcodeImageBuffer = await this._createSingleBarcode(productCode);
          const tempImagePath = path.join(tempDir, `barcode_${Date.now()}_${row}.png`);
          fs.writeFileSync(tempImagePath, barcodeImageBuffer);

          // Print barcode image
          this.printer.alignLeft();
          await this.printer.printImage(tempImagePath);

          // Clean up temp file
          fs.unlinkSync(tempImagePath);

          // Product code
          this.printer.tableCustom([
            { text: productCode, align: "CENTER", width: 0.48 }
          ]);
        }

        // Spacing between rows
        this.printer.newLine();
        this.printer.newLine();

        // Add extra spacing between rows if not the last row
        if (row < rows - 1) {
          this.printer.newLine();
        }
      }

      // Final cut
      this.printer.cut();

      // Execute print job
      const result = await this.printer.execute();

      if (!result) {
        throw new Error('Print execution failed');
      }

      logger.info(`Successfully printed ${quantity} side-by-side barcode labels in ${rows} rows`);
      return {
        success: true,
        message: `Successfully printed ${quantity} side-by-side barcode label(s) in ${rows} row(s)`,
        data: {
          productCode,
          productName: truncatedName,
          quantity,
          rows,
          method: 'image-based',
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      logger.error('Side-by-side barcode printing failed:', error);
      return {
        success: false,
        message: `Printing failed: ${error.message}`,
        data: null
      };
    }
  }

  /**
   * Print horizontal barcode layout (optimized for XPrinter XP-365B)
   * Prints labels vertically (stacked) on 76mm thermal paper
   * Paper specs: 76mm width × 203 DPI = ~607 dots, 48 chars/line
   * Label specs: 35mm × 22mm per label
   *
   * This method uses native CODE128 commands for reliability and speed.
   * Labels are printed one per row with separator lines.
   *
   * For true side-by-side printing, use printSideBySideBarcodes() instead.
   */
  async printHorizontalBarcodes(productData, quantity = 1) {
    try {
      if (!this.printer) {
        const initResult = await this.initialize();
        if (!initResult.success) {
          throw new Error(`Printer initialization failed: ${initResult.message}`);
        }
      }

      if (!this.isConnected) {
        const testResult = await this.testConnection();
        if (!testResult.isConnected) {
          throw new Error(`Printer not connected: ${testResult.errorMessage}`);
        }
      }

      const { productCode, productName } = productData;

      if (!productCode) {
        throw new Error('Product code is required for barcode printing');
      }

      logger.info(`Printing ${quantity} barcode labels for product: ${productCode}`);

      // Sanitize product name for thermal printer
      const sanitizedName = this.sanitizeText(productName || '');

      // For full-width labels: ~32 characters
      const charsPerLabel = 32;
      const truncatedName = sanitizedName.length > charsPerLabel
        ? sanitizedName.substring(0, charsPerLabel - 3) + '...'
        : sanitizedName;

      this.printer.clear();

      // Print each label individually (more reliable than side-by-side)
      for (let i = 0; i < quantity; i++) {
        // Product name
        this.printer.setTypeFontB();
        this.printer.alignCenter();
        this.printer.println(truncatedName);
        this.printer.newLine();

        // Barcode - centered
        this.printer.alignCenter();
        this.printer.code128(productCode, {
          width: "MEDIUM",    // Medium width for better readability (3 dots)
          height: 60,          // ~7.6mm height (60 dots / 203 DPI * 25.4mm)
          text: 2              // Text below barcode
        });

        // Spacing between labels
        this.printer.newLine();
        this.printer.newLine();

        // Add dashed line separator between labels (except last one)
        if (i < quantity - 1) {
          this.printer.drawLine();
          this.printer.newLine();
        }
      }

      // Final cut
      this.printer.cut();

      // Execute print job
      const result = await this.printer.execute();

      if (!result) {
        throw new Error('Print execution failed');
      }

      logger.info(`Successfully printed ${quantity} barcode labels`);
      return {
        success: true,
        message: `Successfully printed ${quantity} barcode label(s)`,
        data: {
          productCode,
          productName: truncatedName,
          quantity,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      logger.error('Barcode printing failed:', error);
      return {
        success: false,
        message: `Printing failed: ${error.message}`,
        data: null
      };
    }
  }

  /**
   * Get printer status
   */
  async getStatus() {
    try {
      const connectionTest = await this.testConnection();
      return {
        success: true,
        data: {
          isConnected: connectionTest.isConnected,
          ipAddress: this.config.ipAddress,
          port: this.config.port,
          printerModel: 'XP 365B',
          status: connectionTest.isConnected ? 'online' : 'offline',
          lastChecked: new Date().toISOString()
        }
      };
    } catch (error) {
      logger.error('Status check failed:', error);
      return {
        success: false,
        message: error.message,
        data: null
      };
    }
  }

  /**
   * Update printer configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.printer = null; // Force re-initialization
    this.isConnected = false;
    logger.info('Printer configuration updated:', this.config);
  }

  /**
   * Disconnect printer
   */
  async disconnect() {
    try {
      if (this.printer) {
        // Clear any pending jobs
        this.printer.clear();
        this.printer = null;
      }
      this.isConnected = false;
      logger.info('Printer disconnected');
      return { success: true, message: 'Disconnected successfully' };
    } catch (error) {
      logger.error('Disconnect failed:', error);
      return { success: false, message: error.message };
    }
  }
}

module.exports = PrinterService;