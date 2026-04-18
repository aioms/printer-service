# Thermal Printer Dimensions Quick Reference

## XPrinter XP-365B - 203 DPI Thermal Printer

### Core Specifications
```
Resolution: 203 DPI (dots per inch)
Paper: 80mm thermal paper (76mm usable width)
Connection: TCP/IP (port 9100)
```

---

## Dimension Conversion Formula

### Millimeters to Dots
```
dots = (millimeters × 203 DPI) ÷ 25.4mm/inch
```

### Dots to Millimeters
```
millimeters = (dots × 25.4mm/inch) ÷ 203 DPI
```

---

## Common Conversions

| Millimeters | Dots (203 DPI) | Use Case |
|-------------|----------------|----------|
| 76mm        | 607 dots       | Paper width |
| 35mm        | 280 dots       | Label width |
| 22mm        | 176 dots       | Label height |
| 10mm        | 80 dots        | Barcode height (max) |
| 7.6mm       | 60 dots        | Barcode height (recommended) |
| 6.3mm       | 50 dots        | Barcode height (compact) |
| 3mm         | 24 dots        | Margin |

---

## Font Dimensions

### Font A (Default)
```
Character size: 12×24 dots
Width: 1.5mm per character
Height: 3.0mm
Characters per line: ~40
```

### Font B (Compact)
```
Character size: 9×17 dots
Width: 1.1mm per character
Height: 2.1mm
Characters per line: ~48
```

---

## Barcode Width Settings

| Setting | Dot Width | Bar Width (mm) | Total Width (typical 10-char CODE128) |
|---------|-----------|----------------|---------------------------------------|
| SMALL   | 2 dots    | 0.25mm         | ~25mm (compact, dual labels) |
| MEDIUM  | 3 dots    | 0.37mm         | ~37mm (recommended, single label) |
| LARGE   | 4 dots    | 0.50mm         | ~50mm (maximum readability) |

---

## Label Layout Calculations

### Single Label (35mm × 22mm)
```
Available width: 35mm = 280 dots
Available height: 22mm = 176 dots

Layout breakdown:
- Product name: Font B (9×17 dots)
  Max chars: 280 ÷ 9 = 31 chars → use 32 with truncation
  Height: 17 dots (2.1mm)
  
- Spacing: 2-3 lines
  Height: ~40 dots (5mm)
  
- Barcode: MEDIUM width, 60 height
  Width: ~296 dots (37mm) - FITS within 280 dots with SMALL/MEDIUM
  Height: 60 dots (7.6mm)
  
- Product code text: Auto-printed below barcode
  Height: 24 dots (3mm)

Total height: 17 + 40 + 60 + 24 = 141 dots (17.7mm) ✓ Fits in 22mm
```

### Dual Labels Side-by-Side (2 × 35mm on 76mm paper)
```
Paper width: 76mm = 607 dots

Dual label layout:
- Label 1: 35mm = 280 dots (46%)
- Spacing: 6mm = 48 dots (8%)
- Label 2: 35mm = 280 dots (46%)
- Total: 608 dots (100%)

Table width distribution:
- Column 1: 0.48 (48%)
- Spacing:  0.04 (4%)
- Column 2: 0.48 (48%)
- Total:    1.00 (100%) ✓

Text per label:
Max chars: 280 ÷ 9 = 31 chars
Practical: 22 chars (includes margins and truncation)
```

---

## Text Truncation Guidelines

### Full-Width Label (Font B)
```
Max characters: 32
Safe limit: 30 (with margins)
Truncation format: "Product name with very lon..."
```

### Half-Width Label (Font B)
```
Max characters: 22
Safe limit: 20 (with margins)
Truncation format: "Product name wi..."
```

### Vietnamese Text Considerations
```
Vietnamese characters: Same width as Latin
Diacritics: Do not add extra width
Example: "Bánh mì" = 7 characters (same as "Banh mi")
```

---

## Spacing and Margins

### Recommended Spacing
```
Between sections: 2 lines (newLine() × 2)
Between labels: 3 lines (newLine() × 3)
Before cut: 2 lines minimum
Left/right margins: 3mm (24 dots) - auto-handled by printer
```

### Line Height by Font
```
Font A: 24 dots (3.0mm) per line
Font B: 17 dots (2.1mm) per line
newLine(): Adds one blank line of current font height
```

---

## Barcode Sizing Recommendations

### CODE128 Barcode

#### For Single Labels (35mm width)
```javascript
{
  width: "MEDIUM",  // 3 dots per bar
  height: 60,       // 7.6mm height
  text: 2           // Show code below
}
// Typical barcode: 10-15 chars = 30-45mm width
// Fits in 35mm label? NO - use SMALL width instead
```

**Correction for 35mm**:
```javascript
{
  width: "SMALL",   // 2 dots per bar ✓
  height: 60,       // 7.6mm height
  text: 2           // Show code below
}
// Typical barcode: 10-15 chars = 20-30mm width ✓ Fits!
```

#### For Full-Width Labels (76mm width)
```javascript
{
  width: "MEDIUM",  // 3 dots per bar
  height: 60,       // 7.6mm height
  text: 2           // Show code below
}
// Typical barcode: 10-15 chars = 30-45mm width ✓ Fits!
```

