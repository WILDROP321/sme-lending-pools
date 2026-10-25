'use strict';
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = cents => new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(cents/100);
const pct = n => Number(n).toFixed(2)+'%';
const display = n => n === null || n === undefined ? '—' : escape(n);
const poolName = id => pools.find(p=>p.id===id)?.name || id;
let pools=[], network=null, walletInfo=null, renderVersion=0, walletBusy=false;
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
  const version=++renderVersion;
  const [page='pools',id]=location.hash.slice(1).split('/');
  $('network-status').hidden=['borrow','applications'].includes(page);
  document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.dataset.page===(page==='pool'?'pools':page)));
  try{
    if(page==='pool'){
      const p=pools.find(p=>p.id===id);if(!p){$('content').innerHTML=title('Pool not found','Choose a pool from the pool list.');return;}
      $('content').innerHTML='<div class="empty">Reading validated vault data…</div>';
      const detail=await api('/pools/'+encodeURIComponent(id));if(version!==renderVersion)return;
      const companies=await requestJSON('/api/mock-companies');if(version!==renderVersion)return;
      renderPool(p,detail,companies.companies.filter(c=>c.pool===mockPoolForVault(p.id)));
    }else if(page==='workflow')renderWorkflow();
    else if(page==='borrow')await renderMockBorrow(id,version);
    else if(page==='invoice')renderBorrow();
    else if(page==='applications')await renderApplications(version);
    else if(page==='activity')await renderActivity(version);
    else if(page==='portfolio')renderPortfolio();
    else await renderPools();
  }catch(error){if(version===renderVersion)$('content').innerHTML=title('Unable to load this view',error.message)+'<button id="retry-page">Retry</button>';if($('retry-page'))$('retry-page').onclick=render;}
}
async function renderPools(){
  const version=renderVersion;
  const details=await Promise.all(pools.map(p=>api('/pools/'+p.id)));
  if(version!==renderVersion)return;
  $('content').innerHTML=`<div class="earn-heading"><div><h1>Invest</h1><p>Native XRPL vaults. MOCKRLUSD is an on-chain test token, not official RLUSD.</p></div><div><span class="muted">Source</span><strong>Validated Devnet</strong></div></div><div class="earn-toolbar"><span class="filter-pill">◉ XRPL Devnet</span><label class="sr-only" for="pool-search">Search pools</label><input id="pool-search" placeholder="Search pools"><label>Risk <select id="pool-risk"><option value="all">All strategies</option>${pools.map(p=>`<option>${escape(p.risk_label)}</option>`).join('')}</select></label></div><div id="earn-grid" class="earn-grid"></div><p class="note">Closed-ended vaults accept deposits during subscription, originate loans during investment, and permit redemption after maturity. No fictional APY is shown.</p>`;
  const update=()=>{$('earn-grid').innerHTML=pools.map((p,i)=>({p,d:details[i]})).filter(({p})=>p.name.toLowerCase().includes($('pool-search').value.toLowerCase())&&($('pool-risk').value==='all'||p.risk_label===$('pool-risk').value)).map(({p,d})=>`<a class="earn-card" href="#pool/${p.id}"><div class="earn-asset"><span class="token-mark">✣</span><div><h3>${mockPoolForVault(p.id)} Pool</h3><span class="muted">${escape(p.name)} · MOCKRLUSD</span></div></div><div class="earn-yield"><span class="muted">Validated vault assets</span><strong>${display(d.total_assets)}</strong></div><div class="earn-card-bottom"><span>${d.ledger_index?'Ledger #'+d.ledger_index:'Unavailable'}</span><span>↗</span></div></a>`).join('')||'<div class="empty">No pools match.</div>';};
  $('pool-search').oninput=update;$('pool-risk').onchange=update;update();
}
function renderPool(p,d,companies=[]){
  const ready=network?.ready && network.amendments.SingleAssetVault && d.source==='validated_ledger';
  $('content').innerHTML=`<a href="#pools" class="back">← All lending pools</a><div class="detail-layout"><div class="market-detail"><div class="asset-heading"><span class="asset-icon">$</span><div><h1>${escape(p.name)} <span class="muted">MOCKRLUSD</span></h1><p class="muted">${escape(network?.network.name||'XRPL')} · ${network?.network.asset_kind==='mock'?'MOCKRLUSD test token · ':''} ${escape(p.risk_label)}</p></div></div>
  <div class="detail-stats">${metric('Total vault assets',display(d.total_assets),'MOCKRLUSD')}${metric('Assets on loan',display(d.assets_on_loan),'MOCKRLUSD')}${metric('Available liquidity',display(d.available_assets),'MOCKRLUSD')}</div>
  <p class="caption">${d.source==='validated_ledger'?`Source: validated ledger #${d.ledger_index}. Assets on loan = total assets − available assets; accounting depends on the vault version.`:escape(d.blockers.join(' '))}</p>
  <section class="detail-section"><h2>Interest rates</h2><p class="muted">Observed rates for this MOCKRLUSD vault.</p><div class="rates-layout"><div><span class="stat-label">Deposit APY</span><div class="chart-number">—</div><span class="stat-label">Borrow APR</span><div class="chart-number">—</div><p class="caption">Loan-specific terms apply. A pool-wide APY is not published by the ledger.</p></div><div class="rate-chart"><div class="chart-grid"></div><div class="chart-empty"><span>↗</span><strong>No verified rate history yet</strong><p>Historical rates appear only when collected from real ledger activity.</p></div><div class="chart-legend"><span>● Deposit yield</span><span>● Borrowing rate</span></div></div></div></section>
  <section class="detail-section"><h2>${mockPoolForVault(p.id)} pool companies</h2><p class="caption">Mock company allocations · amounts in MOCKRLUSD. These records are separate from on-chain vault assets.</p>${companyTable(companies)}</section><details class="detail-section protocol-parameters"><summary>Protocol parameters</summary><dl><div><dt>Asset</dt><dd>MOCKRLUSD · issued currency</dd></div><div><dt>Issuer</dt><dd class="break">${escape(network?.asset?.issuer||'Not verified on this network')}</dd></div><div><dt>Vault ID</dt><dd class="break">${escape(d.vault_id||'Not deployed')}</dd></div><div><dt>Single Asset Vault amendment</dt><dd>${network?.amendments.SingleAssetVault===undefined?'Unknown':network.amendments.SingleAssetVault?'Enabled':'Not enabled'}</dd></div><div><dt>Lending Protocol amendment</dt><dd>${network?.amendments.LendingProtocol===undefined?'Unknown':network.amendments.LendingProtocol?'Enabled':'Not enabled'}</dd></div><div><dt>Subscription closes</dt><dd>${d.vault?.SubscriptionDate?new Date((d.vault.SubscriptionDate+946684800)*1000).toLocaleString():'—'}</dd></div><div><dt>Redemption opens</dt><dd>${d.vault?.RedemptionDate?new Date((d.vault.RedemptionDate+946684800)*1000).toLocaleString():'—'}</dd></div><div><dt>Withdrawal timing</dt><dd>Subject to vault liquidity, permissions and redemption dates</dd></div></dl></details></div>
  <aside class="deposit-sidebar"><article class="panel deposit-panel"><h3>Deposit</h3><form id="asset-action"><fieldset ${!ready||!walletInfo?'disabled':''}><label for="asset-amount">Amount · MOCKRLUSD<input id="asset-amount" type="number" min="0.000001" step="0.000001" inputmode="decimal" required placeholder="100.00"></label><button type="submit" class="primary full">Submit</button></fieldset></form>${!ready?'<p class="caption">Deposits are unavailable until the network and vault are verified.</p>':!walletInfo?'<p class="caption">Connect GemWallet to deposit.</p>':''}<p id="action-status" class="form-status" role="status"></p></article></aside></div>`;
  $('asset-action').onsubmit=e=>{e.preventDefault();runAction({action:'deposit',pool:p.id,amount:$('asset-amount').value},'action-status',e.target);};
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
function renderPortfolio(){
  $('content').innerHTML=title('Your positions','MOCKRLUSD balances, vault shares and native loans from the ledger.')+(!walletInfo?'<div class="empty">Connect GemWallet to view your positions.</div>':
  `<div class="stats">${metric('MOCKRLUSD balance',display(walletInfo.rlusd_balance),'MOCKRLUSD')}${metric('XRP · fees & reserves',display(walletInfo.xrp_fee_balance),'XRP')}${metric('Native loans',walletInfo.blockers.length?'—':walletInfo.loans.length)}</div><p class="error">${walletInfo.blockers.map(escape).join(' ')}</p>
  <article class="panel"><h2>MOCKRLUSD trust line</h2><button id="claim-mock">Receive 1,000 on-chain test tokens</button><p id="claim-status" role="status"></p><p class="muted">${walletInfo.trustline?'Trust line found for the configured issuer.':'A trust line to the exact issuer is required to hold MOCKRLUSD.'}</p><form id="trust-form"><fieldset ${network?.ready?'':'disabled'}><label>Trust limit · MOCKRLUSD<input name="limit" value="1000000" required inputmode="decimal"></label><button>Review TrustSet in GemWallet</button></fieldset><p id="trust-status" role="status"></p></form></article>
  <article class="panel"><h2>Your native loans</h2>${walletInfo.loans.length?walletInfo.loans.map(l=>`<div class="loan-row"><h3 class="break">${escape(l.index||l.LedgerIndex)}</h3><p>Outstanding: ${escape(l.TotalValueOutstanding)} MOCKRLUSD · periodic payment: ${escape(l.PeriodicPayment)} MOCKRLUSD</p><form class="repay-form" data-loan="${escape(l.index||l.LedgerIndex)}"><fieldset><label>Pool<select name="pool">${pools.map(p=>`<option value="${p.id}">${escape(p.name)}</option>`).join('')}</select></label><label>Amount · MOCKRLUSD<input name="amount" required inputmode="decimal"></label><label>Payment type<select name="payment_type"><option value="regular">Regular</option><option value="late">Late payment</option><option value="overpayment">Overpayment</option></select></label><button>Review LoanPay in GemWallet</button></fieldset><p id="repay-${escape(l.index||l.LedgerIndex)}" role="status"></p></form></div>`).join(''):'<p class="muted">No verified native MOCKRLUSD loans are available to display.</p>'}</article>`);
  if($('claim-mock'))$('claim-mock').onclick=async()=>{const b=$('claim-mock');b.disabled=true;try{const r=await api('/mock-tokens',{});message('claim-status','Validated issuance: '+r.hash,'success');walletInfo=await api('/wallet');}catch(e){message('claim-status',e.message,'error');}finally{b.disabled=false;}};
  if($('trust-form'))$('trust-form').onsubmit=e=>{e.preventDefault();runAction({action:'trustline',amount:new FormData(e.target).get('limit')},'trust-status',e.target);};
  document.querySelectorAll('.repay-form').forEach(f=>f.onsubmit=e=>{e.preventDefault();runAction({action:'repay',loan_id:f.dataset.loan,...Object.fromEntries(new FormData(f))},'repay-'+f.dataset.loan,f);});
}
async function renderActivity(version){
  if(!walletInfo){$('content').innerHTML=title('Transaction history','Connect GemWallet to view your signed transactions.');return;}
  const data=await api('/intents');if(version!==renderVersion)return;
  $('content').innerHTML=title('Transaction history','A submitted hash is not confirmation. Verify the validated ledger result.')+
  (data.intents.length?data.intents.map(i=>`<article class="panel"><div class="section-heading"><h3>${escape(i.action)} · ${escape(i.status)}</h3><button class="verify-tx" data-id="${escape(i.id)}">Verify on ledger</button></div><p class="break">${escape(i.tx_hash||'Awaiting wallet signature')}</p><p class="caption">${escape(i.result_code||'No validated result')} ${i.ledger_index?'· Ledger #'+i.ledger_index:''}</p>${i.explorer_url?`<a href="${escape(i.explorer_url)}" target="_blank" rel="noopener">Open matching-network explorer ↗</a>`:'<p class="caption">No verified explorer URL is configured for this network. RPC verification is available; explorer verification is not claimed.</p>'}<p id="tx-${escape(i.id)}" role="status"></p></article>`).join(''):'<div class="empty">No transactions have been prepared by this wallet.</div>');
  document.querySelectorAll('.verify-tx').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const i=await api('/intents/'+b.dataset.id);message('tx-'+i.id,`${i.status} · ${i.result_code||'not validated'}${i.ledger_index?' · ledger '+i.ledger_index:''}`,i.status==='confirmed'?'success':'');}catch(e){message('tx-'+b.dataset.id,e.message,'error');}finally{b.disabled=false;}});
}
const mockPoolForVault = id => ({core:'Safe',balanced:'Medium',opportunity:'Risky'}[id]);
function companyTable(companies){
  return companies.length?`<div class="table-wrap"><table class="companies-table"><thead><tr><th>Company name</th><th>Risk factor / 100</th><th>Decided disbursement</th><th>Money requested</th><th>Debtor</th><th>From</th><th>Invoice due</th><th>Pool</th><th></th></tr></thead><tbody>${companies.map(c=>`<tr><td>${escape(c.company_name)}</td><td>${c.risk_factor}</td><td>${money(c.decided_disbursement_cents)}</td><td>${money(c.money_requested_cents)}</td><td>${escape(c.debtor)}</td><td>${escape(c.from_date)}</td><td>${escape(c.invoice_due)}</td><td><span class="chip">${escape(c.pool)}</span></td><td><a class="document-link" href="#borrow/${c.id}">Edit</a></td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No companies in this pool yet.</p>';
}
async function renderApplications(version){
  const data=await requestJSON('/api/mock-companies');if(version!==renderVersion)return;
  $('content').innerHTML=title('Company applications',`Mock companies and funding requests · amounts in MOCKRLUSD · ${data.storage==='supabase'?'Supabase connected':'Local database'}`,'Mock data')+`<p class="note">Scores: 0–19 Decline · 20–49 Risky · 50–69 Medium · 70–100 Safe. Higher scores indicate safer companies. Decided disbursement is a mock estimate, not a transfer.</p><div class="company-filters"><label>Pool<select id="company-pool"><option value="all">All pools</option>${['Decline','Risky','Medium','Safe'].map(p=>`<option>${p}</option>`).join('')}</select></label><a href="#borrow" class="primary">New funding request</a></div><p id="company-count" class="caption"></p><div id="companies"></div>`;
  const update=()=>{const rows=data.companies.filter(c=>$('company-pool').value==='all'||c.pool===$('company-pool').value);$('company-count').textContent=`${rows.length} companies`;$('companies').innerHTML=companyTable(rows);};
  $('company-pool').onchange=update;update();
}
async function renderMockBorrow(id,version){
  let existing=null;
  if(id){const data=await requestJSON('/api/mock-companies');if(version!==renderVersion)return;existing=data.companies.find(c=>String(c.id)===id);if(!existing)throw new Error('Company not found.');}
  const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);
  const minDate=`${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`;
  $('content').innerHTML=title(existing?'Edit funding request':'Get funded','Submit a company invoice for a mock funding assessment.','Mock assessment')+`<article class="panel funding-panel"><form id="company-funding"><fieldset><div class="form-grid"><label>Name of the company<input name="company_name" required maxlength="160" placeholder="Evergreen Supply"></label><label>Money requested · MOCKRLUSD<input name="money_requested" type="number" required min="0.01" max="100000000" step="0.01" placeholder="25000"></label><label>Debtor<input name="debtor" required maxlength="160" placeholder="Company that owes the invoice"></label><label>Invoice due<input name="invoice_due" type="date" min="${minDate}" required></label></div><button type="submit" class="primary">${existing?'Save changes':'Submit request'}</button></fieldset><p id="company-status" class="form-status" role="status"></p></form><p class="caption">A random mock score from 35–90 assigns your pool. Higher scores indicate safer companies. The estimated disbursement equals the requested amount × score / 100. This saves an application; no funds move.</p></article><div id="company-result" aria-live="polite"></div><a href="#applications" class="document-link">View all company applications ↗</a>`;
  if(existing){const form=$('company-funding');for(const [name,value] of Object.entries({company_name:existing.company_name,money_requested:(existing.money_requested_cents/100).toFixed(2),debtor:existing.debtor,invoice_due:existing.invoice_due})){form.elements.namedItem(name).value=value;}}
  $('company-funding').onsubmit=async e=>{e.preventDefault();const form=e.target;const payload=Object.fromEntries(new FormData(form));form.querySelector('fieldset').disabled=true;message('company-status','Saving application…');
    try{const {company:c}=await requestJSON('/api/mock-companies'+(existing?'/'+existing.id:''),payload,existing?'PATCH':'POST');message('company-status',`Application saved${existing?' and updated':''} to the database.`,'success');$('company-result').innerHTML=`<article class="panel"><h2>${escape(c.company_name)}</h2><div class="stats">${metric('Risk factor',c.risk_factor+' / 100')}${metric('Assigned pool',escape(c.pool))}${metric('Decided disbursement',money(c.decided_disbursement_cents),'MOCKRLUSD')}</div><p class="caption">Mock estimate saved to the database. No disbursement has occurred.</p></article>`;if(existing)existing=c;else form.reset();}
    catch(error){message('company-status',error.message,'error');}finally{form.querySelector('fieldset').disabled=false;}
  };
}

function renderWorkflow(){
  $('content').innerHTML=title('Native Devnet lending','The asset is mock; financial state is on-chain.')+`<div class="two-col"><article class="panel"><h2>Invest</h2><p>Connect GemWallet → establish the MOCKRLUSD issuer trust line → receive test tokens → sign VaultDeposit during subscription → receive on-chain vault shares → sign VaultWithdraw when the protocol permits redemption.</p></article><article class="panel"><h2>Get funded</h2><p>Submit company name, requested amount, debtor and invoice due date → save a random mock score from 35–90 → assign Risky, Medium or Safe → view the estimate in Applications. No wallet is required and no funds move.</p></article></div><article class="panel"><h2>What stays off-chain</h2><p>Invoices, identity checks and credit underwriting stay private and off-chain. The current test broker uses a fixed test-credit policy, not invoice approval. Transaction preparation and session records are local; balances and confirmation come only from the ledger.</p><p>GemWallet must support native lending transaction signing. A wallet error never triggers a simulated or Payment substitute.</p></article>`;
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
