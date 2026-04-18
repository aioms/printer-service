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

const { ThermalPrinter: PhygridThermalPrinter  } = require('@phygrid/thermal-printer')
const { PeripheralInstance  } = require('@phygrid/hub-client')
const { ThermalPrinter, PrinterTypes, CharacterSet, BreakLine } = require('node-thermal-printer');
const bwipjs = require('bwip-js');
const { createCanvas } = require('canvas');
const fs = require('fs');

const logger = require('../config/logger'); 

// giả sử bạn đã kết nối/prép peripheralInstance tương ứng với máy in
async function printTwoBarcodes(peripheralInstance, barcode) {
  const printer = new PhygridThermalPrinter(PeripheralInstance);

  // Xoá buffer cũ
  printer.clear();

  // Thiết lập khoảng cách / lề nếu cần
  // In barcode 1
  printer.addBarcode(barcode, 'CODE128', {
    width: 2,        // thử width module = 2 – bạn cần test và đo thực tế
    height: 176      // ≈ 22mm nếu máy ~8 dots/mm → 22×8=176 dots
  });

  // Chuyển sang cột thứ 2 – nếu máy/printer hỗ trợ đặt con trỏ ngang
  // Nếu không hỗ trợ, bạn có thể in 2 barcode liên tiếp theo chiều dọc
  // Ở đây giả sử in song song: sử dụng thêm một khoảng ngang (ví dụ text rỗng)
  printer.addText('     '); // khoảng trắng để đẩy sang phải (không phải giải pháp tối ưu)
  printer.addBarcode(barcode, 'CODE128', {
    width: 2,
    height: 176
  });

  // Nếu không in song song mà in nối dưới nhau:
  // printer.newLine();
  // printer.addBarcode(barcode2, 'CODE128', { width:2, height:176 });

  // Kết thúc và thực hiện in
  await printer.print();
  // nếu máy hỗ trợ: máy cut giấy
  // (kiểm tra phương thức cut nếu thư viện hỗ trợ)
}

// Generate a barcode image
async function generateBarcodeImage(text) {
  try {
    const png = await bwipjs.toBuffer({
      bcid: 'code128',
      text,
      scale: 2,
      height: 10,
      includetext: false,
      textxalign: 'center',
    });
    return png;
  } catch (err) {
    console.error('Error generating barcode:', err);
    throw err;
  }
}

// Combine two barcodes side by side
async function createSideBySideBarcodes(code1, code2, outputPath) {
  try {
    // Generate both barcodes
    const barcode1 = await generateBarcodeImage(code1, 'temp1.png');
    const barcode2 = await generateBarcodeImage(code2, 'temp2.png');

    // Load barcodes as images
    const { loadImage } = require('canvas');
    const img1 = await loadImage(barcode1);
    const img2 = await loadImage(barcode2);

    // Create canvas with width for both barcodes
    const canvas = createCanvas(img1.width + img2.width + 100, Math.max(img1.height, img2.height));
    const ctx = canvas.getContext('2d');

    // Fill white background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw both barcodes
    ctx.drawImage(img1, 10, 0);
    ctx.drawImage(img2, img1.width + 100, 0);

    // Save combined image
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(outputPath, buffer);
    console.log(`Combined barcode image saved to ${outputPath}`);

    return outputPath;
  } catch (err) {
    console.error('Error combining barcodes:', err);
    throw err;
  }
}

// One barcode
async function createSingleBarcode(code, outputPath) {
  try {
    // Generate barcode image
    const barcode = await generateBarcodeImage(code, 'temp.png');

    // Load barcode as image
    const { loadImage } = require('canvas');
    const img = await loadImage(barcode);

    // Create canvas with width for barcode
    const canvas = createCanvas(img.width + 100, img.height);
    const ctx = canvas.getContext('2d');

    // Fill white background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw barcode
    ctx.drawImage(img, 20, 0);

    // Save combined image
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(outputPath, buffer);
    console.log(`Single barcode image saved to ${outputPath}`);

    return outputPath;
  } catch (err) {
    console.error('Error creating single barcode:', err);
    throw err;
  }
}

class PrinterService {
  constructor(config = {}) {
    this.config = {
      ipAddress: config.ipAddress || process.env.DEFAULT_PRINTER_IP || '192.168.0.220',
      port: config.port || parseInt(process.env.DEFAULT_PRINTER_PORT) || 9100,
      timeout: config.timeout || parseInt(process.env.PRINTER_TIMEOUT) || 5000,
      ...config
    };
    console.log({ config: this.config })

    this.printer = null;
    this.isConnected = false;
    // Cấu hình cho giấy 74x24mm
    this.paperWidth = 74;  // mm
    this.paperHeight = 24; // mm
    this.printerDPI = 203; // dots per inch
    
    // Tính toán chiều cao barcode (mm sang dots)
    // Với 2 barcodes trên 24mm, mỗi cái khoảng 10mm
    this.barcodeHeight = this.mmToDots(10);
  }

