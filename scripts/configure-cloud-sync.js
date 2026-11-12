import {mkdir,writeFile,chmod} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {validateCloudConfiguration} from '../lib/cloud-config.js';
if (process.stdin.isTTY) {
  execFileSync('stty',['-echo'],{stdio:['inherit','ignore','ignore']});
  process.on('exit',()=>{try {execFileSync('stty',['echo'],{stdio:['inherit','ignore','ignore']});} catch {}});
  process.once('SIGINT',()=>process.exit(130));
  process.once('SIGTERM',()=>process.exit(143));
}
console.log('Ready for cloud sync configuration on stdin (hidden).');
const input=createInterface({input:process.stdin,terminal:false});
input.once('line',async line=>{
  try {
    const config=validateCloudConfiguration(JSON.parse(line));
    const folder=new URL('../.cloud-sync/',import.meta.url);
    await mkdir(folder,{recursive:true,mode:0o700});await chmod(folder,0o700);
    const file=new URL('config.json',folder);
    await writeFile(file,JSON.stringify(config),{mode:0o600});await chmod(file,0o600);
    console.log('Cloud sync configured.');process.exit(0);
  } catch {console.error('Cloud sync setup failed.');process.exit(1);}
});
