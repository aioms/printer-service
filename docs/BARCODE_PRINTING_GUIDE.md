# Barcode Printing Methods Guide

## Overview

The printer service now provides **three different methods** for printing barcode labels, each optimized for different use cases. All methods are properly dimensioned for the **XPrinter XP-365B (203 DPI, 76mm paper)**.

---

## Available Methods

### 1. `printBarcodeLabel()` - Single Label Printing
**Best for**: Individual product labels, one-at-a-time printing

#### Features
- ✓ Full-width label (35mm × 22mm)
- ✓ Native CODE128 barcode commands
- ✓ Fast and reliable
- ✓ Product name + barcode + code
- ✓ Automatic paper cutting between labels

#### Usage
```javascript
await printerService.printBarcodeLabel({
  productCode: '1234567890',
  productName: 'Sản phẩm thử nghiệm'
}, 5); // Print 5 labels
```

#### Layout
```
┌─────────────────────────┐ 35mm
│   Product Name Here     │ Font B
│                         │ 
│   ▐▌▐▐▌▐▌▐▐▌▐▐▌▐▌▐▐    │ Barcode (CODE128)
│   1234567890            │ Product code
│                         │
└─────────────────────────┘ 22mm
```

#### Performance
- Speed: ⚡⚡⚡ Very Fast
- Resource: 🟢 Low
- Quality: 🟢 Excellent

---

### 2. `printHorizontalBarcodes()` - Vertical Stack Layout
**Best for**: Multiple labels, batch printing, general use

#### Features
- ✓ Vertical stacking (one label per row)
- ✓ Native CODE128 barcode commands
- ✓ Fastest method for multiple labels
- ✓ Dashed separator lines
- ✓ Most reliable for batch jobs

#### Usage
```javascript
await printerService.printHorizontalBarcodes({
  productCode: 'PROD-001',
  productName: 'Bánh mì Việt Nam'
}, 10); // Print 10 labels stacked vertically
```

#### Layout
```
┌─────────────────────────────────────┐ 76mm
│      Product Name Here              │
│                                     │
│   ▐▌▐▐▌▐▌▐▐▌▐▐▌▐▌▐▐▌▐▌▐▐▌▐▐        │
│         PROD-001                     │
├─────────────────────────────────────┤ Separator
│      Product Name Here              │
│                                     │
│   ▐▌▐▐▌▐▌▐▐▌▐▐▌▐▌▐▐▌▐▌▐▐▌▐▐        │
│         PROD-001                     │
└─────────────────────────────────────┘
```

#### Performance
- Speed: ⚡⚡⚡ Very Fast
- Resource: 🟢 Low
- Quality: 🟢 Excellent

---

### 3. `printSideBySideBarcodes()` - Side-by-Side Layout ⭐ NEW
**Best for**: Label sheets, precise dual-column layouts, pre-cut label paper

#### Features
- ✓ True side-by-side printing (2 labels per row)
- ✓ Image-based barcode generation (bwip-js)
- ✓ Precise 35mm × 22mm label positioning
- ✓ Perfect for pre-cut label sheets
- ✓ Professional appearance

#### Usage
```javascript
await printerService.printSideBySideBarcodes({
  productCode: 'TEST-123',
  productName: 'Sản phẩm đặc biệt'
}, 8); // Print 8 labels (4 rows of 2)
```

#### Layout
```
┌─────────────────────┬─────────────────────┐
│   Product Name...   │   Product Name...   │ 35mm each
│                     │                     │
│ ▐▌▐▐▌▐▌▐▐▌▐▐▌▐▌▐▐  │ ▐▌▐▐▌▐▌▐▐▌▐▐▌▐▌▐▐  │
│    TEST-123         │    TEST-123         │
├─────────────────────┼─────────────────────┤
│   Product Name...   │   Product Name...   │
│                     │                     │
│ ▐▌▐▐▌▐▌▐▐▌▐▐▌▐▌▐▐  │ ▐▌▐▐▌▐▌▐▐▌▐▐▌▐▌▐▐  │
│    TEST-123         │    TEST-123         │
└─────────────────────┴─────────────────────┘
        76mm total width
```

#### Performance
- Speed: ⚡⚡ Moderate (image generation overhead)
- Resource: 🟡 Medium (requires bwip-js + canvas)
- Quality: 🟢 Excellent (precise positioning)

---

## Method Comparison

| Feature | printBarcodeLabel | printHorizontalBarcodes | printSideBySideBarcodes |
|---------|-------------------|------------------------|-------------------------|
| **Layout** | Single full-width | Vertical stack | Side-by-side pairs |
| **Labels per row** | 1 | 1 | 2 |
| **Speed** | Very Fast | Very Fast | Moderate |
| **Technology** | Native commands | Native commands | Image generation |
| **Dependencies** | node-thermal-printer | node-thermal-printer | +bwip-js +canvas |
| **Label sheets** | ❌ No | ❌ No | ✅ Yes |
| **Best for** | Individual | Batch | Pre-cut sheets |
| **Resource usage** | Low | Low | Medium |

