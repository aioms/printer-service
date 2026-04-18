require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const bodyParser = require('body-parser');
const logger = require('./config/logger');
const PrinterService = require('./services/printerService');
const PrinterServiceV2 = require('./services/printerServiceV2');

const app = express();
const PORT = process.env.PORT || 3001;

// Global printer service instances
let printerService = null;     // legacy (printerService.js)
let printerServiceV2 = null;   // new (printerServiceV2.js)

/**
 * Lazily construct the V2 singleton from env. Re-throws so endpoints can
 * return 500 with the original reason (e.g. bad PRINTER_MODE).
 */
const getPrinterServiceV2 = () => {
  if (!printerServiceV2) {
    printerServiceV2 = new PrinterServiceV2();
  }
  return printerServiceV2;
};

// Middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : [
    'http://localhost:8100',
    'capacitor://localhost',
    'ionic://localhost'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(compression());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Morgan logging middleware
app.use(morgan('combined', {
  stream: {
    write: (message) => logger.info(message.trim())
  }
}));

// Error handling middleware
const errorHandler = (err, req, res, next) => {
  logger.error('Unhandled error:', err);

  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message;

  res.status(statusCode).json({
    success: false,
    message,
    timestamp: new Date().toISOString()
  });
};

// Request validation middleware
const validatePrintRequest = (req, res, next) => {
  const { productCode, quantity, layout } = req.body;

  if (!productCode || typeof productCode !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'Product code is required and must be a string'
    });
  }

  // quantity is optional; if present it must be a positive integer in [1, 500].
  if (quantity !== undefined) {
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 1 || quantity > 500) {
      return res.status(400).json({
        success: false,
        message: 'Quantity must be a number between 1 and 500'
      });
    }
  }

  // Layout is optional; if present must be a supported value (V2 only).
  if (layout !== undefined && !['single', 'side-by-side'].includes(layout)) {
    return res.status(400).json({
      success: false,
      message: 'Layout must be "single" or "side-by-side"'
    });
  }

  next();
};

// Initialize printer service
const initializePrinter = (config = {}) => {
  try {
    printerService = new PrinterService(config);
    logger.info('Printer service initialized with config:', config);
    return printerService;
  } catch (error) {
    logger.error('Failed to initialize printer service:', error);
    throw error;
  }
};

