import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
const git=(...args)=>{try{return execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{return '';}};
const emails=[git('config','--get','user.email'),...git('log','origin/main','--format=%ae').split('\n')].filter(s=>s.includes('@')&&!s.endsWith('@users.noreply.github.com'));
const files=[...new Set((git('ls-files')+'\n'+git('ls-files','--others','--exclude-standard')).split('\n').filter(Boolean))];
let failed=false;
for(const file of files){const source=await readFile(file,'utf8');if(emails.some(email=>source.includes(email))||/\b[A-Za-z]:[\\/]Users[\\/]/.test(source)||/\b(?:ghp_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{40,})\b/.test(source)){console.error('Privacy check failed: '+file);failed=true;}}
if(failed)process.exit(1);
console.log(`Privacy check passed: ${files.length} files; no configured/previous private author email, home-directory paths, or GitHub token patterns found.`);
