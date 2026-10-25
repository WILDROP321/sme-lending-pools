// Test-token issuance only; destination must already trust this Devnet issuer.
import * as xrpl from 'xrpl';
import fs from 'node:fs';
import path from 'node:path';
const dir=path.resolve(import.meta.dirname,'../../services/api/instance');
const recipient=fs.readFileSync(0,'utf8').trim();if(!xrpl.isValidClassicAddress(recipient))throw Error('Invalid address');
const keys=JSON.parse(fs.readFileSync(path.join(dir,'native-devnet-wallets.json')));
const m=JSON.parse(fs.readFileSync(path.join(dir,'native-devnet.json')));
if(m.network_id!==2||m.asset_kind!=='mock')throw Error('Devnet mock token only');
const c=new xrpl.Client('wss://s.devnet.rippletest.net:51233/');
try{await c.connect();if((await c.request({command:'server_info'})).result.info.network_id!==2)throw Error('Wrong network');const w=xrpl.Wallet.fromSeed(keys.issuer.seed);const line=(await c.request({command:'account_lines',account:recipient,peer:w.address,ledger_index:'validated'})).result.lines.find(l=>l.currency===m.currency);if(!line||Number(line.balance)>0)throw Error('Create trust line first; faucet requires an empty token balance');const tx=await c.autofill({TransactionType:'Payment',Account:w.address,Destination:recipient,Amount:{currency:m.currency,issuer:w.address,value:'1000'}});if(Number(tx.Fee)>1000)throw Error('Fee cap');const r=(await c.submitAndWait(w.sign(tx).tx_blob)).result;if(!r.validated||r.meta.TransactionResult!=='tesSUCCESS')throw Error('Issuance not validated successfully');process.stdout.write(JSON.stringify({hash:r.hash,ledger_index:r.ledger_index,result:'tesSUCCESS',explorer_url:`https://devnet.xrpl.org/transactions/${r.hash}`}));}finally{await c.disconnect();}