// Routes

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Printer proxy server is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Initialize printer with configuration
app.post('/api/printer/init', async (req, res) => {
  try {
    const config = req.body;

    // Validate configuration
    if (config.ipAddress && !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(config.ipAddress)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid IP address format'
      });
    }

    if (config.port && (config.port < 1 || config.port > 65535)) {
      return res.status(400).json({
        success: false,
        message: 'Port must be between 1 and 65535'
      });
    }

    const printer = initializePrinter(config);
    const result = await printer.initialize();

    res.json({
      success: result.success,
      message: result.message,
      data: {
        config: printer.config,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Printer initialization failed:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Test printer connection
app.get('/api/printer/test', async (req, res) => {
  try {
    if (!printerService) {
      printerService = initializePrinter();
    }

    const result = await printerService.testConnection();

    res.json({
      success: result.isConnected,
      message: result.isConnected ? 'Printer connected successfully' : 'Printer connection failed',
      data: result
    });
  } catch (error) {
    logger.error('Connection test failed:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Get printer status
app.get('/api/printer/status', async (req, res) => {
  try {
    if (!printerService) {
      printerService = initializePrinter();
    }

    const result = await printerService.getStatus();
    res.json(result);
  } catch (error) {
    logger.error('Status check failed:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Print barcode labels
app.post('/api/printer/print-barcode', validatePrintRequest, async (req, res) => {
  try {
    const { productCode, productName, quantity = 1, printerConfig } = req.body;

    // Initialize or update printer if config provided
    if (printerConfig) {
      if (printerService) {
        printerService.updateConfig(printerConfig);
      } else {
        printerService = initializePrinter(printerConfig);
      }
    } else if (!printerService) {
      printerService = initializePrinter();
    }

    const productData = { productCode, productName };
    const result = await printerService.printBarcodeLabel(productData, quantity);

    const statusCode = result.success ? 200 : 500;
    res.status(statusCode).json(result);

  } catch (error) {
    logger.error('Barcode printing failed:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Print horizontal barcode labels
app.post('/api/printer/print-horizontal-barcode', validatePrintRequest, async (req, res) => {
  try {
    const { productCode, productName, quantity = 1, printerConfig } = req.body;

    // Initialize or update printer if config provided
    if (printerConfig) {
      if (printerService) {
        printerService.updateConfig(printerConfig);
      } else {
        printerService = initializePrinter(printerConfig);
      }
    } else if (!printerService) {
      printerService = initializePrinter();
    }

    const productData = { productCode, productName };
    const result = await printerService.printHorizontalBarcodes(productData, quantity);

    const statusCode = result.success ? 200 : 500;
    res.status(statusCode).json(result);

  } catch (error) {
    logger.error('Horizontal barcode printing failed:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Update printer configuration
app.put('/api/printer/config', async (req, res) => {
  try {
    const config = req.body;

    if (!printerService) {
      printerService = initializePrinter(config);
    } else {
      printerService.updateConfig(config);
    }

    res.json({
      success: true,
      message: 'Printer configuration updated successfully',
      data: {
        config: printerService.config,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Configuration update failed:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Disconnect printer
app.post('/api/printer/disconnect', async (req, res) => {
  try {
    if (printerService) {
      const result = await printerService.disconnect();
      printerService = null;
      res.json(result);
    } else {
      res.json({
        success: true,
        message: 'No printer connection to disconnect'
      });
    }
  } catch (error) {
    logger.error('Disconnect failed:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ---------------------------------------------------------------------------
// Printer Service V2 routes
// ---------------------------------------------------------------------------
// New endpoints backed by `services/printerServiceV2.js`. These support:
//   - USB (spooler / libusb) + LAN transports
//   - ESC/POS + TSPL + ZPL modes (driven by env PRINTER_MODE)
//   - Automatic TCP → USB fallback (env FALLBACK_PRINTER_CONNECTION)
//   - Connection re-check before every print
//   - Telegram error reporting (env TELEGRAM_*)
// Legacy routes above continue to work unchanged.

// Describe current V2 configuration (for debugging).
app.get('/api/printer/v2/describe', (req, res) => {
  try {
    const svc = getPrinterServiceV2();
    res.json({ success: true, data: svc.describe() });
  } catch (error) {
    logger.error('V2 describe failed:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Liveness test (probes primary, then fallback).
app.get('/api/printer/v2/test', async (req, res) => {
  try {
    const svc = getPrinterServiceV2();
    const result = await svc.testConnection();
    res.json({
      success: result.isConnected,
      message: result.isConnected
        ? `Printer reachable via ${result.using} (${result.target})`
        : result.error || 'Printer not reachable',
      data: result,
    });
  } catch (error) {
    logger.error('V2 test failed:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Print barcode labels (V2).
//
// Body: {
//   productCode: string,
//   productName?: string,
//   quantity?: number,           // 1-500
//   layout?: 'single' | 'side-by-side'
// }
app.post('/api/printer/v2/print-barcode', validatePrintRequest, async (req, res) => {
  try {
    const { productCode, productName, quantity = 1, layout = 'single' } = req.body;
    const svc = getPrinterServiceV2();
    const result = await svc.printBarcodeLabels(
      { productCode, productName },
      quantity,
      { layout },
    );
    const statusCode = result.success ? 200 : 500;
    res.status(statusCode).json(result);
  } catch (error) {
    logger.error('V2 print failed:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.originalUrl
  });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  try {
    if (printerService) {
      await printerService.disconnect();
    }

    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });

    // Force close after 10 seconds
    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000);

  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start server
const server = app.listen(PORT, () => {
  logger.info(`Printer proxy server is running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
});

module.exports = app;