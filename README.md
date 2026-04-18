# AIOS Printer Proxy Server

A Node.js proxy server for thermal printer integration with the AIOS mobile application. This server handles barcode printing requests for the XP 365B thermal printer using the node-thermal-printer library.

## Features

- **Thermal Printer Support**: Optimized for XP 365B thermal printer
- **Barcode Printing**: Support for Code128 barcodes with 35mm x 22mm label dimensions
- **HTTP API**: RESTful endpoints for printer operations
- **Error Handling**: Comprehensive error handling and logging
- **CORS Support**: Configured for Ionic/Capacitor applications
- **Configuration Management**: Flexible printer configuration options

## Installation

1. Navigate to the proxy-server directory:
```bash
cd proxy-server
```

2. Install dependencies:
```bash
yarn install
```

3. Create environment configuration:
```bash
cp .env.example .env
```

4. Edit the `.env` file with your printer configuration:
```env
PORT=3001
DEFAULT_PRINTER_IP=192.168.0.220
DEFAULT_PRINTER_PORT=9100
PRINTER_TIMEOUT=5000
```

## Usage

### Development Mode
```bash
yarn dev
```

### Production Mode
```bash
yarn start
```

The server will start on port 3001 (or the port specified in your .env file).

## API Endpoints

### Health Check
- **GET** `/health`
- Returns server status and version information

### Printer Initialization
- **POST** `/api/printer/init`
- Initialize printer connection with configuration
- Body: `{ "ipAddress": "192.168.0.220", "port": 9100, "timeout": 5000 }`

### Test Connection
- **GET** `/api/printer/test`
- Test printer connectivity

### Get Printer Status
- **GET** `/api/printer/status`
- Get current printer status and configuration

### Print Barcode Labels
- **POST** `/api/printer/print-barcode`
- Print barcode labels with 35mm x 22mm dimensions
- Body:
```json
{
  "productCode": "ABC123",
  "productName": "Sample Product",
  "quantity": 1,
  "printerConfig": {
    "ipAddress": "192.168.0.220",
    "port": 9100,
    "timeout": 5000
  }
}
```

### Print Horizontal Barcode Labels
- **POST** `/api/printer/print-horizontal-barcode`
- Print horizontal layout barcode labels
- Same body format as above

### Update Configuration
- **PUT** `/api/printer/config`
- Update printer configuration
- Body: `{ "ipAddress": "192.168.0.220", "port": 9100, "timeout": 5000 }`

### Disconnect Printer
- **POST** `/api/printer/disconnect`
- Disconnect from printer

## Label Specifications

- **Label Size**: 35mm x 22mm
- **Printable Area**: Optimized for thermal printing
- **Barcode Format**: Code128
- **Layout**: Supports both vertical and horizontal layouts
- **Text**: Product name and barcode value included

## Error Handling

The server includes comprehensive error handling:
- Connection timeouts
- Printer offline detection
- Invalid configuration validation
- Network connectivity issues
- Malformed request handling

## Logging

Logs are written to:
- `logs/combined.log` - All log levels
- `logs/error.log` - Error level only
- Console output in development mode

## Security

- CORS configured for Ionic/Capacitor origins
- Helmet.js for security headers
- Request validation middleware
- Environment-based configuration

## Troubleshooting

### Printer Not Connecting
1. Verify printer IP address and port
2. Check network connectivity
3. Ensure printer is powered on and ready
4. Verify firewall settings

### CORS Issues
1. Check CORS_ORIGIN in .env file
2. Ensure mobile app origin is included
3. Verify request headers

### Print Quality Issues
1. Check label size configuration
2. Verify barcode format compatibility
3. Adjust print density if supported

## Development

### Project Structure
```
proxy-server/
├── config/
│   └── logger.js          # Winston logging configuration
├── services/
│   └── printerService.js  # Thermal printer service
├── logs/                  # Log files
├── server.js             # Main server file
├── package.json          # Dependencies and scripts
└── .env.example          # Environment template
```

### Adding New Features
1. Add new endpoints in `server.js`
2. Extend `PrinterService` class for new functionality
3. Update API documentation
4. Add appropriate error handling and logging

## License

MIT License - see LICENSE file for details.