---

## Technical Details

### Dimension Specifications

All methods use the same calculated dimensions:
- Paper width: 76mm (607 dots at 203 DPI)
- Label size: 35mm × 22mm
- Characters per line: 48 (Font B)
- Barcode format: CODE128

### Text Truncation

| Method | Max Characters | Truncation Example |
|--------|----------------|-------------------|
| printBarcodeLabel | 32 chars | "This is a very long product..." |
| printHorizontalBarcodes | 32 chars | "This is a very long product..." |
| printSideBySideBarcodes | 22 chars | "This is a very lo..." |

### Barcode Settings

#### Native Methods (printBarcodeLabel, printHorizontalBarcodes)
```javascript
{
  width: "MEDIUM",  // 3 dots per bar
  height: 60,       // 7.6mm height
  text: 2           // Show code below barcode
}
```

#### Image Method (printSideBySideBarcodes)
```javascript
{
  bcid: 'code128',
  scale: 2,
  height: 10,
  includetext: false  // Text added separately
}
```

---

## Installation & Setup

### Install Required Dependencies

```bash
cd proxy-server
npm install
```

This will install:
- `node-thermal-printer`: Core thermal printing library
- `bwip-js`: Barcode image generation (for side-by-side)
- `canvas`: Image manipulation (for side-by-side)

### Verify Installation

```javascript
const PrinterService = require('./services/printerService');

const printer = new PrinterService({
  ipAddress: '192.168.1.220',
  port: 9100
});

// Test connection
const status = await printer.testConnection();
console.log(status);
```

---

## Usage Examples

### Example 1: Quick Single Label
```javascript
// Print one label immediately
await printer.printBarcodeLabel({
  productCode: 'SKU-001',
  productName: 'Coffee Beans 500g'
}, 1);
```

### Example 2: Batch Printing (Recommended)
```javascript
// Print 50 labels for inventory
await printer.printHorizontalBarcodes({
  productCode: 'INV-2024-001',
  productName: 'Inventory Item - Electronics'
}, 50);
```

### Example 3: Label Sheets (Side-by-Side)
```javascript
// Print on pre-cut 2-column label sheets
await printer.printSideBySideBarcodes({
  productCode: 'SHEET-001',
  productName: 'Product for Label Sheet'
}, 20); // Prints 10 rows of 2 labels
```

### Example 4: Vietnamese Product Names
```javascript
// Full Vietnamese character support
await printer.printBarcodeLabel({
  productCode: 'VN-001',
  productName: 'Bánh mì Sài Gòn đặc biệt với thịt nguội'
}, 5);
// Output: "Bánh mì Sài Gòn đặc biệt..."
```

---

## Error Handling

All methods return consistent response format:

### Success Response
```javascript
{
  success: true,
  message: "Successfully printed 10 barcode label(s)",
  data: {
    productCode: "PROD-001",
    productName: "Truncated name...",
    quantity: 10,
    rows: 5,  // Only for printSideBySideBarcodes
    method: "image-based",  // Only for printSideBySideBarcodes
    timestamp: "2025-10-19T10:30:00.000Z"
  }
}
```

### Error Response
```javascript
{
  success: false,
  message: "Printing failed: Printer not connected",
  data: null
}
```

### Error Handling Example
```javascript
try {
  const result = await printer.printSideBySideBarcodes({
    productCode: 'TEST',
    productName: 'Test Product'
  }, 10);

  if (result.success) {
    console.log('✓ Print successful:', result.message);
  } else {
    console.error('✗ Print failed:', result.message);
  }
} catch (error) {
  console.error('✗ Unexpected error:', error.message);
}
```

---

## Performance Considerations

### Speed Comparison (10 labels)

| Method | Time | Notes |
|--------|------|-------|
| printBarcodeLabel | ~2 seconds | Native commands |
| printHorizontalBarcodes | ~2 seconds | Native commands |
| printSideBySideBarcodes | ~8 seconds | Image generation + I/O |

### Memory Usage

| Method | RAM Usage | Disk I/O |
|--------|-----------|----------|
| Native methods | ~5 MB | None |
| Image method | ~20 MB | Temporary files |

### Recommendations

1. **For speed**: Use `printHorizontalBarcodes()` for batch jobs
2. **For quality**: Use `printSideBySideBarcodes()` for label sheets
3. **For simplicity**: Use `printBarcodeLabel()` for single items
4. **For large quantities**: Use `printHorizontalBarcodes()` (faster, less resource-intensive)

---

## Troubleshooting

### Issue: Side-by-side images not aligned properly
**Solution**: Check paper width setting and image dimensions
```javascript
// Ensure PRINTER_SPECS are correct
this.PRINTER_SPECS.PAPER_WIDTH_MM = 76;  // Verify this matches your paper
```

### Issue: Barcode images not found
**Solution**: Verify temp directory exists
```javascript
// The service creates temp dir automatically
// But ensure write permissions: chmod 755 proxy-server/temp
```