  // Chuyển đổi mm sang dots
  mmToDots(mm) {
    return Math.round((mm * this.printerDPI) / 25.4);
  }

  // Lấy thông tin cấu hình hiện tại
  getConfig() {
    return {
      paperWidth: this.paperWidth,
      paperHeight: this.paperHeight,
      printerDPI: this.printerDPI,
      barcodeHeight: this.barcodeHeight,
      barcodeHeightMM: Math.round((this.barcodeHeight * 25.4) / this.printerDPI)
    };
  }

  /**
   * Initialize printer connection
   */
  async initialize() {
    try {
      this.printer = new ThermalPrinter({
        type: PrinterTypes.EPSON,
        interface: `tcp://${this.config.ipAddress}:${this.config.port}`,
        characterSet: CharacterSet.PC852_LATIN2,
        removeSpecialCharacters: false,
        // lineCharacter: "=",
        breakLine: BreakLine.WORD,
        // width: 80,
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
   * Print barcode labels with 35mm x 22mm dimensions
   * Printable area: 76mm x 24mm (approximately 288 x 91 dots at 203 DPI)
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

      // Clear any previous content
      this.printer.clear();

      for (let i = 0; i < quantity; i++) {
        // Set paper size for 35mm x 22mm labels (approximately 132 x 83 dots at 203 DPI)
        // Using smaller margins to fit the 35mm width

        // Product name (if provided) - truncated to fit 35mm width
        if (productName) {
          this.printer.alignCenter();
          // Use smaller font and truncate long names
          const truncatedName = productName.length > 16 ? productName.substring(0, 16) + '...' : productName;
          this.printer.setTextSize(0, 0); // Small font
          this.printer.println(truncatedName);
          this.printer.newLine();
        }

        // Barcode - positioned in center
        this.printer.alignCenter();

        // Print barcode with optimal size for 35mm width
        // Using CODE128 format with appropriate width and height
        this.printer.code128(productCode, {
          width: 'SMALL',    // Smaller width to fit 35mm
          height: 40,        // Reduced height to fit 22mm with text
          text: 1            // Show text below barcode
        });

        // Add some spacing
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
      console.log({ result })

      if (result) {
        logger.info(`Successfully printed ${quantity} barcode labels`);
        return {
          success: true,
          message: `Successfully printed ${quantity} barcode label(s)`,
          data: {
            productCode,
            productName,
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

  // Helper function to sanitize text for ASCII/Unicode compatibility
  // Preserves Vietnamese accented characters
  // sanitizeText(text){
  //   if (!text) return '';
  //   // Only accept Vietnamese characters and basic ASCII
  //   // Exclude other languages like Chinese, Japanese, Korean, etc.
  //   // Vietnamese Unicode ranges:
  //   // - Basic Latin: \u0020-\u007E (space to ~)
  //   // - Latin-1 Supplement: \u00C0-\u00FF (À-ÿ)
  //   // - Vietnamese specific: \u0102-\u0103 (Ă ă), \u0110-\u0111 (Đ đ)
  //   // - Latin Extended Additional: \u01A0-\u01B0 (Ơ ơ Ư ư)
  //   // - Combining diacritics: \u0300-\u0323 (tone marks)
  //   return text
  //     .normalize('NFD') // Decompose unicode characters
  //     .replace(/[^\u0020-\u007E\u00C0-\u00FF\u0102-\u0103\u0110-\u0111\u01A0-\u01B0\u0300-\u0323]/g, '')
  //     .trim();
  // };

  sanitizeTextStandard(text){
    if (!text) return '';
    // Convert to ASCII-safe characters, replace non-ASCII with safe alternatives
    return text
      .normalize('NFD') // Decompose unicode characters
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
      .replace(/[^\x20-\x7E]/g, '?') // Replace non-ASCII with ?
      .trim();
  };

  /**
   * Print horizontal barcode layout (alternative layout)
   * Prints two barcodes per row on 76x24mm paper (35x20mm each barcode stamp)
   * Format: Product name above barcode, product code below barcode, everything centered
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

      logger.info(`Printing ${quantity} horizontal barcode labels (35x20mm each) for product: ${productCode}`);

      // this.printer.clear();
      // return this.testPrintBarcode(productCode, productName, quantity);

      // Calculate rows needed (2 barcodes per row)
      const rows = Math.ceil(quantity / 2);
      console.log({ rows, quantity });

      // Create combined barcode image
      const combinedPath = './assets/combined.png'
      const singleBarcodePath = './assets/single.png'

      await createSideBySideBarcodes(productCode, productCode, combinedPath);

      if (quantity % 2 !== 0) {
        await createSingleBarcode(productCode, singleBarcodePath);
      }

      const sanitizedName = this.sanitizeTextStandard(productName);
      const name = sanitizedName.length > 50 ? sanitizedName.substring(0, 48) + '...' : sanitizedName;
      const isOneRowName = name.length <= 27;

      const getSize = () => {
        return {
          width: this.printer.getWidth(),
          config: this.printer.config
        }
      }

      for (let row = 0; row < rows; row++) {
        // printTwoBarcodes(productCode)
        const startIndex = row * 2;
        const barcodesInRow = Math.min(2, quantity - startIndex);
        
        console.log({
          startIndex,
          barcodesInRow,
          name_length: sanitizedName.length,
          name,
          isOneRowName
        });

        this.printer.setTypeFontB();

        this.printer.newLine();
        this.printer.newLine();

        if (barcodesInRow === 2) {

          this.printer.tableCustom([
            { text: name, align: "CENTER", width: 0.57 },
            { text: '', align: "CENTER", width: 0.05 },
            { text: name, align: "CENTER", width: 0.57 }
          ]);

          await this.printer.printImage(combinedPath);
          // this.printer.newLine();

          // this.printer.tableCustom([
          //   { text: productCode, align: "CENTER", width: 0.64 },
          //   { text: productCode, align: "CENTER", width: 0.64 }
          // ]);

        } else if (barcodesInRow === 1) {
          this.printer.alignLeft();

          this.printer.tableCustom([
            { text: name, align: "CENTER", width: 0.6 },
          ]);

          await this.printer.printImage(singleBarcodePath);
          // this.printer.newLine();

          // this.printer.tableCustom([
          //   { text: productCode, align: "CENTER", width: 0.64 },
          // ]);
        }

        // Add spacing between rows
        if (isOneRowName) {
          this.printer.newLine();
          this.printer.newLine();
        } else {
          this.printer.newLine();
        }

      }

      // Final cut
      // this.printer.cut();
      await this.printer.execute();

      logger.info(`Successfully printed ${quantity} horizontal barcode labels in ${rows} rows`);
      return {
        success: true,
        message: `Successfully printed ${quantity} horizontal barcode label(s) in ${rows} row(s)`,
        data: {
          productCode,
          productName: this.sanitizeTextStandard(productName),
          quantity,
          rows,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      logger.error('Horizontal barcode printing failed:', error);
      return {
        success: false,
        message: `Printing failed: ${error.message}`,
        data: null
      };
    }
  }

  async testPrintBarcode(productCode, productName, quantity) {
    // Create combined barcode image
    const combinedPath = './assets/combined.png'
    await createSideBySideBarcodes(productCode, productCode, combinedPath);

    const sanitizedName = productName ? this.sanitizeText(productName) : '';

    this.printer.setTypeFontB();

    this.printer.tableCustom([
      { text: sanitizedName, align: "CENTER", width: 0.64 },
      // { text: '', align: "CENTER", width: 0.5 },
      { text: sanitizedName, align: "CENTER", width: 0.64 }
    ]);

    await this.printer.printImage(combinedPath);
    this.printer.newLine();

    // this.printer.printBarcode(productCode, 73, {
    //   width: 2,          // Minimum width (1 = narrowest bars)
    //   height: 80,        // Reduced height for 20mm stamp
    //   hriPos: 0,        // human-readable printed below (0 = none, 1 = below, 2 = above, etc.)
    //   hriFont: 0        // font for human-readable (0 or 1)
    // });

    // this.printer.println(' ');
    // Move to second position:
    // this.printer.raw(escSetAbsolutePos(secondPosDots));

    // this.printer.printBarcode(productCode, 73, {
    //   width: 2,          // Minimum width (1 = narrowest bars)
    //   height: 80,        // Reduced height for 20mm stamp
    //   hriPos: 0,        // human-readable printed below (0 = none, 1 = below, 2 = above, etc.)
    //   hriFont: 0        // font for human-readable (0 or 1)
    // });

    // await this.printer.printImage(combinedPath)

    this.printer.tableCustom([
      { text: productCode, align: "CENTER", width: 0.64 },
      // { text: '', align: "CENTER", width: 0.5 },
      { text: productCode, align: "CENTER", width: 0.64 }
    ]);

    this.printer.newLine();

    // this.printer.cut();
    const result = await this.printer.execute();
    console.log({ result });

    return { success: true, message: 'Test print successful' };
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