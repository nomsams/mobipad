import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
await mkdir('vendor',{recursive:true});
await copyFile('node_modules/peerjs/dist/peerjs.min.js','vendor/peerjs.min.js');
await copyFile('node_modules/peerjs/LICENSE','vendor/PEERJS-LICENSE');
// qrcode ships a CommonJS browser entry. Bundle its local modules without runtime CDN access.
const {build}=await import('esbuild');
await build({entryPoints:['node_modules/qrcode/lib/browser.js'],bundle:true,minify:true,format:'iife',globalName:'QRCode',outfile:'vendor/qrcode.min.js',platform:'browser'});
await copyFile('node_modules/qrcode/license','vendor/QRCODE-LICENSE');
await build({entryPoints:['scripts/stretch-entry.mjs'],bundle:true,minify:true,format:'esm',outfile:'vendor/soundtouch.js',platform:'browser',banner:{js:'/*! SoundTouchJS 2.1.1 · MPL-2.0 · https://github.com/cutterbl/SoundTouchJS · unmodified library bundle */'}});
await copyFile('node_modules/@soundtouchjs/core/LICENSE','vendor/SOUNDTOUCH-LICENSE');
console.log('Vendored pinned PeerJS and QRCode browser bundles.');
