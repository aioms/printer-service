/**
 * TCP/LAN Connection
 *
 * Raw socket connection to the XP-365B printer (default port 9100).
 * Used by the TSPL/ZPL drivers which need to send raw command bytes.
 * The ESC/POS driver talks through node-thermal-printer directly, but still
 * uses `isAlive()` from here to perform the "always re-check before print"
 * health check required by the service contract.
 */

const net = require('net');

class TcpConnection {
  /**
   * @param {Object} config
   * @param {string} config.ipAddress
   * @param {number} [config.port=9100]
   * @param {number} [config.timeout=5000]
   */
  constructor(config) {
    if (!config || !config.ipAddress) {
      throw new Error('TcpConnection requires ipAddress');
    }
    this.ipAddress = config.ipAddress;
    this.port = config.port || 9100;
    this.timeout = config.timeout || 5000;
    this.type = 'tcp';
  }

  describe() {
    return `tcp://${this.ipAddress}:${this.port}`;
  }

  /**
   * Lightweight liveness probe. Opens a TCP socket and closes immediately.
   * Resolves true/false; never throws.
   */
  async isAlive() {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(this.timeout);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
      socket.connect(this.port, this.ipAddress);
    });
  }

  /**
   * Send a Buffer of raw bytes to the printer. Resolves once the socket
   * finishes flushing the payload. Rejects on connect/write errors so the
   * caller can report via Telegram.
   *
   * @param {Buffer} buffer
   */
  async send(buffer) {
    if (!Buffer.isBuffer(buffer)) {
      throw new Error('TcpConnection.send expects a Buffer');
    }
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(err);
      };
      const ok = () => {
        if (settled) return;
        settled = true;
        socket.end();
        resolve({ bytesSent: buffer.length });
      };
      socket.setTimeout(this.timeout);
      socket.once('timeout', () => fail(new Error(`TCP timeout after ${this.timeout}ms (${this.describe()})`)));
      socket.once('error', (err) => fail(err));
      socket.connect(this.port, this.ipAddress, () => {
        socket.write(buffer, (err) => {
          if (err) return fail(err);
          ok();
        });
      });
    });
  }
}

module.exports = TcpConnection;