---

## Print Quality Guidelines

### Minimum Barcode Dimensions (for reliable scanning)
```
Minimum bar width: 0.25mm (2 dots) - SMALL setting
Minimum height: 6mm (48 dots) - recommended 60 dots
Minimum quiet zone: 3mm (24 dots) - auto-handled by printer
```

### Maximum Dimensions
```
Max paper width: 76mm (607 dots)
Max barcode width: 60mm (480 dots) - leave margins
Max barcode height: 15mm (120 dots) - practical limit
```

---

## Code Examples with Dimensions

### Example 1: Compact Label
```javascript
// Target: 35mm × 22mm label with minimal content
printer.setTypeFontB();          // 9×17 dots (1.1×2.1mm)
printer.alignCenter();
printer.println("Product");       // 7 chars × 1.1mm = 7.7mm width

printer.code128("1234567890", {
  width: "SMALL",                 // 2 dots/bar
  height: 50,                     // 6.3mm
  text: 2                         // Code below
});

// Total height: 17 + 50 + 24 = 91 dots (11.4mm) ✓
```

### Example 2: Full-Width Label
```javascript
// Target: 76mm × 30mm label with detailed content
printer.setTypeFontB();
printer.alignCenter();
printer.println("Product Name Here - Max 48 Chars");

printer.newLine();

printer.code128("PRODUCT-12345", {
  width: "MEDIUM",                // 3 dots/bar
  height: 60,                     // 7.6mm
  text: 2
});

// Total height: 17 + 17 + 60 + 24 = 118 dots (14.8mm) ✓
```

---

## Troubleshooting Dimensions

### Issue: Barcode doesn't fit on label
**Diagnosis**: Check barcode width calculation
```javascript
// For CODE128, approximate width:
estimatedWidth = (numberOfCharacters + 2) × barcodeWidth × 11

// Example: 10 chars, MEDIUM width (3 dots)
width = (10 + 2) × 3 × 11 = 396 dots = 49.5mm
// Solution: Use SMALL width or reduce character count
```

### Issue: Text wrapping unexpectedly
**Diagnosis**: Check character limit
```javascript
// Font B on 76mm paper: 48 chars max
text.length > 48 // Will wrap to next line

// Font B on 35mm label: ~31 chars max
text.length > 31 // Will overflow label
```

### Issue: Labels too tall
**Diagnosis**: Calculate total height
```javascript
// Add up all elements:
totalDots = textHeight + spacingHeight + barcodeHeight + codeTextHeight

// Convert to mm:
totalMM = (totalDots × 25.4) / 203

// Must be < label height (22mm for standard label)
```

---

## Quick Reference: Common Patterns

### Pattern 1: Simple Product Label
```
┌─────────────────────────┐ 35mm
│   Product Name Here     │ Font B (17 dots)
│                         │ 
│   ▐▌▐▐▌▐▌▐▐▌▐▐▌▐▌▐▐    │ Barcode (60 dots)
│   1234567890            │ Code text (24 dots)
└─────────────────────────┘
     22mm height
Total: ~101 dots (12.7mm) ✓ Fits
```

### Pattern 2: Detailed Label
```
┌─────────────────────────────────────┐ 76mm
│      Company Name / Header          │ Font A (24 dots)
│                                     │
│   Product Name - Can be long here   │ Font B (17 dots)
│                                     │
│   ▐▌▐▐▌▐▌▐▐▌▐▐▌▐▌▐▐▌▐▌▐▐▌▐▐        │ Barcode (60 dots)
│         PRODUCT-CODE-001             │ Code text (24 dots)
│                                     │
│   Additional info can go here       │ Font B (17 dots)
└─────────────────────────────────────┘
Total: ~142 dots (17.8mm)
```

---

## API Quick Reference

### Setting Up Dimensions
```javascript
// In constructor
this.PRINTER_SPECS = {
  DPI: 203,                    // Dots per inch
  PAPER_WIDTH_MM: 76,          // Paper width in mm
  PAPER_WIDTH_DOTS: 607,       // Paper width in dots
  CHARS_PER_LINE: 48,          // Characters per line (Font B)
  LABEL_WIDTH_MM: 35,          // Single label width
  LABEL_HEIGHT_MM: 22,         // Single label height
  MARGIN_MM: 3                 // Side margins
};
```

### Using Dimensions in Code
```javascript
// Calculate truncation length
const charsPerLabel = Math.floor(
  (this.PRINTER_SPECS.LABEL_WIDTH_MM / this.PRINTER_SPECS.PAPER_WIDTH_MM) 
  × this.PRINTER_SPECS.CHARS_PER_LINE
);
// For 35mm label: (35/76) × 48 = 22 chars

// Calculate barcode size
const barcodeHeight = Math.floor(
  (targetHeightMM × this.PRINTER_SPECS.DPI) / 25.4
);
// For 7.6mm: (7.6 × 203) / 25.4 = 60 dots
```

---

**Last Updated**: 2025-10-19  
**Printer Model**: XPrinter XP-365B  
**Resolution**: 203 DPI  
**Library**: node-thermal-printer v4.5.0
