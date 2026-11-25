import {readdir,readFile,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
for(const dir of ['js','scripts'])for(const file of await readdir(dir))if(/\.(m?js)$/.test(file)){const r=spawnSync(process.execPath,['--check',dir+'/'+file],{encoding:'utf8'});if(r.status!==0){console.error(r.stderr);process.exit(1);}}
const html=await readFile('index.html','utf8');for(const ref of html.matchAll(/(?:src|href)="\.\/([^"]+)"/g))await access(ref[1]);
console.log('JavaScript syntax and entry-point assets verified.');
