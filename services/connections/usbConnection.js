/**
 * USB Connection
 *
 * Two strategies are supported, selected via `mode`:
 *
 *   - `spooler` (default): Pipe raw bytes to the OS print spooler. Requires
 *     the XP-365B to be installed in the OS as a printer (CUPS on
 *     macOS/Linux, Windows print queue on Windows). No native deps.
 *
 *   - `libusb`: Talk directly to the printer over USB using libusb
 *     (`usb` npm). Requires the optional `usb` package and, on some systems,
 *     udev rules / driver unbinding. Useful when the machine has no printer
 *     driver installed.
 *
 * Both strategies expose the same interface (`isAlive`, `send`, `describe`).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const DEFAULT_XPRINTER_VENDOR_ID = 0x0483;   // common XPrinter vendor id
const DEFAULT_XPRINTER_PRODUCT_ID = 0x5743;  // XP-365B (may vary per firmware)

class UsbConnection {
  /**
   * @param {Object} config
   * @param {'spooler'|'libusb'} [config.mode='spooler']
   * @param {string} [config.printerName]        - Required in spooler mode
   * @param {number} [config.vendorId]           - Required in libusb mode
   * @param {number} [config.productId]          - Required in libusb mode
   * @param {number} [config.interface=0]
   * @param {number} [config.timeout=5000]
   */
  constructor(config = {}) {
    this.mode = config.mode || 'spooler';
    this.timeout = config.timeout || 5000;
    this.type = `usb-${this.mode}`;

    if (this.mode === 'spooler') {
      if (!config.printerName) {
        throw new Error('UsbConnection (spooler): printerName is required');
      }
      this.printerName = config.printerName;
    } else if (this.mode === 'libusb') {
      this.vendorId = config.vendorId || DEFAULT_XPRINTER_VENDOR_ID;
      this.productId = config.productId || DEFAULT_XPRINTER_PRODUCT_ID;
      this.interfaceNumber = config.interface != null ? config.interface : 0;
    } else {
      throw new Error(`UsbConnection: unsupported mode "${this.mode}"`);
    }
  }

  describe() {
    if (this.mode === 'spooler') return `usb+spooler://${this.printerName}`;
    return `usb+libusb://${this.vendorId.toString(16)}:${this.productId.toString(16)}`;
  }

  async isAlive() {
    try {
      if (this.mode === 'spooler') return await this._spoolerIsAlive();
      return this._libusbIsAlive();
    } catch (_e) {
      return false;
    }
  }

  async send(buffer) {
    if (!Buffer.isBuffer(buffer)) {
      throw new Error('UsbConnection.send expects a Buffer');
    }
    if (this.mode === 'spooler') return this._spoolerSend(buffer);
    return this._libusbSend(buffer);
  }

  // --- spooler implementation ---------------------------------------------

  _spoolerIsAlive() {
    return new Promise((resolve) => {
      const platform = os.platform();
      if (platform === 'win32') {
        // Use PowerShell Get-Printer. Non-zero exit = not found / offline.
        const script =
          "$ErrorActionPreference='Stop';" +
          `$p = Get-Printer -Name '${this.printerName.replace(/'/g, "''")}' -ErrorAction SilentlyContinue;` +
          "if ($null -eq $p) { exit 2 };" +
          "if ($p.PrinterStatus -eq 'Offline' -or $p.PrinterStatus -eq 'Error') { exit 3 };" +
          'exit 0';
        execFile(
          'powershell.exe',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
          { timeout: this.timeout },
          (err) => resolve(!err),
        );
      } else {
        // CUPS
        execFile('lpstat', ['-p', this.printerName], { timeout: this.timeout }, (err, stdout) => {
          if (err) return resolve(false);
          resolve(/is idle|now printing|enabled/i.test(String(stdout)));
        });
      }
    });
  }

  async _spoolerSend(buffer) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiom-print-'));
    const tmpFile = path.join(tmpDir, `job-${Date.now()}.bin`);
    fs.writeFileSync(tmpFile, buffer);
    try {
      await this._spawnPrint(tmpFile);
      return { bytesSent: buffer.length };
    } finally {
      try { fs.unlinkSync(tmpFile); } catch (_e) { /* ignore */ }
      try { fs.rmdirSync(tmpDir); } catch (_e) { /* ignore */ }
    }
  }

  _spawnPrint(filePath) {
    return new Promise((resolve, reject) => {
      const platform = os.platform();
      let cmd;
      let args;
      if (platform === 'win32') {
        // True RAW printing via winspool.drv / WritePrinter P/Invoke.
        // Out-Printer wraps the stream as text — it does NOT preserve
        // ESC/POS / TSPL / ZPL bytes. We inline a tiny C# helper via
        // Add-Type and call OpenPrinter/StartDocPrinter/WritePrinter
        // directly, with datatype "RAW" so the spooler skips rendering.
        const printerName = this.printerName.replace(/'/g, "''");
        const rawFile = filePath.replace(/'/g, "''");
        const script = buildWindowsRawPrintScript(printerName, rawFile);
        cmd = 'powershell.exe';
        args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script];
      } else {
        // CUPS: `lp -d <name> -o raw <file>`
        cmd = 'lp';
        args = ['-d', this.printerName, '-o', 'raw', filePath];
      }
      const child = spawn(cmd, args, { timeout: this.timeout });
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.once('error', reject);
      child.once('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Print spooler exited with code ${code}: ${stderr.trim() || 'no stderr'}`));
      });
    });
  }

  // --- libusb implementation ----------------------------------------------
  // `usb` is loaded lazily so the package remains optional. If it is not
  // installed the caller gets a clear error describing how to enable it.

  _loadLibusb() {
    if (this._usbModule) return this._usbModule;
    try {
      // eslint-disable-next-line global-require
      this._usbModule = require('usb');
      return this._usbModule;
    } catch (_e) {
      throw new Error(
        'UsbConnection (libusb): the optional "usb" package is not installed. ' +
          'Run `npm install usb` in proxy-server/ to enable this mode, or switch to USB mode "spooler".',
      );
    }
  }

  _findDevice() {
    const usb = this._loadLibusb();
    const device = usb.findByIds(this.vendorId, this.productId);
    if (!device) {
      throw new Error(
        `USB device ${this.vendorId.toString(16)}:${this.productId.toString(16)} not found. ` +
          'Verify the cable and that the OS has released the device.',
      );
    }
    return device;
  }

  _libusbIsAlive() {
    try {
      const device = this._findDevice();
      device.open();
      device.close();
      return true;
    } catch (_e) {
      return false;
    }
  }

  async _libusbSend(buffer) {
    const device = this._findDevice();
    device.open();
    try {
      const iface = device.interface(this.interfaceNumber);
      if (iface.isKernelDriverActive && iface.isKernelDriverActive()) {
        try { iface.detachKernelDriver(); } catch (_e) { /* ignore */ }
      }
      iface.claim();
      const outEndpoint = iface.endpoints.find((e) => e.direction === 'out');
      if (!outEndpoint) {
        throw new Error('USB device has no OUT endpoint on the selected interface');
      }
      await new Promise((resolve, reject) => {
        outEndpoint.transfer(buffer, (err) => (err ? reject(err) : resolve()));
      });
      await new Promise((resolve) => iface.release(true, () => resolve()));
      return { bytesSent: buffer.length };
    } finally {
      try { device.close(); } catch (_e) { /* ignore */ }
    }
  }
}

