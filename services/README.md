# Printer Services

This folder contains **two generations** of the printer integration. Both
continue to coexist so you can migrate at your own pace:

| File / Folder | Purpose |
|---|---|
| `printerService.js` | Legacy ESC/POS over TCP only. Kept for backward compatibility — no changes. |
| `printerServiceV2.js` | **Rebuilt orchestrator.** Supports USB + LAN transports, ESC/POS + TSPL + ZPL modes, Vietnamese rendering, connection re-check before each print, and Telegram error reporting. |
| `connections/tcpConnection.js` | TCP/LAN transport (`tcp://ip:9100`). |
| `connections/usbConnection.js` | USB transport — two sub-modes: `spooler` (OS print queue) and `libusb` (requires optional `usb` npm). |
| `drivers/escposDriver.js` | ESC/POS command builder. Uses `node-thermal-printer` for command assembly, our transport layer for delivery. Supports 2-up via composed bitmap (bwip-js + canvas). Vietnamese via TCVN-3 / CP1258 / ASCII fallback. |
| `drivers/tsplDriver.js` | Native TSPL for 76×22 mm labels with precise `(x, y)` positioning. Vietnamese names rendered as `BITMAP`. |
| `drivers/zplDriver.js` | ZPL II output with `^GFA` graphic fields for Vietnamese names. |
| `utils/vietnameseEncoder.js` | TCVN-3 / CP1258 / ASCII encoders + safe sanitiser for bitmap rendering. |
| `utils/telegramNotifier.js` | Lightweight Telegram Bot client for error reports. No extra dependencies (uses `https`). |

## Architecture

```
Ionic React (PWA)
      │
      ▼
proxy-server (Local service, Node.js)      ← you are here
      │
      ▼  RAW ESC/POS | TSPL | ZPL
XP-365B  (USB cable  |  TCP 9100)
```

## Quick start (V2)

```js
const PrinterServiceV2 = require('./services/printerServiceV2');

// Option 1 — read everything from env (see .env.example).
const svc = new PrinterServiceV2();

// Option 2 — inline config.
const svcUsb = new PrinterServiceV2({
  mode: 'tspl',                            // 'escpos' | 'tspl' | 'zpl'
  connection: {
    type: 'usb',
    mode: 'spooler',                       // or 'libusb'
    printerName: 'XP-365B',                // CUPS/Windows printer name
  },
  telegram: { enabled: true },
});

// Always safe to call before printing.
const health = await svc.testConnection();

// Two-up (side-by-side) barcode print on 76×22 mm strips.
const result = await svc.printBarcodeLabels(
  { productCode: 'SKU-001', productName: 'Bánh mì Sài Gòn đặc biệt' },
  6,                                       // total labels
  { layout: 'side-by-side' },              // 'single' | 'side-by-side'
);
```

## Configuration matrix

| `PRINTER_MODE` | Transport | Vietnamese | 2-up on one strip |
|---|---|---|---|
| `escpos` | TCP or USB | TCVN-3 / CP1258 / ASCII | via composed bitmap |
| `tspl`   | TCP or USB | bitmap (BITMAP command) | native (precise `(x, y)`) |
| `zpl`    | TCP or USB | bitmap (`^GFA` field)   | native (precise `(x, y)`) |

## Key behaviours

- **Re-check before every print.** `printBarcodeLabels()` calls `connection.isAlive()` before sending, so a dead printer fails fast with a clear message (and a Telegram alert) instead of timing out on the wire.
- **Vietnamese-safe.**
  - ESC/POS driver switches the code page to TCVN-3 (`ESC t 30`) before emitting Vietnamese bytes. Falls back to CP1258 (`ESC t 45`) or plain ASCII if configured.
  - TSPL / ZPL drivers render Vietnamese text as a monochrome bitmap, so the output is glyph-perfect regardless of printer firmware.
