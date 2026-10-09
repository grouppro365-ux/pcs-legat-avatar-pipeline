import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const token=process.env.TGCLOUD_TOKEN;
if(!token||!/^app\d+:[^\s]+$/.test(token))throw Error('Set the PCS Serverless CLI token as TGCLOUD_TOKEN in cloud secrets.');
// The PCS production Mini App was verified under this bot (master backlog).
const expected='pcs_manager_bot';
const output=execFileSync(process.execPath,[resolve(root,'node_modules/@tgcloud/cli/bin/tgcloud.js'),'run','endpoints/deploymentIdentity','{}'],{cwd:root,encoding:'utf8',timeout:45000});
const matches=[...output.matchAll(/PCS_SERVERLESS_BOT:([a-z0-9_]+)/g)];
if(matches.length!==1||matches[0][1]!==expected)throw Error('Serverless token belongs to another bot or bot identity was not confirmed.');
console.log('Confirmed Telegram Serverless target: @'+expected);
