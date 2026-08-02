const dgram = require('dgram');
const net = require('net');
const os = require('os');
const logger = require('../config/logger');

class PrinterDiscoveryService {
  constructor() {
    this.discoveredPrinters = new Map();
  }

  /**
   * Discover printers using UDP Broadcast (fastest, standard for Xprinter).
   * @param {number} timeoutMs
   * @returns {Promise<Array>}
   */
  async discoverViaUDP(timeoutMs = 1000) {
    return new Promise((resolve) => {
      const socket = dgram.createSocket('udp4');
      const printers = [];

      socket.on('error', (err) => {
        logger.error(`UDP socket error:\n${err.stack}`);
        socket.close();
        resolve(printers);
      });

      socket.on('message', (msg, rinfo) => {
        // Xprinter typically responds with an identifier.
        // We just record the IP and port.
        logger.info(`Received UDP response from ${rinfo.address}:${rinfo.port}`);
        if (!printers.find(p => p.ip === rinfo.address)) {
          printers.push({
            ip: rinfo.address,
            port: 9100, // standard raw TCP port
            mac: 'unknown',
            model: 'Xprinter/POS',
            source: 'udp'
          });
        }
      });

      socket.bind(() => {
        socket.setBroadcast(true);
        // Xprinter config tool broadcasts on port 40000
        const message = Buffer.from([0x00, 0x00, 0x00, 0x00]); // Often just empty or specific payload, try generic
        
        socket.send(message, 0, message.length, 40000, '255.255.255.255', (err) => {
          if (err) logger.error(`UDP send error: ${err}`);
        });

        // Some printers listen on port 9100 for UDP discovery too
        socket.send(message, 0, message.length, 9100, '255.255.255.255', (err) => {
          if (err) logger.error(`UDP send error: ${err}`);
        });
      });

      setTimeout(() => {
        socket.close();
        resolve(printers);
      }, timeoutMs);
    });
  }

  /**
   * Sweep local subnets using TCP connect to port 9100.
   * @param {number} timeoutMs
   * @returns {Promise<Array>}
   */
  async discoverViaTCPSweep(timeoutMs = 800) {
    const interfaces = os.networkInterfaces();
    const subnets = [];
    
    // Find all IPv4 non-internal subnets
    Object.keys(interfaces).forEach(name => {
      interfaces[name].forEach(iface => {
        if (iface.family === 'IPv4' && !iface.internal) {
          const parts = iface.address.split('.');
          subnets.push(`${parts[0]}.${parts[1]}.${parts[2]}`);
        }
      });
    });

    if (subnets.length === 0) {
      subnets.push('192.168.1');
      subnets.push('192.168.0');
    }

    const printers = [];
    const promises = [];

    // Sweep all detected subnets
    subnets.forEach(subnet => {
      for (let i = 1; i < 255; i++) {
        const ip = `${subnet}.${i}`;
        promises.push(this.checkTcpPort(ip, 9100, timeoutMs).then(isOpen => {
          if (isOpen) {
            printers.push({
              ip,
              port: 9100,
              mac: 'unknown',
              model: 'Thermal Printer',
              source: 'tcp'
            });
          }
        }));
      }
    });

    await Promise.allSettled(promises);
    return printers;
  }

  checkTcpPort(ip, port, timeoutMs) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(timeoutMs);

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(port, ip);
    });
  }

  /**
   * Orchestrates the discovery process.
   */
  async discover() {
    logger.info('Starting printer discovery...');
    
    // 1. Try UDP first (fastest)
    let printers = await this.discoverViaUDP(500);
    
    // 2. If no printers found, fallback to TCP Sweep
    if (printers.length === 0) {
      logger.info('No printers found via UDP, falling back to TCP sweep...');
      printers = await this.discoverViaTCPSweep(500);
    }
    
    logger.info(`Discovery complete. Found ${printers.length} printer(s).`);
    return printers;
  }
}

module.exports = new PrinterDiscoveryService();