### Issue: Canvas installation fails
**Solution**: Install build tools
```bash
# macOS
xcode-select --install

# Linux
sudo apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev

# Windows
npm install --global --production windows-build-tools
```

### Issue: Out of memory when printing many labels
**Solution**: Use native methods or process in batches
```javascript
// Instead of printing 1000 at once:
for (let batch = 0; batch < 10; batch++) {
  await printer.printHorizontalBarcodes(productData, 100);
  await new Promise(resolve => setTimeout(resolve, 1000)); // Pause between batches
}
```

---

## Migration Guide

### From Original Image-Based Code

If you were using the original `printHorizontalBarcodes()` with images:

**Before** (Original):
```javascript
await printer.printHorizontalBarcodes(data, 10);
// Used images automatically
```

**After** (Choose method):
```javascript
// Option 1: Use new side-by-side method (same as before)
await printer.printSideBySideBarcodes(data, 10);

// Option 2: Use faster vertical stack method
await printer.printHorizontalBarcodes(data, 10);
```

### API Endpoint Update

If you have an Express endpoint:

```javascript
// Add new route for side-by-side printing
router.post('/print/side-by-side', async (req, res) => {
  const { productCode, productName, quantity } = req.body;
  
  const result = await printerService.printSideBySideBarcodes({
    productCode,
    productName
  }, quantity);
  
  res.json(result);
});

// Keep existing route (now uses vertical stack)
router.post('/print/horizontal', async (req, res) => {
  const { productCode, productName, quantity } = req.body;
  
  const result = await printerService.printHorizontalBarcodes({
    productCode,
    productName
  }, quantity);
  
  res.json(result);
});
```

---

## Advanced Configuration

### Custom Barcode Image Settings

Modify `_generateBarcodeImage()` for custom appearance:

```javascript
async _generateBarcodeImage(text, options = {}) {
  const png = await bwipjs.toBuffer({
    bcid: 'code128',
    text,
    scale: options.scale || 3,        // Increase for higher resolution
    height: options.height || 12,     // Increase for taller barcodes
    includetext: true,                // Show text in barcode image
    textxalign: 'center',
    textsize: 10,                     // Text size
    textfont: 'Inconsolata'           // Font (requires font installation)
  });
  return png;
}
```

### Custom Layout Spacing

Adjust spacing in `_createSideBySideBarcodes()`:

```javascript
// Current: 20px left + 60px gap + 20px right
const canvas = createCanvas(
  img1.width + img2.width + 100,  // Total spacing
  Math.max(img1.height, img2.height)
);

// Tighter spacing:
const canvas = createCanvas(
  img1.width + img2.width + 60,   // Reduce to 60 total
  Math.max(img1.height, img2.height)
);
```

---

## Best Practices

### 1. Choose the Right Method
```javascript
// ✓ Good: Fast batch printing
await printer.printHorizontalBarcodes(data, 100);

// ✗ Avoid: Slow image-based for simple batch
await printer.printSideBySideBarcodes(data, 100);
```

### 2. Handle Errors Gracefully
```javascript
// ✓ Good: Proper error handling
const result = await printer.printBarcodeLabel(data, 5);
if (!result.success) {
  logger.error('Print failed:', result.message);
  // Retry logic or user notification
}

// ✗ Avoid: Ignoring errors
await printer.printBarcodeLabel(data, 5); // No error check
```

### 3. Clean Up Resources
```javascript
// Side-by-side method auto-cleans temp files
// But you can also manually clean:
const tempDir = path.join(__dirname, 'temp');
if (fs.existsSync(tempDir)) {
  const files = fs.readdirSync(tempDir);
  files.forEach(file => {
    if (file.startsWith('barcode_')) {
      fs.unlinkSync(path.join(tempDir, file));
    }
  });
}
```

### 4. Validate Input
```javascript
// ✓ Good: Validate before printing
function validateProductData(data) {
  if (!data.productCode || data.productCode.length < 3) {
    throw new Error('Invalid product code');
  }
  if (data.productName && data.productName.length > 100) {
    data.productName = data.productName.substring(0, 100);
  }
  return data;
}

const validData = validateProductData(productData);
await printer.printBarcodeLabel(validData, 5);
```

---

## Summary

### Quick Decision Guide

**Choose `printBarcodeLabel()` when:**
- ✓ Printing individual labels
- ✓ Need maximum speed
- ✓ Simple one-label-at-a-time workflow

**Choose `printHorizontalBarcodes()` when:**
- ✓ Printing multiple labels
- ✓ Need maximum reliability
- ✓ Don't need side-by-side layout
- ✓ Want fastest batch printing

**Choose `printSideBySideBarcodes()` when:**
- ✓ Using pre-cut label sheets
- ✓ Need precise dual-column layout
- ✓ Professional appearance is priority
- ✓ Have resources for image processing

---

**Last Updated**: 2025-10-19  
**Version**: 2.0  
**Printer**: XPrinter XP-365B (203 DPI)  
**Library**: node-thermal-printer v4.5.0 + bwip-js v4.7.0
