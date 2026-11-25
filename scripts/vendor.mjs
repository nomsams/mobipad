import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
await mkdir('vendor',{recursive:true});
await copyFile('node_modules/peerjs/dist/peerjs.min.js','vendor/peerjs.min.js');
await copyFile('node_modules/peerjs/LICENSE','vendor/PEERJS-LICENSE');
// qrcode ships a CommonJS browser entry. Bundle its local modules without runtime CDN access.
const {build}=await import('esbuild');
await build({entryPoints:['node_modules/qrcode/lib/browser.js'],bundle:true,minify:true,format:'iife',globalName:'QRCode',outfile:'vendor/qrcode.min.js',platform:'browser'});
await copyFile('node_modules/qrcode/license','vendor/QRCODE-LICENSE');
console.log('Vendored pinned PeerJS and QRCode browser bundles.');
