// Explicit Devnet-only deployment. Keys stay in ignored instance/, never in the manifest.
import * as xrpl from 'xrpl';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const dir=path.join(root,'services/api/instance');fs.mkdirSync(dir,{recursive:true});
const secretFile=path.join(dir,'native-devnet-wallets.json');
const manifestFile=path.join(dir,'native-devnet.json');
const client=new xrpl.Client('wss://s.devnet.rippletest.net:51233/');
const currency=Buffer.from('MOCKRLUSD').toString('hex').toUpperCase().padEnd(40,'0');
let saved=fs.existsSync(secretFile)?JSON.parse(fs.readFileSync(secretFile)):{};
let manifest=fs.existsSync(manifestFile)?JSON.parse(fs.readFileSync(manifestFile)):{network:'devnet',network_id:2,asset_kind:'mock',currency,issuer:null,pools:{},transactions:[]};
const persist=()=>{fs.writeFileSync(secretFile,JSON.stringify(saved),{mode:0o600});fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2));};
async function send(tx,w){const filled=await client.autofill(tx);if(Number(filled.Fee)>2000000)throw Error('Unexpected fee above 2 test XRP');const signed=w.sign(filled);const r=(await client.submitAndWait(signed.tx_blob)).result;if(!r.validated||r.meta.TransactionResult!=='tesSUCCESS')throw Error(JSON.stringify(r));manifest.transactions.push({type:tx.TransactionType,hash:r.hash,ledger:r.ledger_index,result:r.meta.TransactionResult,explorer:`https://devnet.xrpl.org/transactions/${r.hash}`});persist();console.log(tx.TransactionType,r.hash);return r;}
function object(r,type){return r.meta.AffectedNodes.find(n=>n.CreatedNode?.LedgerEntryType===type).CreatedNode.LedgerIndex;}
try{
 await client.connect();const info=(await client.request({command:'server_info'})).result.info;if(info.network_id!==2)throw Error('Not Devnet');
 for(const name of ['issuer','broker','investor','borrower']){if(!saved[name]){const w=xrpl.Wallet.generate();saved[name]={seed:w.seed,address:w.address,funded:false};persist();}if(!saved[name].funded){await client.fundWallet(xrpl.Wallet.fromSeed(saved[name].seed));saved[name].funded=true;persist();console.log('Funded test account',name,saved[name].address);}}
 const wallets=Object.fromEntries(Object.entries(saved).map(([k,v])=>[k,xrpl.Wallet.fromSeed(v.seed)]));manifest.issuer=wallets.issuer.address;const asset={currency,issuer:manifest.issuer};
 if(!manifest.issuer_ready){await send({TransactionType:'AccountSet',Account:wallets.issuer.address,SetFlag:8},wallets.issuer);manifest.issuer_ready=true;persist();}
 for(const name of ['broker','investor','borrower']){if(!saved[name].token_ready){await send({TransactionType:'TrustSet',Account:wallets[name].address,LimitAmount:{...asset,value:'100000000'}},wallets[name]);await send({TransactionType:'Payment',Account:wallets.issuer.address,Destination:wallets[name].address,Amount:{...asset,value:'10000'}},wallets.issuer);saved[name].token_ready=true;persist();}}
 for(const [id,seconds] of [['core',86400],['balanced',90],['opportunity',172800]]){
  if(!manifest.pools[id]){const now=(await client.request({command:'ledger',ledger_index:'validated'})).result.ledger.close_time;const r=await send({TransactionType:'VaultCreate',Account:wallets.broker.address,Asset:asset,VaultKind:1,SubscriptionDate:now+seconds,RedemptionDate:now+seconds+604800,Data:Buffer.from('Flow '+id+' MOCKRLUSD test vault').toString('hex')},wallets.broker);manifest.pools[id]={vault_id:object(r,'Vault'),subscription_date:now+seconds,redemption_date:now+seconds+604800};persist();}
  const pool=manifest.pools[id];if(!pool.broker_id){const r=await send({TransactionType:'LoanBrokerSet',Account:wallets.broker.address,VaultID:pool.vault_id},wallets.broker);pool.broker_id=object(r,'LoanBroker');persist();}
  if(!pool.seeded){await send({TransactionType:'VaultDeposit',Account:wallets.investor.address,VaultID:pool.vault_id,Amount:{...asset,value:'1000'}},wallets.investor);pool.seeded=true;persist();}
 }
 manifest.broker_address=wallets.broker.address;manifest.test_investor=wallets.investor.address;manifest.test_borrower=wallets.borrower.address;persist();console.log('Public deployment manifest:',manifestFile);
}finally{await client.disconnect();}
