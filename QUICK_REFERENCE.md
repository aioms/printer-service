# Thermal Printer Quick Reference Card

## 🖨️ XPrinter XP-365B Specifications
```
Resolution: 203 DPI
Paper Width: 76mm (usable)
Characters/Line: 48 (Font B)
Label Size: 35mm × 22mm
Connection: TCP/IP Port 9100
```

---

## 📋 Three Printing Methods

### 1️⃣ Single Label - `printBarcodeLabel()`
```javascript
await printer.printBarcodeLabel({
  productCode: 'SKU-001',
  productName: 'Product Name'
}, quantity);
```
**Speed**: ⚡⚡⚡ Very Fast | **Layout**: Full-width | **Best for**: Individual labels

---

### 2️⃣ Vertical Stack - `printHorizontalBarcodes()`
```javascript
await printer.printHorizontalBarcodes({
  productCode: 'SKU-001', 
  productName: 'Product Name'
}, quantity);
```
**Speed**: ⚡⚡⚡ Very Fast | **Layout**: Stacked | **Best for**: Batch printing

---

### 3️⃣ Side-by-Side - `printSideBySideBarcodes()` ⭐
```javascript
await printer.printSideBySideBarcodes({
  productCode: 'SKU-001',
  productName: 'Product Name'  
}, quantity);
```
**Speed**: ⚡⚡ Moderate | **Layout**: 2 columns | **Best for**: Label sheets

---

## 🎯 Quick Decision Matrix

| Need | Use Method | Why |
|------|------------|-----|
| Print 1 label | `printBarcodeLabel()` | Fastest for single |
| Print 100 labels | `printHorizontalBarcodes()` | Fastest for batch |
| Pre-cut sheets | `printSideBySideBarcodes()` | Precise 2-column |
| Maximum speed | `printHorizontalBarcodes()` | Native commands |
| Best quality | `printSideBySideBarcodes()` | Image-based |

---

## 📏 Dimensions Cheat Sheet

### Conversion Formula
```
Dots = (Millimeters × 203) ÷ 25.4
```

### Common Values
| mm | Dots | Usage |
|----|------|-------|
| 76mm | 607 | Paper width |
| 35mm | 280 | Label width |
| 22mm | 176 | Label height |
| 7.6mm | 60 | Barcode height |

---

## 🔧 Barcode Settings

### Native Methods (Fast)
```javascript
{
  width: "MEDIUM",  // 2=SMALL, 3=MEDIUM, 4=LARGE
  height: 60,       // Dots (7.6mm)
  text: 2           // Show code below
}
```

### Image Method (Precise)
```javascript
{
  scale: 2,
  height: 10,
  includetext: false
}
```

---

## ✂️ Text Truncation

| Method | Max Chars | Example |
|--------|-----------|---------|
| Single/Vertical | 32 | "Very long product name here..." |
| Side-by-side | 22 | "Very long produc..." |

---

## 📦 Installation

```bash
cd proxy-server
npm install
```

Dependencies: `node-thermal-printer`, `bwip-js`, `canvas`

---

## 🚀 Quick Start

```javascript
const PrinterService = require('./services/printerService');

const printer = new PrinterService({
  ipAddress: '192.168.1.220',
  port: 9100
});

// Test connection
await printer.testConnection();

// Print labels
const result = await printer.printSideBySideBarcodes({
  productCode: 'TEST-001',
  productName: 'Test Product'
}, 4);

console.log(result.success); // true
```

---

## 🎨 Vietnamese Support

All methods support Vietnamese characters:
```javascript
{
  productName: 'Bánh mì Sài Gòn đặc biệt'
}
// Output: "Bánh mì Sài Gòn đặc biệt..." ✓
```

Supported: Ă, Â, Ê, Ô, Ơ, Ư, Đ + all tone marks

---

## ⚡ Performance

| Method | 10 Labels | 100 Labels |
|--------|-----------|------------|
| Single | ~2s | ~20s |
| Vertical | ~2s | ~20s |
| Side-by-side | ~8s | ~80s |

---

## 🔍 Response Format

```javascript
{
  success: true,
  message: "Successfully printed 10 label(s)",
  data: {
    productCode: "SKU-001",
    productName: "Product...",
    quantity: 10,
    rows: 5,              // Side-by-side only
    method: "image-based", // Side-by-side only
    timestamp: "2025-10-19T10:30:00.000Z"
  }
}
```

---

## 🛠️ Troubleshooting

### Connection Failed
```javascript
// Check IP and port
const status = await printer.testConnection();
console.log(status.isConnected);
```

### Canvas Install Error
```bash
# macOS
xcode-select --install

# Linux  
sudo apt-get install build-essential libcairo2-dev
```

### Text Overflow
```javascript
// Use proper character limits
const name = productName.substring(0, 32) + '...';
```

---

## 📚 Documentation Files

1. **BARCODE_PRINTING_GUIDE.md** - Complete usage guide
2. **CHANGES_SUMMARY.md** - What's new
3. **PRINTER_DIMENSIONS_GUIDE.md** - Technical specs
4. **QUICK_REFERENCE.md** - This file

---

## 💡 Tips

✅ Use `printHorizontalBarcodes()` for most cases  
✅ Use `printSideBySideBarcodes()` for label sheets  
✅ Always validate product codes before printing  
✅ Handle errors with try-catch  
✅ Test with small quantities first  

---

**Version**: 2.1 | **Updated**: 2025-10-19 | **Printer**: XP-365B
