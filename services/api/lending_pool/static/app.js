'use strict';
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = cents => new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(cents/100);
const pct = n => Number(n).toFixed(2)+'%';
const display = n => n === null || n === undefined ? '—' : escape(n);
const poolName = id => pools.find(p=>p.id===id)?.name || id;
let pools=[], network=null, walletInfo=null, renderVersion=0, walletBusy=false;
async function requestJSON(url,payload) {
  let response;
  try { response=await fetch(url,payload===undefined?{}:payload instanceof FormData?{method:'POST',body:payload}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }
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
  $('network-status').innerHTML=`<div class="notice ${network.ready?'':'warning'}"><strong>${network.ready?'Connected to validated ledger':'Transactions unavailable'}</strong><p>${network.blockers.map(escape).join(' ')||'Asset issuer and network verified. Native actions also require enabled amendments and a configured vault.'}</p><button id="refresh-network" class="subtle">Recheck network</button></div>`;
  $('refresh-network').onclick=async()=>{try{await refreshNetwork();await render();}catch(e){message('global-status',e.message,'error');}};
}
async function render(){
  if(demoMode){renderDemo();return;}
  const version=++renderVersion;
  const [page='pools',id]=location.hash.slice(1).split('/');
  document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.dataset.page===(page==='pool'?'pools':page)));
  try{
    if(page==='pool'){
      const p=pools.find(p=>p.id===id);if(!p){$('content').innerHTML=title('Pool not found','Choose a pool from the pool list.');return;}
      $('content').innerHTML='<div class="empty">Reading validated vault data…</div>';
      const detail=await api('/pools/'+encodeURIComponent(id));if(version!==renderVersion)return;
      renderPool(p,detail);
    }else if(page==='workflow')renderWorkflow();
    else if(page==='borrow')renderBorrow();
    else if(page==='applications')await renderApplications(version);
    else if(page==='activity')await renderActivity(version);
    else if(page==='portfolio')renderPortfolio();
    else renderPools();
  }catch(error){if(version===renderVersion)$('content').innerHTML=title('Unable to load this view',error.message)+'<button id="retry-page">Retry</button>';if($('retry-page'))$('retry-page').onclick=render;}
}
function renderPools(){
  $('content').innerHTML=title('Capital, put to work.','RLUSD pools for financing future business payments.','Ledger-backed balances')+
  `<div class="pool-grid">${pools.map(p=>`<a href="#pool/${p.id}" class="pool-card"><div class="pool-top"><h2>${escape(p.name)}</h2><span class="chip">${escape(p.risk_label)}</span></div><span class="caption">Settlement asset</span><div class="rate">RLUSD</div><p class="muted">${p.vault_id?'Vault configured · verify live details':'Awaiting on-chain vault deployment'}</p><div class="card-link"><span>Explore pool</span><span>↗</span></div></a>`).join('')}</div>`+
  '<p class="note">Risk tiers describe the intended strategy. They are not calibrated credit ratings. Legacy fictional capital and demo deposits are excluded from all balances.</p>';
}
function renderPool(p,d){
  const ready=network?.ready && network.amendments.SingleAssetVault && d.source==='validated_ledger';
  const shares=walletInfo?.shares.find(s=>s.MPTokenIssuanceID===d.vault?.ShareMPTID);
  $('content').innerHTML=`<a href="#pools" class="back">← All lending pools</a><div class="detail-layout"><div class="market-detail"><div class="asset-heading"><span class="asset-icon">$</span><div><h1>${escape(p.name)} <span class="muted">RLUSD</span></h1><p class="muted">${escape(network?.network.name||'XRPL')} · ${escape(p.risk_label)}</p></div></div>
  <div class="detail-stats">${metric('Total vault assets',display(d.total_assets),'RLUSD')}${metric('Assets on loan',display(d.assets_on_loan),'RLUSD')}${metric('Available liquidity',display(d.available_assets),'RLUSD')}${metric('Utilization',d.utilization===null?'—':pct(d.utilization))}</div>
  <p class="caption">${d.source==='validated_ledger'?`Source: validated ledger #${d.ledger_index}. Assets on loan = total assets − available assets; accounting depends on the vault version.`:escape(d.blockers.join(' '))}</p>
  <section class="detail-section"><h2>Interest rates</h2><p class="muted">Observed rates for this RLUSD vault.</p><div class="rates-layout"><div><span class="stat-label">Deposit APY</span><div class="chart-number">—</div><span class="stat-label">Borrow APR</span><div class="chart-number">—</div><p class="caption">Loan-specific terms apply. A pool-wide APY is not published by the ledger.</p></div><div class="rate-chart"><div class="chart-grid"></div><div class="chart-empty"><span>↗</span><strong>No verified rate history yet</strong><p>Historical rates appear only when collected from real ledger activity.</p></div><div class="chart-legend"><span>● Deposit yield</span><span>● Borrowing rate</span></div></div></div></section>
  <section class="detail-section"><h2>Protocol parameters</h2><dl><div><dt>Asset</dt><dd>RLUSD · issued currency</dd></div><div><dt>Issuer</dt><dd class="break">${escape(network?.asset?.issuer||'Not verified on this network')}</dd></div><div><dt>Vault ID</dt><dd class="break">${escape(d.vault_id||'Not deployed')}</dd></div><div><dt>Single Asset Vault amendment</dt><dd>${network?.amendments.SingleAssetVault===undefined?'Unknown':network.amendments.SingleAssetVault?'Enabled':'Not enabled'}</dd></div><div><dt>Lending Protocol amendment</dt><dd>${network?.amendments.LendingProtocol===undefined?'Unknown':network.amendments.LendingProtocol?'Enabled':'Not enabled'}</dd></div><div><dt>Withdrawal timing</dt><dd>Subject to vault liquidity, permissions and redemption dates</dd></div></dl></section></div>
  <aside class="positions"><h2>Your positions</h2><article class="panel"><span class="stat-label">Wallet balance</span><div class="chart-number">${display(walletInfo?.rlusd_balance)} <span class="caption">RLUSD</span></div><dl><div><dt>Vault shares (raw units)</dt><dd>${walletInfo&&!walletInfo.blockers.length&&d.vault?escape(shares?.MPTAmount||'0'):'—'}</dd></div><div><dt>XRP for fees & reserves</dt><dd>${display(walletInfo?.xrp_fee_balance)}</dd></div></dl><button id="refresh-wallet" class="subtle full">${walletInfo?'Refresh wallet balances':'Connect GemWallet'}</button></article>
  <article class="panel"><h3>Supply & withdraw</h3><form id="asset-action"><fieldset ${!ready||!walletInfo?'disabled':''}><label>Action<select id="asset-action-type"><option value="deposit">Deposit RLUSD</option><option value="withdraw">Withdraw RLUSD</option></select></label><label>Amount · RLUSD<input id="asset-amount" inputmode="decimal" pattern="[0-9]+([.][0-9]{1,6})?" required placeholder="100.00"></label><button class="primary full">Review in GemWallet</button></fieldset></form><p class="caption">${!ready?'Unavailable until the network, official RLUSD issuer and vault are verified.':'Only a validated successful transaction updates your position.'}</p><p id="action-status" class="form-status" role="status"></p></article>
  <article class="panel"><h3>Borrow RLUSD</h3><p class="muted">Apply against a future invoice. Underwriting happens before a broker and borrower sign a native loan.</p><a href="#borrow" class="primary full">Submit application ↗</a><p class="caption">Loan origination is not enabled: two-party LoanSet signing is not supported by this integration yet.</p></article></aside></div>`;
  $('refresh-wallet').onclick=async()=>{if(!walletInfo)return connectWallet();try{walletInfo=await api('/wallet');await render();message('global-status',walletInfo.blockers.join(' ')||'Validated wallet balances refreshed.');}catch(e){message('global-status',e.message,'error');}};
  $('asset-action').onsubmit=e=>{e.preventDefault();runAction({action:$('asset-action-type').value,pool:p.id,amount:$('asset-amount').value},'action-status',e.target);};
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
  }catch(error){message(statusId,error.message+' If signing failed for VaultDeposit, VaultWithdraw or LoanPay, your GemWallet version may lack native lending support. Check Transactions before retrying a submission.','error');}
  finally{walletBusy=false;form.querySelector('fieldset').disabled=false;}
}
function renderPortfolio(){
  $('content').innerHTML=title('Your positions','RLUSD balances, vault shares and native loans from the ledger.')+(!walletInfo?'<div class="empty">Connect GemWallet to view your positions.</div>':
  `<div class="stats">${metric('RLUSD balance',display(walletInfo.rlusd_balance),'RLUSD')}${metric('XRP · fees & reserves',display(walletInfo.xrp_fee_balance),'XRP')}${metric('Native loans',walletInfo.blockers.length?'—':walletInfo.loans.length)}</div><p class="error">${walletInfo.blockers.map(escape).join(' ')}</p>
  <article class="panel"><h2>RLUSD trust line</h2><p class="muted">${walletInfo.trustline?'Trust line found for the configured issuer.':'A trust line to the exact issuer is required to hold RLUSD.'}</p><form id="trust-form"><fieldset ${network?.ready?'':'disabled'}><label>Trust limit · RLUSD<input name="limit" value="1000000" required inputmode="decimal"></label><button>Review TrustSet in GemWallet</button></fieldset><p id="trust-status" role="status"></p></form></article>
  <article class="panel"><h2>Your native loans</h2>${walletInfo.loans.length?walletInfo.loans.map(l=>`<div class="loan-row"><h3 class="break">${escape(l.index||l.LedgerIndex)}</h3><p>Outstanding: ${escape(l.TotalValueOutstanding)} RLUSD · periodic payment: ${escape(l.PeriodicPayment)} RLUSD</p><form class="repay-form" data-loan="${escape(l.index||l.LedgerIndex)}"><fieldset><label>Pool<select name="pool">${pools.map(p=>`<option value="${p.id}">${escape(p.name)}</option>`).join('')}</select></label><label>Amount · RLUSD<input name="amount" required inputmode="decimal"></label><label>Payment type<select name="payment_type"><option value="regular">Regular</option><option value="full">Early full payment</option><option value="late">Late payment</option><option value="overpayment">Overpayment</option></select></label><button>Review LoanPay in GemWallet</button></fieldset><p id="repay-${escape(l.index||l.LedgerIndex)}" role="status"></p></form></div>`).join(''):'<p class="muted">No verified native RLUSD loans are available to display.</p>'}</article>`);
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
async function renderApplications(version){
  if(!walletInfo){$('content').innerHTML=title('Your applications','Connect GemWallet to view your invoice requests.');return;}
  const data=await requestJSON('/api/market/requests');if(version!==renderVersion)return;
  $('content').innerHTML=title('Your applications','Off-chain underwriting records. These are not funded loans.')+
  (data.requests.length?data.requests.map(r=>`<article class="panel"><h3>${escape(r.company)}</h3><span class="chip">${escape(r.status)}</span><p>${money(r.amount_cents)} RLUSD requested · invoice due ${escape(r.due_date)}</p><p class="caption">Illustrative risk model: ${escape(r.assessment?.version||'unknown')}. A signed, validated LoanSet is required before any disbursement.</p><a href="/api/market/requests/${r.id}/document">Download invoice evidence ↗</a></article>`).join(''):'<div class="empty">No applications yet. <a href="#borrow">Submit a funding request →</a></div>');
}
function renderWorkflow(){
  $('content').innerHTML=title('From capital to repayment','Review the intended business model and the exact implementation boundaries.')+`
  <div class="two-col"><article class="panel"><h2>Investor workflow</h2><ol class="workflow"><li><strong>Authenticate with GemWallet</strong><p>Sign a one-time, expiring login message. This does not move funds.</p></li><li><strong>Hold RLUSD on the chosen network</strong><p>Use the exact official issuer and establish its trust line. XRP pays ledger fees and reserves only.</p></li><li><strong>Choose a vault and deposit</strong><p>Sign VaultDeposit. Capital and vault shares are recognized only after validated tesSUCCESS.</p></li><li><strong>Monitor and redeem</strong><p>Read ledger balances and shares. Sign VaultWithdraw, subject to liquidity and vault redemption rules. Returns are not guaranteed.</p></li></ol></article>
  <article class="panel"><h2>Borrower workflow</h2><ol class="workflow"><li><strong>Submit an invoice</strong><p>Authenticate, upload evidence and request RLUSD. The application and underwriting remain off-chain.</p></li><li><strong>Broker verifies credit and terms</strong><p>Verify debtor, duplicate financing and repayment capacity. A risk score is not a verified probability of default.</p></li><li><strong>Both parties sign the loan</strong><p>Broker and borrower agree to LoanSet terms. Validation originates the native loan and transfers RLUSD from the vault. This two-party signing flow is not implemented yet.</p></li><li><strong>Repay in RLUSD</strong><p>The borrower signs LoanPay. The ledger enforces repayment rules. Incoming invoice payments are not automatically collected.</p></li></ol></article></div>
  <article class="panel"><h2>Current implementation</h2><div class="table-wrap"><table><thead><tr><th>Capability</th><th>State</th></tr></thead><tbody><tr><td>Pool layout and invoice applications</td><td>Implemented; applications have no financial effect</td></tr><tr><td>GemWallet login and signing bridge</td><td>Implemented; real extension approval still requires your wallet</td></tr><tr><td>Ledger reads, native deposit/withdraw/repay intents</td><td>Implemented with validation gates; live execution unverified</td></tr><tr><td>Official Lending Devnet + RLUSD</td><td>Standard Devnet: native lending enabled, official RLUSD issuer missing. Dedicated Lending Devnet: unreachable. Testnet: official RLUSD present, native lending disabled.</td></tr><tr><td>Vault / broker deployment and LoanSet co-signing</td><td>Not implemented; operator setup and compatible signers required</td></tr><tr><td>Historical yields and automated invoice collection</td><td>Unavailable; no invented chart or simulated transfer</td></tr><tr><td>Legacy simulated deposits and allocations</td><td>Disabled by default; excluded from ledger positions</td></tr></tbody></table></div></article>
  <p class="note">Native XRPL lending is fixed-term, uncollateralized credit with off-chain underwriting. An invoice is evidence for the broker; it does not automatically become enforceable on-chain collateral. Confirm whether you intend invoice assignment, debtor payments into a collection account, and first-loss capital before implementing those policies.</p>`;
}
function renderBorrow() {
  if (!walletInfo) { $('content').innerHTML=title('Borrow RLUSD','Connect GemWallet to submit and track your own application.') + '<button id="borrow-connect">Connect GemWallet</button>'; $('borrow-connect').onclick=connectWallet; return; }
  const tomorrow=new Date(); tomorrow.setDate(tomorrow.getDate()+1);
  const limit=new Date();limit.setDate(limit.getDate()+180);
  const localDate=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  $('content').innerHTML=title('Turn invoices into liquidity.','Apply for working capital against a future customer payment.','Up to 85% advance')+
    `<div class="two-col"><article class="panel"><form id="borrow-form"><fieldset>
    <div class="form-section"><h3><span class="step">01</span> Business details</h3><div class="form-grid"><label>Company name<input name="company" required maxlength="160" placeholder="Evergreen Supply"></label><label>Industry<select name="sector" required><option value="">Select industry</option>${['Manufacturing','Logistics','Healthcare','Food & beverage','Energy','Wholesale','Technology','Creative services','Other'].map(s=>`<option>${s}</option>`).join('')}</select></label></div><label>What will the capital fund?<textarea name="purpose" required maxlength="500" placeholder="Pay suppliers while waiting for a customer invoice to settle"></textarea></label><div class="form-grid"><label>Years in business<input name="years_trading" type="number" min="0" max="100" step="0.1" required placeholder="5"></label><label>Debtor invoices paid late · %<input name="late_payment_pct" type="number" min="0" max="100" step="0.1" required placeholder="10"></label></div><p class="caption">Use the debtor’s historical late-payment rate. The reviewer must corroborate these self-reported inputs.</p></div>
    <div class="form-section"><h3><span class="step">02</span> Future invoice</h3><div class="form-grid"><label>Invoice reference<input name="invoice_ref" required maxlength="120" placeholder="INV-2026-001"></label><label>Customer / debtor<input name="debtor" required maxlength="160" placeholder="Company that owes the payment"></label><label>Invoice face value · RLUSD<input name="invoice" type="number" min="0.01" max="100000000" step="0.01" required placeholder="100000"></label><label>Payment deadline<input name="due_date" type="date" min="${localDate(tomorrow)}" max="${localDate(limit)}" required></label></div><label>Invoice document<input name="document" type="file" accept="application/pdf,image/png,image/jpeg" required></label><p class="caption">PDF, PNG or JPEG · Up to 5 MB. Use fictional business documents for this local demo.</p></div>
    <div class="form-section"><h3><span class="step">03</span> Funding request</h3><label>Requested advance · RLUSD<input name="amount" type="number" min="0.01" max="100000000" step="0.01" required placeholder="70000"></label><p class="caption">The invoice must mature within 180 days. Pool assignment and borrowing terms are calculated automatically, then subject to off-chain underwriting. No loan is created by submitting this form.</p></div><button class="primary full">Submit borrow request</button></fieldset><p id="borrow-status" class="form-status" role="status"></p></form></article>
    <aside><article class="panel side-note"><h3>From invoice to capital</h3><ol><li><strong>Submit your invoice.</strong><br>Include the debtor, amount and future payment deadline.</li><li><strong>Get a risk assessment.</strong><br>The model proposes a pool and estimates your borrowing cost.</li><li><strong>Complete manual verification.</strong><br>A reviewer confirms the invoice, debtor and financing status.</li><li><strong>Sign the loan agreement.</strong><br>Broker and borrower must co-sign LoanSet. Only validation transfers RLUSD; origination is not yet available in this app.</li></ol><p class="caption">Submitting does not move funds. The risk model is illustrative. Invoice verification and broker approval are off-chain; on-chain origination is blocked until the network, RLUSD issuer, and counterparty signer are available.</p></article><a href="#applications" class="document-link">View applications & review status ↗</a></aside></div>`;
  $('borrow-form').onsubmit=async event=>{
    event.preventDefault();const form=event.target;
    if(!form.reportValidity())return;
    const payload=new FormData(form), document=payload.get('document');
    if(document.size>5*1024*1024){message('borrow-status','Invoice document must be at most 5 MB.','error');return;}
    form.querySelector('fieldset').disabled=true;message('borrow-status','Submitting invoice for review…');
    try{const submitted=await requestJSON('/api/market/requests',payload);form.reset();const r=submitted.requests[0];message('borrow-status',`Request #${r.id} submitted. Proposed pool: ${poolName(r.pool)} · Risk ${pct(r.risk)} · Illustrative interest ${money(r.assessment.interest_cents)} RLUSD. Awaiting invoice verification.`,'success');}
    catch(error){message('borrow-status',error.message,'error');}
    finally{form.querySelector('fieldset').disabled=false;}
  };
}
window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0);});
(async()=>{
  if(demoMode){
    try{walletInfo=await api('/wallet');}catch{/* No authenticated session. */}
    renderDemo();
    if(window.GemWalletApi)for(const event of ['walletChanged','networkChanged','logout'])window.GemWalletApi.on(event,()=>disconnectWallet());
    return;
  }
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
