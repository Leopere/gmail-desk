#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { execFileSync } = require("node:child_process");

const ROOT_DIR = path.join(__dirname, "..");
const ASSETS_DIR = path.join(ROOT_DIR, "assets");
const GENERATED_DIR = path.join(ASSETS_DIR, "generated");
const BUILD_DIR = path.join(ROOT_DIR, "build");
const ICONSET_DIR = path.join(BUILD_DIR, "gmail-desk.iconset");
const ICNS_PATH = path.join(ASSETS_DIR, "gmail-desk.icns");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = new Uint32Array(256);

for (let i = 0; i < CRC_TABLE.length; i += 1) {
  let c = i;
  for (let j = 0; j < 8; j += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, drawPixel) {
  const rowLength = width * 4 + 1;
  const raw = Buffer.alloc(rowLength * height);

  for (let y = 0; y < height; y += 1) {
    raw[y * rowLength] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = drawPixel(x, y, width, height);
      const offset = y * rowLength + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function insideRoundedRect(x, y, left, top, width, height, radius) {
  const right = left + width - 1;
  const bottom = top + height - 1;
  const innerLeft = left + radius;
  const innerRight = right - radius;
  const innerTop = top + radius;
  const innerBottom = bottom - radius;

  if ((x >= innerLeft && x <= innerRight && y >= top && y <= bottom) ||
      (y >= innerTop && y <= innerBottom && x >= left && x <= right)) {
    return true;
  }

  const cx = x < innerLeft ? innerLeft : innerRight;
  const cy = y < innerTop ? innerTop : innerBottom;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function scaleRect(width, height, left, top, rectWidth, rectHeight) {
  const size = Math.min(width, height);
  return [
    Math.round(left * size),
    Math.round(top * size),
    Math.round(rectWidth * size),
    Math.round(rectHeight * size)
  ];
}

function distanceToSegment(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    return Math.hypot(x - x1, y - y1);
  }

  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  return Math.hypot(x - px, y - py);
}

function insideRect(x, y, left, top, width, height) {
  return x >= left && x < left + width && y >= top && y < top + height;
}

function appIconPixel(x, y, width, height) {
  const size = Math.min(width, height);
  const margin = Math.max(1, Math.round(size * 0.08));
  const radius = Math.max(2, Math.round(size * 0.16));

  if (!insideRoundedRect(x, y, margin, margin, size - margin * 2, size - margin * 2, radius)) {
    return [0, 0, 0, 0];
  }

  let color = [248, 250, 252, 255];
  const [mailLeft, mailTop, mailWidth, mailHeight] = scaleRect(width, height, 0.16, 0.27, 0.68, 0.46);
  const mailRadius = Math.max(2, Math.round(size * 0.055));

  if (insideRoundedRect(x, y, mailLeft, mailTop, mailWidth, mailHeight, mailRadius)) {
    color = [255, 255, 255, 255];
  }

  const border = Math.max(1, Math.round(size * 0.035));
  if (
    insideRect(x, y, mailLeft, mailTop, mailWidth, border) ||
    insideRect(x, y, mailLeft, mailTop + mailHeight - border, mailWidth, border) ||
    insideRect(x, y, mailLeft, mailTop, border, mailHeight) ||
    insideRect(x, y, mailLeft + mailWidth - border, mailTop, border, mailHeight)
  ) {
    color = [218, 220, 224, 255];
  }

  const stroke = Math.max(2, Math.round(size * 0.055));
  const leftX = mailLeft + Math.round(mailWidth * 0.08);
  const rightX = mailLeft + Math.round(mailWidth * 0.92);
  const topY = mailTop + Math.round(mailHeight * 0.12);
  const centerX = mailLeft + Math.round(mailWidth * 0.5);
  const centerY = mailTop + Math.round(mailHeight * 0.58);
  const bottomY = mailTop + mailHeight - Math.round(mailHeight * 0.14);

  if (distanceToSegment(x, y, leftX, topY, centerX, centerY) <= stroke) {
    color = [234, 67, 53, 255];
  }
  if (distanceToSegment(x, y, rightX, topY, centerX, centerY) <= stroke) {
    color = [234, 67, 53, 255];
  }
  if (distanceToSegment(x, y, leftX, bottomY, centerX, centerY) <= Math.max(1, Math.round(stroke * 0.7))) {
    color = [251, 188, 5, 255];
  }
  if (distanceToSegment(x, y, rightX, bottomY, centerX, centerY) <= Math.max(1, Math.round(stroke * 0.7))) {
    color = [52, 168, 83, 255];
  }

  const blueTab = Math.max(2, Math.round(size * 0.05));
  if (insideRect(x, y, mailLeft, mailTop + border, blueTab, mailHeight - border * 2)) {
    color = [66, 133, 244, 255];
  }

  return color;
}

function trayIconPixel(x, y, width, height) {
  const scale = width / 18;
  const px = (value) => Math.round(value * scale);
  const left = px(3);
  const right = px(15);
  const top = px(5);
  const bottom = px(14);
  const stroke = Math.max(1, px(1));

  const border =
    (x >= left && x <= right && y >= top && y < top + stroke) ||
    (x >= left && x <= right && y > bottom - stroke && y <= bottom) ||
    (y >= top && y <= bottom && x >= left && x < left + stroke) ||
    (y >= top && y <= bottom && x > right - stroke && x <= right);
  const flapLeft = distanceToSegment(x, y, left, top, px(9), px(10)) <= stroke;
  const flapRight = distanceToSegment(x, y, right, top, px(9), px(10)) <= stroke;

  if (border || flapLeft || flapRight) {
    return [0, 0, 0, 255];
  }

  return [0, 0, 0, 0];
}

function writePng(filePath, width, height, drawPixel) {
  fs.writeFileSync(filePath, encodePng(width, height, drawPixel));
}

ensureDir(ASSETS_DIR);
ensureDir(GENERATED_DIR);
ensureDir(ICONSET_DIR);

writePng(path.join(GENERATED_DIR, "tray-template.png"), 18, 18, trayIconPixel);
writePng(path.join(GENERATED_DIR, "tray-template@2x.png"), 36, 36, trayIconPixel);

const iconFiles = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024]
];

for (const [fileName, size] of iconFiles) {
  writePng(path.join(ICONSET_DIR, fileName), size, size, appIconPixel);
}

if (process.platform === "darwin") {
  try {
    execFileSync("iconutil", ["-c", "icns", ICONSET_DIR, "-o", ICNS_PATH], {
      stdio: "ignore"
    });
    console.log(`Generated ${path.relative(ROOT_DIR, ICNS_PATH)}`);
  } catch (error) {
    console.warn(`Could not generate macOS .icns file: ${error.message}`);
  }
}

console.log(`Generated ${path.relative(ROOT_DIR, path.join(GENERATED_DIR, "tray-template.png"))}`);
