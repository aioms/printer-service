/**
 * Vietnamese text encoder helpers.
 *
 * XPrinter XP-365B ESC/POS firmware ships with a TCVN-3 / VISCII-compatible
 * Vietnamese code page (page 30 on most firmware revisions). Some units only
 * expose Windows-1258 (page 45). The helpers below expose three strategies so
 * the driver can fall back gracefully:
 *
 *   1. `toTcvn3(text)`           – byte buffer encoded with TCVN-3 mapping
 *                                  (code page 30). Best quality when supported.
 *   2. `toWindows1258(text)`     – byte buffer for CP1258 (code page 45).
 *   3. `toAscii(text)`           – accent-stripped ASCII fallback. Works on
 *                                  every mode/driver but loses diacritics.
 *
 * For TSPL/ZPL label mode the recommended path is to render Vietnamese text as
 * a bitmap (see drivers) because those command sets do not reliably accept
 * multi-byte Vietnamese code pages on XPrinter hardware.
 */

// --- ASCII fallback --------------------------------------------------------

function toAscii(text) {
  if (!text) return '';
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7E]/g, '?')
    .trim();
}

// --- TCVN-3 (ESC/POS code page 30) ----------------------------------------
// Reference: TCVN 5712:1993 / VNI-style single-byte mapping widely used by
// XPrinter XP-365B firmware. Only the most common Vietnamese precomposed
// characters are mapped; anything not in the table falls back to ASCII.

const TCVN3_MAP = buildMap({
  'à': 0x81, 'ả': 0x82, 'ã': 0x83, 'á': 0x84, 'ạ': 0x85,
  'ă': 0x86, 'ằ': 0x87, 'ẳ': 0x88, 'ẵ': 0x89, 'ắ': 0x8a, 'ặ': 0x8b,
  'â': 0x8c, 'ầ': 0x8d, 'ẩ': 0x8e, 'ẫ': 0x8f, 'ấ': 0x90, 'ậ': 0x91,
  'đ': 0xf0,
  'è': 0x92, 'ẻ': 0x93, 'ẽ': 0x94, 'é': 0x95, 'ẹ': 0x96,
  'ê': 0x97, 'ề': 0x98, 'ể': 0x99, 'ễ': 0x9a, 'ế': 0x9b, 'ệ': 0x9c,
  'ì': 0x9d, 'ỉ': 0x9e, 'ĩ': 0x9f, 'í': 0xa0, 'ị': 0xa1,
  'ò': 0xa2, 'ỏ': 0xa3, 'õ': 0xa4, 'ó': 0xa5, 'ọ': 0xa6,
  'ô': 0xa7, 'ồ': 0xa8, 'ổ': 0xa9, 'ỗ': 0xaa, 'ố': 0xab, 'ộ': 0xac,
  'ơ': 0xad, 'ờ': 0xae, 'ở': 0xaf, 'ỡ': 0xb0, 'ớ': 0xb1, 'ợ': 0xb2,
  'ù': 0xb3, 'ủ': 0xb4, 'ũ': 0xb5, 'ú': 0xb6, 'ụ': 0xb7,
  'ư': 0xb8, 'ừ': 0xb9, 'ử': 0xba, 'ữ': 0xbb, 'ứ': 0xbc, 'ự': 0xbd,
  'ỳ': 0xbe, 'ỷ': 0xbf, 'ỹ': 0xc0, 'ý': 0xc1, 'ỵ': 0xc2,
});

function buildMap(lowerMap) {
  const out = new Map();
  for (const [ch, code] of Object.entries(lowerMap)) {
    out.set(ch, code);
    const upper = ch.toUpperCase();
    if (upper !== ch && upper.length === 1) {
      out.set(upper, code); // XPrinter firmware renders upper/lower from the same glyph slot
    }
  }
  return out;
}

function toTcvn3(text) {
  if (!text) return Buffer.alloc(0);
  const bytes = [];
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    if (code < 0x80) {
      bytes.push(code);
      continue;
    }
    const mapped = TCVN3_MAP.get(ch);
    if (mapped !== undefined) {
      bytes.push(mapped);
    } else {
      // Fallback to accent-stripped ASCII for unmapped glyphs.
      const ascii = toAscii(ch);
      for (let i = 0; i < ascii.length; i++) bytes.push(ascii.charCodeAt(i));
    }
  }
  return Buffer.from(bytes);
}

// --- Windows-1258 ----------------------------------------------------------
// CP1258 uses Unicode precomposed Vietnamese characters in the 0x80-0xFF
// range where possible, and a combining-tone byte for the rest. This table
// covers the precomposed characters XPrinter firmware renders reliably.

// CP1258 precomposed Vietnamese slots (subset). For glyphs that CP1258 encodes
// via a dead-key + base combination (ă, Ă, Ơ, Ư with tones) we fall back to
// accent-stripped ASCII — the bitmap rendering path in TSPL/ZPL should be
// used when perfect Vietnamese is required on non-ESC/POS modes.
const CP1258_MAP = buildMap({
  'à': 0xe0, 'á': 0xe1, 'â': 0xe2, 'ã': 0xe3,
  'è': 0xe8, 'é': 0xe9, 'ê': 0xea,
  'ì': 0xec, 'í': 0xed,
  'ò': 0xf2, 'ó': 0xf3, 'ô': 0xf4, 'õ': 0xf5,
  'ù': 0xf9, 'ú': 0xfa,
  'ý': 0xfd,
  'đ': 0xf0,
});

function toWindows1258(text) {
  if (!text) return Buffer.alloc(0);
  const bytes = [];
  for (const ch of String(text).normalize('NFC')) {
    const code = ch.codePointAt(0);
    if (code < 0x80) {
      bytes.push(code);
      continue;
    }
    const mapped = CP1258_MAP.get(ch);
    if (mapped !== undefined) bytes.push(mapped);
    else {
      const ascii = toAscii(ch);
      for (let i = 0; i < ascii.length; i++) bytes.push(ascii.charCodeAt(i));
    }
  }
  return Buffer.from(bytes);
}

// --- Sanitisers ------------------------------------------------------------

/**
 * Keep Vietnamese characters intact, drop non-printable control chars.
 * Safe for image-based rendering (TSPL/ZPL bitmap path).
 */
function sanitizeForBitmap(text) {
  if (!text) return '';
  return String(text)
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '') // control chars
    .trim();
}

module.exports = {
  toAscii,
  toTcvn3,
  toWindows1258,
  sanitizeForBitmap,
  // Encoding ids we expose to drivers
  ENCODINGS: {
    ASCII: 'ascii',
    TCVN3: 'tcvn3',
    CP1258: 'cp1258',
  },
};
