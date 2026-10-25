'use strict';
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = cents => new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(cents/100);
const pct = n => Number(n).toFixed(2)+'%';
const display = n => n === null || n === undefined ? '—' : escape(n);
const poolName = id => pools.find(p=>p.id===id)?.name || id;
let pools=[], network=null, walletInfo=null, renderVersion=0, walletBusy=false, poolMetricsTimer=null;
async function requestJSON(url,payload,method='POST') {
  let response;
  try { response=await fetch(url,payload===undefined?{}:payload instanceof FormData?{method:'POST',body:payload}:{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }
  catch { throw new Error('Cannot reach Flask. No transaction or balance has been assumed successful.'); }
  const data=await response.json();
  if(!response.ok)throw new Error(data.error?.message||`Request failed (${response.status})`);
  return data;
}
const api=(path,payload)=>requestJSON('/api/lending'+path,payload);
function message(id,text,kind=''){const target=$(id);if(target){target.textContent=text;target.className=`form-status ${kind}`;}}
function title(heading,description,badge=''){return `<div class="heading"><div><h1>${escape(heading)}</h1><p>${escape(description)}</p></div>${badge?`<span class="chip">${escape(badge)}</span>`:''}</div>`;}
function metric(label,value,unit=''){return `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}<small>${unit}</small></span></div>`;}
function showAccount(){
  $('account').innerHTML=walletInfo?`<span class="account-name" title="${escape(walletInfo.address)}">${escape(walletInfo.address.slice(0,7))}…${escape(walletInfo.address.slice(-5))}</span><button id="disconnect-wallet">Disconnect</button>`:'<button id="connect-wallet">Connect GemWallet</button>';
  if($('connect-wallet'))$('connect-wallet').onclick=connectWallet;
  if($('disconnect-wallet'))$('disconnect-wallet').onclick=disconnectWallet;
}
async function checkWallet(){
  const gem=window.GemWalletApi;
  if(!gem || !(await gem.isInstalled()).result?.isInstalled)throw new Error('GemWallet extension not detected. Install GemWallet, then open this app in that browser.');
  const result=(await gem.getNetwork()).result;
  const normalized=s=>String(s||'').replace(/\/$/,'');
  if(!network || !result || normalized(result.websocket)!==normalized(network.network.websocket))throw new Error(`Select the exact network in GemWallet: ${network?.network.websocket||'network unavailable'}. No automatic network switch is performed.`);
  return gem;
}
async function connectWallet(){
  if(walletBusy)return;walletBusy=true;
  message('global-status','Waiting for GemWallet approval…');
  try{
    const gem=await checkWallet();
    const key=(await gem.getPublicKey()).result;
    if(!key?.address || !key?.publicKey)throw new Error('Wallet connection declined.');
    const challenge=await api('/auth/challenge',{address:key.address});
    const signed=(await gem.signMessage(challenge.message)).result;
    if(!signed?.signedMessage)throw new Error('Login signature declined.');
    await api('/auth/verify',{public_key:key.publicKey,signature:signed.signedMessage});
    walletInfo=await api('/wallet');showAccount();await render();
    message('global-status','Wallet ownership verified. '+(walletInfo.blockers.join(' ')||'Balances loaded from the validated ledger.'),walletInfo.blockers.length?'':'success');
  }catch(error){message('global-status',error.message,'error');}
  finally{walletBusy=false;}
}
async function disconnectWallet(){
  walletInfo=null;showAccount();
  try{await api('/auth/logout',{});}catch(error){message('global-status',error.message,'error');}
  await render();
}
async function refreshNetwork(){
  network=await api('/status');
  $('network-label').textContent=network.network.name+(network.connected?' · RPC connected':' · Unavailable');
  $('network-status').innerHTML=`<div class="notice ${network.ready?'':'warning'}"><strong>${network.ready?'Connected to validated ledger':'Transactions unavailable'}</strong><p>${network.blockers.map(escape).join(' ')||(network.network.asset_kind==='mock'?'On-chain MOCKRLUSD test token — not official RLUSD. Deposits, loans and repayments use native Devnet transactions.':'Asset issuer and network verified.')}</p><button id="refresh-network" class="subtle">Recheck network</button></div>`;
  $('refresh-network').onclick=async()=>{try{await refreshNetwork();await render();}catch(e){message('global-status',e.message,'error');}};
}
async function render(){
  clearInterval(poolMetricsTimer);
  const version=++renderVersion;
  const [page='pools',id]=location.hash.slice(1).split('/');
  const mockPage=['borrow','applications','pools','pool','activity','workflow','portfolio'].includes(page);
  $('network-status').hidden=mockPage;
  $('network-label').textContent=mockPage?'Mock lending · Simulation':network?network.network.name+(network.connected?' · RPC connected':' · Unavailable'):'Checking ledger connection…';
  document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.dataset.page===(page==='pool'?'pools':page)));
  try{
    if(page==='pool'){
      const p=pools.find(p=>p.id===id);if(!p){$('content').innerHTML=title('Pool not found','Choose a pool from the pool list.');return;}
      $('content').innerHTML='<div class="empty">Loading mock vault balances…</div>';
      const [data,companies]=await Promise.all([requestJSON('/api/mock-vaults'),requestJSON('/api/mock-companies')]);if(version!==renderVersion)return;
      renderPool(p,data.vaults.find(v=>v.pool===mockPoolForVault(p.id)),companies.companies.filter(c=>c.pool===mockPoolForVault(p.id)),data.transactions.filter(t=>t.pool===mockPoolForVault(p.id)));
    }else if(page==='workflow')renderWorkflow();
    else if(page==='borrow')await renderMockBorrow(id,version);
    else if(page==='invoice')renderBorrow();
    else if(page==='applications')await renderApplications(version);
    else if(page==='activity')await renderActivity(version);
    else if(page==='native-activity')await renderNativeActivity(version);
    else if(page==='portfolio')await renderPortfolio(version);
    else if(page==='native-portfolio')renderNativePortfolio();
    else await renderPools();
  }catch(error){if(version===renderVersion)$('content').innerHTML=title('Unable to load this view',error.message)+'<button id="retry-page">Retry</button>';if($('retry-page'))$('retry-page').onclick=render;}
}
async function renderPools(){
  const version=renderVersion;
  const data=await requestJSON('/api/mock-vaults');if(version!==renderVersion)return;
  $('content').innerHTML=`<div class="earn-heading"><div><h1>Invest</h1><p>Mock lending pools · balances, deposits and funding approvals stored in the database.</p></div><div><span class="muted">Source</span><strong>Mock vault accounts</strong></div></div><div class="earn-toolbar"><span class="filter-pill">Simulation</span><label class="sr-only" for="pool-search">Search pools</label><input id="pool-search" placeholder="Search pools"><label>Risk <select id="pool-risk"><option value="all">All strategies</option>${pools.map(p=>`<option>${escape(p.risk_label)}</option>`).join('')}</select></label></div><div id="earn-grid" class="earn-grid"></div><p class="note">Each pool starts with 1,000,000 MOCKRLUSD. Mock deposits add to its balance; automatic funding subtracts the decided amount. These values are separate from validated XRPL assets.</p>`;
  const update=()=>{$('earn-grid').innerHTML=pools.map(p=>({p,v:data.vaults.find(v=>v.pool===mockPoolForVault(p.id))})).filter(({p})=>(p.name+' '+mockPoolForVault(p.id)).toLowerCase().includes($('pool-search').value.toLowerCase())&&($('pool-risk').value==='all'||p.risk_label===$('pool-risk').value)).map(({p,v})=>`<a class="earn-card" href="#pool/${p.id}"><div class="earn-asset"><span class="token-mark">✣</span><div><h3>${mockPoolForVault(p.id)} Pool</h3><span class="muted">${escape(p.name)} · MOCKRLUSD</span></div></div><div class="earn-yield"><span class="muted">Total vault assets</span><strong>${money(v.balance_cents)}</strong></div><div class="earn-card-bottom"><span>${v.annual_rate_bps/100}% APR · simulation</span><span>↗</span></div></a>`).join('')||'<div class="empty">No pools match.</div>';};
  $('pool-search').oninput=update;$('pool-risk').onchange=update;update();
}
function poolAccounting(v){return `Opening balance ${money(v.opening_balance_cents)} + deposits ${money(v.deposited_cents)} − funded company disbursements ${money(v.disbursed_cents)} = ${money(v.balance_cents)} MOCKRLUSD. Your investments earn ${v.annual_rate_bps/100}% APR as simple annual interest. Estimated yearly earnings: ${money(v.assets_on_loan_cents*v.annual_rate_bps/10000)} MOCKRLUSD.`;}
function renderPool(p,v,companies=[],history=[]){
  $('content').innerHTML=`<a href="#pools" class="back">← All lending pools</a><div class="detail-layout"><div class="market-detail"><div class="asset-heading"><span class="asset-icon">$</span><div><h1>${escape(v.pool)} Pool <span class="muted">MOCKRLUSD</span></h1><p class="muted">${escape(p.name)} · Database-backed simulation</p></div></div>
  <div class="detail-stats">${metric('Total vault assets',`<span id="pool-total-assets">${money(v.total_assets_cents)}</span>`,'MOCKRLUSD')}${metric('Assets on loan',`<span id="pool-invested">${money(v.assets_on_loan_cents)}</span>`,'MOCKRLUSD')}${metric('Current available withdrawal',`<span id="pool-earnings">${(v.available_withdrawal_cents/100).toFixed(2)}</span>`,'MOCKRLUSD')}</div>
  <p class="caption" id="pool-accounting">${poolAccounting(v)}</p><p class="caption">Assets on loan = your deposited money in the market. Current available withdrawal = accrued investment earnings, capped by pool cash. This is a shared mock investor account. <span id="earnings-as-of">Earnings update every 30 seconds.</span></p>
  <section class="detail-section"><h2>${escape(v.pool)} pool companies</h2><p class="caption">Funding requests automatically transfer their score-based decided amount from this mock vault when sufficient cash is available. Repayment is the full requested amount on the invoice due date.</p>${companyTable(companies)}</section>
  <section class="detail-section"><h2>Mock vault transactions</h2>${history.length?`<div class="table-wrap"><table><thead><tr><th>Transaction</th><th>Amount</th><th>Balance after</th><th>Reference</th></tr></thead><tbody>${history.map(t=>`<tr><td>${t.kind==='deposit'?'Deposit':'Funding transfer'}</td><td>${t.kind==='deposit'?'+':'−'}${money(t.amount_cents)}</td><td>${money(t.balance_after_cents)}</td><td>${t.company_id?`<a href="/api/mock-vaults/certificates/${t.company_id}" target="_blank" rel="noopener">Certificate ↗</a>`:`<span class="caption break">${escape(t.id)}</span>`}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No mock transactions yet.</p>'}</section></div>
  <aside class="deposit-sidebar"><article class="panel deposit-panel"><h3>Deposit</h3><form id="asset-action"><fieldset><label for="asset-amount">Amount · MOCKRLUSD<input id="asset-amount" type="number" min="0.01" max="100000000" step="0.01" inputmode="decimal" required placeholder="200.00"></label><button type="submit" class="primary full">Submit mock deposit</button></fieldset></form><p class="caption">Adds to your money invested in this pool and increases pool cash. Earnings accrue over time; no real funds move.</p><p id="action-status" class="form-status" role="status"></p></article></aside></div>`;
  const poolVersion=renderVersion;
  poolMetricsTimer=setInterval(async()=>{try{const data=await requestJSON('/api/mock-vaults');if(poolVersion!==renderVersion)return;const updated=data.vaults.find(item=>item.pool===v.pool);$('pool-accounting').textContent=poolAccounting(updated);$('pool-total-assets').textContent=money(updated.total_assets_cents);$('pool-invested').textContent=money(updated.assets_on_loan_cents);$('pool-earnings').textContent=(updated.available_withdrawal_cents/100).toFixed(2);$('earnings-as-of').textContent='Earnings updated '+new Date(updated.earnings_as_of).toLocaleTimeString()+'.';}catch{if(poolVersion===renderVersion&&$('earnings-as-of'))$('earnings-as-of').textContent='Earnings refresh unavailable. Reload to retry.';}},30000);
  $('asset-action').onsubmit=async e=>{e.preventDefault();const form=e.target;const amount=$('asset-amount').value;const keyName='flow-deposit-'+v.pool;let pending=JSON.parse(sessionStorage.getItem(keyName)||'null');if(!pending||pending.amount!==amount){pending={amount,request_key:crypto.randomUUID()};sessionStorage.setItem(keyName,JSON.stringify(pending));}form.querySelector('fieldset').disabled=true;
    try{const data=await requestJSON('/api/mock-vaults/'+v.pool+'/deposits',pending);sessionStorage.removeItem(keyName);await render();message('action-status',`Mock deposit recorded: +${money(data.transaction.amount_cents)} MOCKRLUSD. Your invested principal increased by ${money(data.transaction.amount_cents)}. Reference: ${data.transaction.id}.`,'success');}
    catch(error){message('action-status',error.message,'error');form.querySelector('fieldset').disabled=false;}
  };
}
function fundingActions(c){
  if(c.status==='approved')return `<a class="document-link" href="/api/mock-vaults/certificates/${c.id}" target="_blank" rel="noopener">Certificate ↗</a>`;
  return `${c.pool==='Decline'||c.status==='declined'?'<span class="caption">Declined</span>':c.source==='seed'?'<span class="caption">Sample company record</span>':'<span class="caption">Insufficient pool liquidity</span>'} <a class="document-link" href="#borrow/${c.id}">Edit</a>`;
}

async function runAction(payload,statusId,form){
  if(walletBusy)return;walletBusy=true;form.querySelector('fieldset').disabled=true;
  try{
    const gem=await checkWallet();
    const address=(await gem.getAddress()).result?.address;
    if(address!==walletInfo?.address)throw new Error('GemWallet account changed. Disconnect and authenticate the selected wallet.');
    const intent=await api('/intents',payload);
    message(statusId,'Review the exact transaction and XRP network fee in GemWallet.');
    // Keep the prepared intent discoverable even if signing or submission is interrupted.
    const signed=await gem.signTransaction({transaction:intent.transaction});
    if(!signed.result?.signature)throw new Error('Signing declined. No transaction was submitted.');
    await checkWallet();
    const result=await api(`/intents/${intent.id}/submit`,{signed_blob:signed.result.signature});
    message(statusId,`${result.status==='confirmed'?'Validated on-chain':result.status==='failed'?'Validated failure: '+result.result_code:'Submitted; awaiting ledger validation'}. Hash: ${result.tx_hash}. See Transactions to verify.`,result.status==='confirmed'?'success':result.status==='failed'?'error':'');
  }catch(error){message(statusId,error.message+' If signing failed for VaultDeposit, VaultWithdraw, LoanSet or LoanPay, your GemWallet version may lack native lending support. Check Transactions before retrying a submission.','error');}
  finally{walletBusy=false;form.querySelector('fieldset').disabled=false;}
}
async function renderPortfolio(version){
  const data=await requestJSON('/api/mock-vaults');if(version!==renderVersion)return;
  const invested=data.vaults.reduce((total,v)=>total+v.assets_on_loan_cents,0);
  const earned=data.vaults.reduce((total,v)=>total+v.available_withdrawal_cents,0);
  $('content').innerHTML=title('Your investments','Your deposited principal and accrued earnings in the shared mock investor account.','Simulation')+`<div class="stats">${metric('Money in the market',money(invested),'MOCKRLUSD')}${metric('Current available withdrawal',(earned/100).toFixed(2),'MOCKRLUSD')}</div><div class="pool-grid">${data.vaults.map(v=>`<a class="panel" href="#pool/${{Safe:'core',Medium:'balanced',Risky:'opportunity'}[v.pool]}"><h2>${escape(v.pool)} Pool</h2><p>${v.annual_rate_bps/100}% APR</p><dl><div><dt>Money invested</dt><dd>${money(v.assets_on_loan_cents)} MOCKRLUSD</dd></div><div><dt>Accrued earnings available</dt><dd>${(v.available_withdrawal_cents/100).toFixed(2)} MOCKRLUSD</dd></div></dl></a>`).join('')}</div><p class="note">Safe earns 5%, Medium 10%, and Risky 20% annual simple interest from each deposit's timestamp. Available withdrawal includes earnings only and cannot exceed pool cash.</p><a class="document-link" href="#native-portfolio">View Devnet wallet positions ↗</a>`;
}
function renderNativePortfolio(){
  $('content').innerHTML=title('Your positions','MOCKRLUSD balances, vault shares and native loans from the ledger.')+(!walletInfo?'<div class="empty">Connect GemWallet to view your positions.</div>':
  `<div class="stats">${metric('MOCKRLUSD balance',display(walletInfo.rlusd_balance),'MOCKRLUSD')}${metric('XRP · fees & reserves',display(walletInfo.xrp_fee_balance),'XRP')}${metric('Native loans',walletInfo.blockers.length?'—':walletInfo.loans.length)}</div><p class="error">${walletInfo.blockers.map(escape).join(' ')}</p>
  <article class="panel"><h2>MOCKRLUSD trust line</h2><button id="claim-mock">Receive 1,000 on-chain test tokens</button><p id="claim-status" role="status"></p><p class="muted">${walletInfo.trustline?'Trust line found for the configured issuer.':'A trust line to the exact issuer is required to hold MOCKRLUSD.'}</p><form id="trust-form"><fieldset ${network?.ready?'':'disabled'}><label>Trust limit · MOCKRLUSD<input name="limit" value="1000000" required inputmode="decimal"></label><button>Review TrustSet in GemWallet</button></fieldset><p id="trust-status" role="status"></p></form></article>
  <article class="panel"><h2>Your native loans</h2>${walletInfo.loans.length?walletInfo.loans.map(l=>`<div class="loan-row"><h3 class="break">${escape(l.index||l.LedgerIndex)}</h3><p>Outstanding: ${escape(l.TotalValueOutstanding)} MOCKRLUSD · periodic payment: ${escape(l.PeriodicPayment)} MOCKRLUSD</p><form class="repay-form" data-loan="${escape(l.index||l.LedgerIndex)}"><fieldset><label>Pool<select name="pool">${pools.map(p=>`<option value="${p.id}">${escape(p.name)}</option>`).join('')}</select></label><label>Amount · MOCKRLUSD<input name="amount" required inputmode="decimal"></label><label>Payment type<select name="payment_type"><option value="regular">Regular</option><option value="late">Late payment</option><option value="overpayment">Overpayment</option></select></label><button>Review LoanPay in GemWallet</button></fieldset><p id="repay-${escape(l.index||l.LedgerIndex)}" role="status"></p></form></div>`).join(''):'<p class="muted">No verified native MOCKRLUSD loans are available to display.</p>'}</article>`);
  if($('claim-mock'))$('claim-mock').onclick=async()=>{const b=$('claim-mock');b.disabled=true;try{const r=await api('/mock-tokens',{});message('claim-status','Validated issuance: '+r.hash,'success');walletInfo=await api('/wallet');}catch(e){message('claim-status',e.message,'error');}finally{b.disabled=false;}};
  if($('trust-form'))$('trust-form').onsubmit=e=>{e.preventDefault();runAction({action:'trustline',amount:new FormData(e.target).get('limit')},'trust-status',e.target);};
  document.querySelectorAll('.repay-form').forEach(f=>f.onsubmit=e=>{e.preventDefault();runAction({action:'repay',loan_id:f.dataset.loan,...Object.fromEntries(new FormData(f))},'repay-'+f.dataset.loan,f);});
}
async function renderActivity(version){
  const data=await requestJSON('/api/mock-vaults');if(version!==renderVersion)return;
  $('content').innerHTML=title('Transaction history','Mock deposits and approved company funding, stored in the database.','Simulation')+(data.transactions.length?`<div class="table-wrap"><table><thead><tr><th>Type / pool</th><th>Amount · MOCKRLUSD</th><th>Balance after</th><th>Reference / certificate</th></tr></thead><tbody>${data.transactions.map(t=>`<tr><td>${t.kind==='deposit'?'Deposit':'Funding transfer'} · ${escape(t.pool)}</td><td>${t.kind==='deposit'?'+':'−'}${money(t.amount_cents)}</td><td>${money(t.balance_after_cents)}</td><td><span class="caption break">${escape(t.id)}</span>${t.company_id?`<br><a class="document-link" href="/api/mock-vaults/certificates/${t.company_id}" target="_blank" rel="noopener">Certificate ↗</a>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No mock transactions yet. Deposit into a pool or submit a funding request to get started.</div>');
  if(walletInfo)$('content').insertAdjacentHTML('beforeend','<a class="document-link" href="#native-activity">View native wallet transactions ↗</a>');
}

const mockPoolForVault = id => ({core:'Safe',balanced:'Medium',opportunity:'Risky'}[id]);
function companyTable(companies){
  return companies.length?`<div class="table-wrap"><table class="companies-table"><thead><tr><th>Company name</th><th>Risk factor / 100</th><th>Decided disbursement</th><th>Money requested</th><th>Debtor</th><th>From</th><th>Invoice due</th><th>Pool</th><th>Status / actions</th></tr></thead><tbody>${companies.map(c=>`<tr><td>${escape(c.company_name)}</td><td>${c.risk_factor}</td><td>${money(c.decided_disbursement_cents)}</td><td>${money(c.money_requested_cents)}</td><td>${escape(c.debtor)}</td><td>${escape(c.from_date)}</td><td>${escape(c.invoice_due)}</td><td><span class="chip">${escape(c.pool)}</span></td><td><span class="caption">${escape(c.status||'pending')}</span><br>${fundingActions(c)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No companies in this pool yet.</p>';
}
async function renderApplications(version){
  const data=await requestJSON('/api/mock-companies');if(version!==renderVersion)return;
  $('content').innerHTML=title('Company applications',`Mock companies and funding requests · amounts in MOCKRLUSD · ${data.storage==='supabase'?'Supabase connected':'Local database'}`,'Mock data')+`<p class="note">Scores: 0–19 Decline · 20–49 Risky · 50–69 Medium · 70–100 Safe. Higher scores indicate safer companies. Requests are funded automatically when the assigned pool has sufficient funds. Certificates preserve the invoice and repayment terms.</p><div class="company-filters"><label>Pool<select id="company-pool"><option value="all">All pools</option>${['Decline','Risky','Medium','Safe'].map(p=>`<option>${p}</option>`).join('')}</select></label><a href="#borrow" class="primary">New funding request</a></div><p id="company-count" class="caption"></p><div id="companies"></div>`;
  const update=()=>{const rows=data.companies.filter(c=>$('company-pool').value==='all'||c.pool===$('company-pool').value);$('company-count').textContent=`${rows.length} companies`;$('companies').innerHTML=companyTable(rows);};
  $('company-pool').onchange=update;update();
}
async function renderMockBorrow(id,version){
  let existing=null;
  if(id){const data=await requestJSON('/api/mock-companies');if(version!==renderVersion)return;existing=data.companies.find(c=>String(c.id)===id);if(!existing)throw new Error('Company not found.');}
  const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);
  const minDate=`${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`;
  $('content').innerHTML=title(existing?'Edit funding request':'Get funded','Submit a company invoice for a mock funding assessment.','Mock assessment')+`<article class="panel funding-panel"><form id="company-funding"><fieldset><div class="form-grid"><label>Name of the company<input name="company_name" required maxlength="160" placeholder="Evergreen Supply"></label><label>Money requested · MOCKRLUSD<input name="money_requested" type="number" required min="0.01" max="100000000" step="0.01" placeholder="25000"></label><label>Debtor<input name="debtor" required maxlength="160" placeholder="Company that owes the invoice"></label><label>Invoice due<input name="invoice_due" type="date" min="${minDate}" required></label></div><button type="submit" class="primary">${existing?'Save changes':'Submit request'}</button></fieldset><p id="company-status" class="form-status" role="status"></p></form><p class="caption">A random mock score from 35–90 assigns your pool. Higher scores indicate safer companies. The estimated disbursement equals the requested amount × score / 100. Submitting automatically deducts the decided amount from the assigned mock vault if enough assets are available; repayment equals the requested amount on the invoice due date.</p></article><div id="company-result" aria-live="polite"></div><a href="#applications" class="document-link">View all company applications ↗</a>`;
  if(existing){const form=$('company-funding');for(const [name,value] of Object.entries({company_name:existing.company_name,money_requested:(existing.money_requested_cents/100).toFixed(2),debtor:existing.debtor,invoice_due:existing.invoice_due})){form.elements.namedItem(name).value=value;}}
  $('company-funding').onsubmit=async e=>{e.preventDefault();const form=e.target;const payload=Object.fromEntries(new FormData(form));form.querySelector('fieldset').disabled=true;message('company-status','Saving application…');
    try{const {company:c}=await requestJSON('/api/mock-companies'+(existing?'/'+existing.id:''),payload,existing?'PATCH':'POST');message('company-status',`Application saved${existing?' and updated':''} to the database.`,'success');$('company-result').innerHTML=`<article class="panel"><h2>${escape(c.company_name)}</h2><div class="stats">${metric('Risk factor',c.risk_factor+' / 100')}${metric('Assigned pool',escape(c.pool))}${metric('Decided disbursement',money(c.decided_disbursement_cents),'MOCKRLUSD')}</div><p class="caption">${c.status==='approved'?`Funded automatically: ${money(c.decided_disbursement_cents)} MOCKRLUSD deducted from the ${escape(c.pool)} pool’s total vault assets.`:'Insufficient pool liquidity. Add a deposit and resubmit this request.'} Repayment matches the full requested amount and invoice due date.</p>${fundingActions(c)}</article>`;if(existing)existing=c;else form.reset();}
    catch(error){message('company-status',error.message,'error');}finally{form.querySelector('fieldset').disabled=false;}
  };
}

function renderWorkflow(){
  $('content').innerHTML=title('How mock funding works','Pool balances, applications and certificates are stored in the database.','Simulation')+`<div class="two-col"><article class="panel"><h2>Invest</h2><p>Open a pool → enter an amount → submit a mock deposit. The amount is added to the pool balance and recorded in Transactions. No wallet is needed.</p></article><article class="panel"><h2>Get funded</h2><p>Submit company name, requested amount, debtor and invoice due date → receive a mock score from 35–90 → automatically receive funding when its pool has sufficient funds → view the funding certificate.</p></article></div><article class="panel"><h2>Pool accounting and repayment</h2><p>Each pool starts with 1,000,000 MOCKRLUSD. Deposits add to its balance. Automatic funding deducts the score-based decided amount exactly once. A certificate stores the transfer reference, company, debtor, invoice dates and repayment amount.</p><p>Repayment equals the full requested amount and is due on the invoice date. Approved applications cannot be edited. All pool deposits, funding approvals and certificates are simulated. Your positions shows your invested principal and earnings. Its Devnet link opens the separate wallet features.</p></article>`;
}

function renderBorrow() {
  if (!walletInfo) { $('content').innerHTML=title('Borrow MOCKRLUSD','Connect GemWallet to submit and track your own application.') + '<button id="borrow-connect">Connect GemWallet</button>'; $('borrow-connect').onclick=connectWallet; return; }
  const tomorrow=new Date(); tomorrow.setDate(tomorrow.getDate()+1);
  const limit=new Date();limit.setDate(limit.getDate()+180);
  const localDate=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  $('content').innerHTML=title('Turn invoices into liquidity.','Apply for working capital against a future customer payment.','Up to 85% advance')+
    `<div class="two-col"><article class="panel"><form id="borrow-form"><fieldset>
    <div class="form-section"><h3><span class="step">01</span> Business details</h3><div class="form-grid"><label>Company name<input name="company" required maxlength="160" placeholder="Evergreen Supply"></label><label>Industry<select name="sector" required><option value="">Select industry</option>${['Manufacturing','Logistics','Healthcare','Food & beverage','Energy','Wholesale','Technology','Creative services','Other'].map(s=>`<option>${s}</option>`).join('')}</select></label></div><label>What will the capital fund?<textarea name="purpose" required maxlength="500" placeholder="Pay suppliers while waiting for a customer invoice to settle"></textarea></label><div class="form-grid"><label>Years in business<input name="years_trading" type="number" min="0" max="100" step="0.1" required placeholder="5"></label><label>Debtor invoices paid late · %<input name="late_payment_pct" type="number" min="0" max="100" step="0.1" required placeholder="10"></label></div><p class="caption">Use the debtor’s historical late-payment rate. The reviewer must corroborate these self-reported inputs.</p></div>
    <div class="form-section"><h3><span class="step">02</span> Future invoice</h3><div class="form-grid"><label>Invoice reference<input name="invoice_ref" required maxlength="120" placeholder="INV-2026-001"></label><label>Customer / debtor<input name="debtor" required maxlength="160" placeholder="Company that owes the payment"></label><label>Invoice face value · MOCKRLUSD<input name="invoice" type="number" min="0.01" max="100000000" step="0.01" required placeholder="100000"></label><label>Payment deadline<input name="due_date" type="date" min="${localDate(tomorrow)}" max="${localDate(limit)}" required></label></div><label>Invoice document<input name="document" type="file" accept="application/pdf,image/png,image/jpeg" required></label><p class="caption">PDF, PNG or JPEG · Up to 5 MB. Use fictional business documents for this local demo.</p></div>
    <div class="form-section"><h3><span class="step">03</span> Funding request</h3><label>Requested advance · MOCKRLUSD<input name="amount" type="number" min="0.01" max="100000000" step="0.01" required placeholder="70000"></label><p class="caption">The invoice must mature within 180 days. Pool assignment and borrowing terms are calculated automatically, then subject to off-chain underwriting. No loan is created by submitting this form.</p></div><button class="primary full">Submit borrow request</button></fieldset><p id="borrow-status" class="form-status" role="status"></p></form></article>
    <aside><article class="panel side-note"><h3>From invoice to capital</h3><ol><li><strong>Submit your invoice.</strong><br>Include the debtor, amount and future payment deadline.</li><li><strong>Get a risk assessment.</strong><br>The model proposes a pool and estimates your borrowing cost.</li><li><strong>Complete manual verification.</strong><br>A reviewer confirms the invoice, debtor and financing status.</li><li><strong>Sign the loan agreement.</strong><br>Broker and borrower must co-sign LoanSet. Only validation transfers MOCKRLUSD. The Get funded page currently offers fixed-policy test loans.</li></ol><p class="caption">Submitting does not move funds. The risk model is illustrative. Invoice verification and broker approval are off-chain; invoice approval is not yet connected to the fixed-policy test broker.</p></article><a href="#applications" class="document-link">View applications & review status ↗</a></aside></div>`;
  $('borrow-form').onsubmit=async event=>{
    event.preventDefault();const form=event.target;
    if(!form.reportValidity())return;
    const payload=new FormData(form), document=payload.get('document');
    if(document.size>5*1024*1024){message('borrow-status','Invoice document must be at most 5 MB.','error');return;}
    form.querySelector('fieldset').disabled=true;message('borrow-status','Submitting invoice for review…');
    try{const submitted=await requestJSON('/api/market/requests',payload);form.reset();const r=submitted.requests[0];message('borrow-status',`Request #${r.id} submitted. Proposed pool: ${poolName(r.pool)} · Risk ${pct(r.risk)} · Illustrative interest ${money(r.assessment.interest_cents)} MOCKRLUSD. Awaiting invoice verification.`,'success');}
    catch(error){message('borrow-status',error.message,'error');}
    finally{form.querySelector('fieldset').disabled=false;}
  };
}
window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0);});
(async()=>{
  showAccount();
  pools=(await api('/pools')).pools;
  await render();
  await refreshNetwork();
  try{walletInfo=await api('/wallet');}catch{/* No wallet session yet. */}
  showAccount();await render();
  if(window.GemWalletApi){
    // Session invalidation prevents signatures under a stale address or network.
    for(const event of ['walletChanged','networkChanged','logout'])window.GemWalletApi.on(event,()=>disconnectWallet());
  }
})().catch(error=>message('global-status',error.message,'error'));

function renderNativeBorrow(){
  $('content').innerHTML=title('Get funded','Native Devnet test loans. MOCKRLUSD is not official RLUSD.')+`<article class="panel"><h2>Request an on-chain test loan</h2><a href="#invoice">Submit invoice evidence for separate off-chain review ↗</a><p>Test broker policy: up to 1,000 MOCKRLUSD per loan, 0% interest, one payment due in five minutes. This is test credit, not approved invoice financing. Only vaults in their investment phase can originate loans.</p><form id="native-borrow"><fieldset ${!walletInfo?'disabled':''}><label>Pool<select name="pool">${pools.map(p=>`<option value="${p.id}">${escape(p.name)}</option>`).join('')}</select></label><label>Principal · MOCKRLUSD<input name="amount" required inputmode="decimal" placeholder="100"></label><button>Review LoanSet in GemWallet</button></fieldset><p id="native-borrow-status" role="status"></p></form><p class="caption">The borrower signs first; the configured Devnet test broker co-signs the exact terms. Funds move only after ledger validation. GemWallet must support LoanSet signing.</p></article>`;
  $('native-borrow').onsubmit=e=>{e.preventDefault();runAction({action:'borrow',...Object.fromEntries(new FormData(e.target))},'native-borrow-status',e.target);};
}

async function renderNativeActivity(version){
  if(!walletInfo){$('content').innerHTML=title('Transaction history','Connect GemWallet to view your signed transactions.');return;}
  const data=await api('/intents');if(version!==renderVersion)return;
  $('content').innerHTML=title('Transaction history','A submitted hash is not confirmation. Verify the validated ledger result.')+
  (data.intents.length?data.intents.map(i=>`<article class="panel"><div class="section-heading"><h3>${escape(i.action)} · ${escape(i.status)}</h3><button class="verify-tx" data-id="${escape(i.id)}">Verify on ledger</button></div><p class="break">${escape(i.tx_hash||'Awaiting wallet signature')}</p><p class="caption">${escape(i.result_code||'No validated result')} ${i.ledger_index?'· Ledger #'+i.ledger_index:''}</p>${i.explorer_url?`<a href="${escape(i.explorer_url)}" target="_blank" rel="noopener">Open matching-network explorer ↗</a>`:'<p class="caption">No verified explorer URL is configured for this network. RPC verification is available; explorer verification is not claimed.</p>'}<p id="tx-${escape(i.id)}" role="status"></p></article>`).join(''):'<div class="empty">No transactions have been prepared by this wallet.</div>');
  document.querySelectorAll('.verify-tx').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const i=await api('/intents/'+b.dataset.id);message('tx-'+i.id,`${i.status} · ${i.result_code||'not validated'}${i.ledger_index?' · ledger '+i.ledger_index:''}`,i.status==='confirmed'?'success':'');}catch(e){message('tx-'+b.dataset.id,e.message,'error');}finally{b.disabled=false;}});
}
