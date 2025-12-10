const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const inputSvg = path.join(__dirname, 'public', 'icon.svg');
const outputDir = path.join(__dirname, 'public');

async function generateIcons() {
  console.log('Generating PWA icons...');
  
  for (const size of sizes) {
    const outputPath = path.join(outputDir, `icon-${size}x${size}.png`);
    
    await sharp(inputSvg)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    
    console.log(`✓ Generated icon-${size}x${size}.png`);
  }
  
  // Generate apple-touch-icon
  await sharp(inputSvg)
    .resize(180, 180)
    .png()
    .toFile(path.join(outputDir, 'apple-touch-icon.png'));
  
  console.log('✓ Generated apple-touch-icon.png');
  console.log('\n✅ All icons generated successfully!');
}

generateIcons().catch(console.error);
