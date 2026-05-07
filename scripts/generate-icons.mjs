import sharp from 'sharp';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const svgPath = join(__dir, '../public/icons/icon-base.svg');
const svgBuffer = readFileSync(svgPath);

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

for (const size of sizes) {
  await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toFile(join(__dir, `../public/icons/icon-${size}x${size}.png`));
  console.log(`icon-${size}x${size}.png`);
}

// maskable: extra padding (safe zone 10%)
const pad = Math.round(512 * 0.1);
await sharp(svgBuffer)
  .resize(512 - pad * 2, 512 - pad * 2)
  .extend({ top: pad, bottom: pad, left: pad, right: pad, background: '#000000' })
  .png()
  .toFile(join(__dir, '../public/icons/icon-maskable-512x512.png'));
console.log('icon-maskable-512x512.png');