- **Telegram reporting.** Set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` in `.env`. Every failed preflight / print call produces a structured `🚨` message with context (product code, transport, mode). Duplicate messages are suppressed within a 30 s window.

## USB setup

### Mode `spooler` (recommended — no native deps)

1. Install the XP-365B in the OS (CUPS on macOS/Linux, Windows Printers).
2. Put the printer **name** into `PRINTER_USB_NAME` (matches `lpstat -p` on *nix or `wmic printer get name` on Windows).
3. `PRINTER_USB_MODE=spooler`.

### Mode `libusb` (bare-metal USB — optional)

1. `npm install usb` inside `proxy-server/`.
2. On macOS/Linux, make sure the printer driver is **not** already claiming the device (unload the printer in System Settings or add a udev rule).
3. Set `PRINTER_USB_VENDOR_ID` and `PRINTER_USB_PRODUCT_ID` in hex.

## Error flow & fallback

```
printBarcodeLabels
    │
    ├── _pickLiveConnection
    │        ├── primary.isAlive()   ──ok──→ use primary
    │        │                        ──no──┐
    │        └── fallback.isAlive()  ──ok──┘→ use fallback + Telegram warn
    │                                   ──no──→ Telegram alert + {success:false}
    │
    ├── driver.buildJob  (ESC/POS | TSPL | ZPL)
    │        │
    │        └── ✖ → Telegram alert + {success:false, message}
    │
    └── liveConnection.send
             │
             └── ✖ → Telegram alert + {success:false, message}
```

When the primary recovers on a later call, the service automatically switches
back and posts an `ℹ️ Printer recovered` note to Telegram.

## HTTP endpoints (`server.js`)

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/printer/v2/describe`     | Dump current V2 config (primary/fallback/mode). |
| `GET`  | `/api/printer/v2/test`         | Liveness probe (tries primary, then fallback). |
| `POST` | `/api/printer/v2/print-barcode` | Print labels. Body: `{ productCode, productName?, quantity?, layout? }`. |

`layout` is `"single"` (default) or `"side-by-side"`.

## Windows testing commands

Windows không có `lp` / `lpstat`. Các lệnh tương đương:

```powershell
# Liệt kê máy in (≈ lpstat -p)
Get-Printer

# Kiểm tra một máy in cụ thể
Get-Printer -Name "XP-365B" | Format-List Name, PrinterStatus, PortName

# Test V2 service (probe primary → fallback)
curl.exe http://localhost:3001/api/printer/v2/test

# Test in thực tế qua USB spooler
curl.exe -X POST http://localhost:3001/api/printer/v2/print-barcode `
  -H "Content-Type: application/json" `
  -d '{\"productCode\":\"SKU-001\",\"productName\":\"Bánh mì\",\"quantity\":2,\"layout\":\"side-by-side\"}'
```

**Windows RAW printing:** Service V2 dùng Win32 API `WritePrinter` qua
PowerShell `Add-Type` (xem `connections/usbConnection.js` →
`buildWindowsRawPrintScript`). `Out-Printer` của PowerShell **không** gửi
được RAW ESC/POS / TSPL / ZPL byte — nó encode stream như text document
trước khi spool.

## Auto-fallback TCP → USB

Cấu hình tối thiểu cho scenario "LAN chính, USB backup":

```ini
# .env
PRINTER_CONNECTION=tcp
DEFAULT_PRINTER_IP=192.168.1.220
DEFAULT_PRINTER_PORT=9100

FALLBACK_PRINTER_CONNECTION=usb
FALLBACK_PRINTER_USB_MODE=spooler
FALLBACK_PRINTER_USB_NAME=XP-365B
```

Mỗi lệnh `print-barcode`:
1. Preflight primary (TCP) — nếu ok → in qua LAN.
2. Nếu fail → preflight fallback (USB) → in qua USB.
3. Telegram warn khi chuyển mạch, info khi primary phục hồi.
4. Response trả về `data.via` (`primary`/`fallback`) và `data.transport`
   (`tcp`/`usb-spooler`/`usb-libusb`) để UI biết đã đi đường nào.