// --- Windows RAW print helper ---------------------------------------------
// Kept as a module-level function (not a method) so it is parseable
// independently and easy to unit test. The returned PowerShell script reads
// the file into a byte array and feeds it to winspool.drv::WritePrinter.
function buildWindowsRawPrintScript(printerName, filePath) {
  return [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.IO;',
    'using System.Runtime.InteropServices;',
    'public class AiomRawPrint {',
    '  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]',
    '  public class DOCINFOA {',
    '    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;',
    '    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;',
    '    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;',
    '  }',
    '  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true)]',
    '  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string src, out IntPtr hPrinter, IntPtr pd);',
    '  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true)]',
    '  public static extern bool ClosePrinter(IntPtr hPrinter);',
    '  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true)]',
    '  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);',
    '  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true)]',
    '  public static extern bool EndDocPrinter(IntPtr hPrinter);',
    '  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true)]',
    '  public static extern bool StartPagePrinter(IntPtr hPrinter);',
    '  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true)]',
    '  public static extern bool EndPagePrinter(IntPtr hPrinter);',
    '  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true)]',
    '  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, Int32 dwCount, out Int32 dwWritten);',
    '  public static int SendFile(string printerName, string filePath) {',
    '    byte[] bytes = File.ReadAllBytes(filePath);',
    '    IntPtr h;',
    '    if (!OpenPrinter(printerName, out h, IntPtr.Zero)) return 10;',
    '    try {',
    '      DOCINFOA di = new DOCINFOA();',
    '      di.pDocName = "AIOM RAW";',
    '      di.pDataType = "RAW";',
    '      if (!StartDocPrinter(h, 1, di)) return 11;',
    '      try {',
    '        if (!StartPagePrinter(h)) return 12;',
    '        int written;',
    '        bool ok = WritePrinter(h, bytes, bytes.Length, out written);',
    '        EndPagePrinter(h);',
    '        if (!ok || written != bytes.Length) return 13;',
    '      } finally { EndDocPrinter(h); }',
    '    } finally { ClosePrinter(h); }',
    '    return 0;',
    '  }',
    '}',
    '"@',
    `$code = [AiomRawPrint]::SendFile('${printerName}', '${filePath}')`,
    'exit $code',
  ].join('\n');
}

module.exports = UsbConnection;
