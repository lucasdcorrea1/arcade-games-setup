'use strict';

// Generate build/icon.png and build/icon.ico from build/icon.svg.
// Run: npm run make-icon
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const pngToIco = require('png-to-ico');

const buildDir = path.join(__dirname, '..', 'build');
const svg = fs.readFileSync(path.join(buildDir, 'icon.svg'));

function renderPng(size) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  return r.render().asPng();
}

(async () => {
  fs.writeFileSync(path.join(buildDir, 'icon.png'), renderPng(512));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const ico = await pngToIco(sizes.map(renderPng));
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico);
  console.log('Generated build/icon.png and build/icon.ico');
})().catch((e) => { console.error(e); process.exit(1); });
