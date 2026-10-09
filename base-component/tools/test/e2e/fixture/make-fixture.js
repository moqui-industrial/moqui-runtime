'use strict';
// Writes acceptance-image.png: white background, the text MOQUI-OR-TEST-731 in large letters, three red circles and two blue
// squares. Plain pixels, no library, no model: the same program gives the same bytes every time (see acceptance-manifest.json).
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const W = 720, H = 360;
const GLYPHS = {
    'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    'Q': ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
    'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    'I': ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
    '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
    'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110']
};

function render() {
    const px = Buffer.alloc(W * H * 3, 255);
    const set = (x, y, r, g, b) => { if (x >= 0 && y >= 0 && x < W && y < H) { const i = (y * W + x) * 3; px[i] = r; px[i + 1] = g; px[i + 2] = b; } };
    const text = 'MOQUI-OR-TEST-731';
    const scale = 5, gap = 1;
    const width = text.length * (5 + gap) * scale - gap * scale;
    let x0 = Math.floor((W - width) / 2);
    const y0 = 28;
    for (const ch of text) {
        const g = GLYPHS[ch];
        for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++) {
            if (g[row][col] !== '1') continue;
            for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) set(x0 + col * scale + dx, y0 + row * scale + dy, 0, 0, 0);
        }
        x0 += (5 + gap) * scale;
    }
    for (const cx of [130, 260, 390]) {
        const cy = 210, r = 55;
        for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++)
            if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) set(x, y, 220, 30, 30);
    }
    for (const sx of [490, 600]) {
        const sy = 160, side = 100;
        for (let y = sy; y < sy + side; y++) for (let x = sx; x < sx + side; x++) set(x, y, 30, 60, 220);
    }
    return px;
}

function crc32(buf) {
    let c, crc = 0xFFFFFFFF;
    for (let n = 0; n < buf.length; n++) {
        c = (crc ^ buf[n]) & 0xFF;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}
function png() {
    const px = render();
    const raw = Buffer.alloc((W * 3 + 1) * H);
    for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
module.exports = { png, sha256: b => crypto.createHash('sha256').update(b).digest('hex') };

if (require.main === module) {
    const out = path.join(__dirname, 'acceptance-image.png');
    const bytes = png();
    fs.writeFileSync(out, bytes);
    console.log(out, bytes.length, 'bytes sha256', module.exports.sha256(bytes));
}
