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
  if(url==='/api/investor-demo/vaults')url+='?investor_id='+encodeURIComponent(investorProfile().id);
  try { response=await fetch(url,payload===undefined?{}:payload instanceof FormData?{method:'POST',body:payload}:{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }
  catch { throw new Error('Cannot reach Flask. No transaction or balance has been assumed successful.'); }
  const data=await response.json();
  if(!response.ok)throw new Error(data.error?.message||`Request failed (${response.status})`);
  return data;
}
const investorProfile=()=>JSON.parse(sessionStorage.getItem('flow-investor-profile')||'{"id":"you","name":"You"}');
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
      const [data,companies]=await Promise.all([requestJSON('/api/investor-demo/vaults'),requestJSON('/api/investor-demo/companies')]);if(version!==renderVersion)return;
      renderPool(p,data.vaults.find(v=>v.pool===mockPoolForVault(p.id)),companies.companies.filter(c=>c.pool===mockPoolForVault(p.id)),data.transactions.filter(t=>t.pool===mockPoolForVault(p.id)));
    }else if(page==='workflow')await renderWorkflow(version);
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
  const data=await requestJSON('/api/investor-demo/vaults');if(version!==renderVersion)return;
  $('content').innerHTML=`<div class="earn-heading"><div><h1>Invest</h1><p>Mock lending pools · balances, deposits and funding approvals stored in the database.</p></div><div><span class="muted">Source</span><strong>Mock vault accounts</strong></div></div><form id="investor-profile-form" class="investor-profile-form"><label>Investor account<select id="investor-profile"></select></label><label id="new-investor-label" hidden>New investor name<input id="new-investor-name" maxlength="80" placeholder="e.g. Taylor"></label><button>Use account</button><span class="caption">A new account joins a pool with its first deposit.</span></form><div class="earn-toolbar"><span class="filter-pill">Simulation</span><label class="sr-only" for="pool-search">Search pools</label><input id="pool-search" placeholder="Search pools"><label>Risk <select id="pool-risk"><option value="all">All strategies</option>${pools.map(p=>`<option>${escape(p.risk_label)}</option>`).join('')}</select></label></div><div id="earn-grid" class="earn-grid"></div><p class="note">Invest and see your 30-day projection immediately. Pool rates respond to active company and investor membership. Available cash automatically funds verified requests; idle capital earns no projected interest.</p>`;
  const update=()=>{$('earn-grid').innerHTML=pools.map(p=>({p,v:data.vaults.find(v=>v.pool===mockPoolForVault(p.id))})).filter(({p})=>(p.name+' '+mockPoolForVault(p.id)).toLowerCase().includes($('pool-search').value.toLowerCase())&&($('pool-risk').value==='all'||p.risk_label===$('pool-risk').value)).map(({p,v})=>`<a class="earn-card" href="#pool/${p.id}"><div class="earn-asset"><span class="token-mark">✣</span><div><h3>${mockPoolForVault(p.id)} Pool</h3><span class="muted">${escape(p.name)} · MOCKRLUSD</span></div></div><div class="earn-yield"><span class="muted">Available vault cash</span><strong>${money(v.balance_cents)}</strong></div><div class="earn-card-bottom"><span>${(v.rate_bps/100).toFixed(2)}% current APR · ${(v.min_bps/100)}–${(v.max_bps/100)}% band</span><span>↗</span></div></a>`).join('')||'<div class="empty">No pools match.</div>';};
  const profiles=new Map([['you',{id:'you',name:'You'}]]);for(const v of data.vaults)for(const i of v.investors)if(!i.id.startsWith('opening-'))profiles.set(i.id,i);profiles.set(investorProfile().id,investorProfile());
  $('investor-profile').innerHTML=[...profiles.values()].map(i=>`<option value="${escape(i.id)}">${escape(i.name)}</option>`).join('')+'<option value="new">New demo investor…</option>';$('investor-profile').value=investorProfile().id;
  $('investor-profile').onchange=()=>{$('new-investor-label').hidden=$('investor-profile').value!=='new';$('new-investor-name').required=$('investor-profile').value==='new';};
  $('investor-profile-form').onsubmit=e=>{e.preventDefault();const id=$('investor-profile').value;const profile=id==='new'?{id:'investor-'+crypto.randomUUID(),name:$('new-investor-name').value.trim()}:profiles.get(id);if(!profile?.name)return;sessionStorage.setItem('flow-investor-profile',JSON.stringify(profile));render();};
  $('pool-search').oninput=update;$('pool-risk').onchange=update;update();
}
function poolAccounting(v){return `Pool capital ${money(v.capital_cents)} + received interest reserve ${money(v.interest_reserve_cents)} = cash ${money(v.balance_cents)} + outstanding funded principal ${money(v.assets_on_loan_cents)}. Your deployed share: ${money(v.allocated_principal_cents)}; idle share: ${money(v.idle_principal_cents)} MOCKRLUSD.`;}
function ratePanel(v){return `<div class="rate-heading"><div><span class="eyebrow">CURRENT POOL APR</span><strong id="dynamic-rate">${(v.rate_bps/100).toFixed(2)}<small>%</small></strong></div><span class="chip">${v.min_bps/100}–${v.max_bps/100}% permitted range</span></div><div class="rate-track"><span style="width:${100*(v.rate_bps-v.min_bps)/(v.max_bps-v.min_bps)}%"></span></div><div class="rate-facts"><span><b>${v.company_count}</b> active companies</span><span><b>${v.investor_count}</b> investors</span><span><b>${(v.utilization_bps/100).toFixed(1)}%</b> deployed</span></div><p class="caption">More companies raise the quote; more investor members lower it. Company entry is capped at the ceiling. Investor joins below the floor, investor exits above the ceiling, and company exits below the floor are blocked.</p>`;}
function renderPool(p,v,companies=[],history=[]){
  $('content').innerHTML=`<a href="#pools" class="back">← All lending pools</a><div class="asset-heading"><span class="asset-icon">$</span><div><h1>${escape(v.pool)} Pool <span class="muted">MOCKRLUSD</span></h1><p class="muted">${escape(p.name)} · Live investor demo</p></div></div>
  <div class="investor-layout"><div><article class="panel rate-panel" id="rate-panel">${ratePanel(v)}</article><div class="detail-stats">${metric('Your invested principal',`<span id="pool-invested">${money(v.invested_cents)}</span>`,'MOCKRLUSD')}${metric('Projected next 30 days',`<span id="pool-earnings">${money(v.expected_interest_cents)}</span>`,'MOCKRLUSD')}${metric('Interest received',`<span id="pool-received">${money(v.received_interest_cents)}</span>`,'MOCKRLUSD')}</div><p class="caption">Forward projection, not a guaranteed or accrued return. Calculated from your current pool share × outstanding loan principal × current APR × 30 / 365. Existing certificates keep their agreed rates.</p>
  <article class="panel"><h2>Where your money goes</h2><div class="stats">${metric('Cash available',`<span id="pool-total-assets">${money(v.balance_cents)}</span>`)}${metric('Principal on loan',`<span id="pool-loans">${money(v.assets_on_loan_cents)}</span>`)}${metric('Your annual projection',`<span id="pool-annual">${money(v.annual_interest_cents)}</span>`)}</div><p class="caption" id="pool-accounting">${poolAccounting(v)}</p><p class="caption" id="earnings-as-of">Balances refresh every 15 seconds.</p></article></div>
  <aside><article class="panel deposit-panel"><h2>Make an investment</h2><p class="caption">Investing as ${escape(investorProfile().name)} · <a href="#pools">Change account</a></p><form id="asset-action"><fieldset><label for="asset-amount">Amount · MOCKRLUSD<input id="asset-amount" type="number" min="0.01" max="100000000" step="0.01" value="1000" required></label><div id="investment-preview" class="investment-preview" aria-live="polite">Calculating your return…</div><button type="submit" class="primary full">Invest in ${escape(v.pool)}</button></fieldset></form><p id="action-status" class="form-status" role="status"></p><p class="caption">Your deposit buys a proportional pool share immediately. Repeated deposits add to your existing investor account.</p></article>
  <article class="panel"><details><summary>Withdraw your principal</summary><form id="withdraw-form"><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required></label><button>Withdraw available capital</button></form><p id="withdraw-status" class="form-status" role="status"></p></details></article></aside></div>
  <section class="detail-section"><h2>${escape(v.pool)} pool companies</h2><p class="caption">New verified requests join the pool and receive funding automatically when cash is available. ${v.queued_count} request(s) waiting for liquidity. Repayments credit cash and distribute actual simulated interest; company exit is a separate guarded action.</p>${companyTable(companies)}</section>
  <section class="detail-section"><h2>Pool activity</h2>${transactionTable(history.slice(0,30))}</section>`;
  let latest=v,previewSeq=0,previewTimer;const previewVersion=renderVersion;
  const preview=async()=>{const sequence=++previewSeq;try{const result=await requestJSON('/api/investor-demo/'+v.pool+'/preview',{amount:$('asset-amount').value,investor_id:investorProfile().id,investor_name:investorProfile().name});if(sequence!==previewSeq||renderVersion!==previewVersion||!$('investment-preview'))return;const gain=result.after.expected_interest_cents-result.before.expected_interest_cents;$('investment-preview').innerHTML=`<span>After this deposit</span><strong>${money(result.after.expected_interest_cents)} <small>MOCKRLUSD / 30 days</small></strong><b>+${money(gain)} projected earnings</b><span>Total invested: ${money(result.after.invested_cents)} · APR ${(result.after.rate_bps/100).toFixed(2)}%</span>${result.funded_company_ids.length?`<span>Funds ${result.funded_company_ids.length} queued request(s).</span>`:''}`;}catch(e){if(sequence===previewSeq&&renderVersion===previewVersion&&$('investment-preview'))$('investment-preview').textContent=e.message;}};
  $('asset-amount').oninput=()=>{clearTimeout(previewTimer);previewTimer=setTimeout(preview,250);};preview();
  $('asset-action').onsubmit=async e=>{e.preventDefault();const form=e.target;const keyName='flow-investor-deposit-'+v.pool+'-'+investorProfile().id;const amount=$('asset-amount').value;let pending=JSON.parse(sessionStorage.getItem(keyName)||'null');if(!pending||pending.amount!==amount){pending={amount,request_key:crypto.randomUUID(),investor_id:investorProfile().id,investor_name:investorProfile().name};sessionStorage.setItem(keyName,JSON.stringify(pending));}form.querySelector('fieldset').disabled=true;
    try{const result=await requestJSON('/api/investor-demo/'+v.pool+'/deposits',pending);sessionStorage.removeItem(keyName);await render();message('action-status',`Invested ${money(result.transaction.amount_cents)}. ${result.funded_company_ids.length} queued companies funded. Your updated projection is shown above.`,'success');}catch(e){message('action-status',e.message,'error');form.querySelector('fieldset').disabled=false;}};
  $('withdraw-form').onsubmit=async e=>{e.preventDefault();const form=e.target;const button=form.querySelector('button');button.disabled=true;try{await requestJSON('/api/investor-demo/'+v.pool+'/withdrawals',{amount:new FormData(form).get('amount'),request_key:crypto.randomUUID(),investor_id:investorProfile().id});await render();message('action-status','Withdrawal recorded; your investment and return projection have updated.','success');}catch(error){message('withdraw-status',error.message,'error');button.disabled=false;}};
  const poolVersion=renderVersion;poolMetricsTimer=setInterval(async()=>{try{const data=await requestJSON('/api/investor-demo/vaults');if(poolVersion!==renderVersion)return;latest=data.vaults.find(item=>item.pool===v.pool);$('rate-panel').innerHTML=ratePanel(latest);$('pool-accounting').textContent=poolAccounting(latest);for(const [id,key] of Object.entries({'pool-total-assets':'balance_cents','pool-invested':'invested_cents','pool-earnings':'expected_interest_cents','pool-received':'received_interest_cents','pool-annual':'annual_interest_cents','pool-loans':'assets_on_loan_cents'}))$(id).textContent=money(latest[key]);$('earnings-as-of').textContent='Updated '+new Date(latest.earnings_as_of).toLocaleTimeString();preview();}catch{}},15000);
}
function transactionTable(history){return history.length?`<div class="table-wrap"><table><thead><tr><th>Action</th><th>Amount · MOCKRLUSD</th><th>Cash after</th><th>Receipt</th></tr></thead><tbody>${history.map(t=>`<tr><td>${escape(t.kind)} · ${escape(t.pool)}</td><td>${['deposit','repayment'].includes(t.kind)?'+':t.kind==='company_exit'?'':'−'}${money(t.amount_cents)}</td><td>${money(t.balance_after_cents)}</td><td>${t.kind==='disbursement'?`<a href="/api/investor-demo/certificates/${t.company_id}" target="_blank" rel="noopener">Certificate ↗</a>`:escape(t.id.slice(0,12))}</td></tr>`).join('')}</tbody></table></div>`:'<p class="caption">No transactions yet.</p>';}
function fundingActions(c){
  if(c.status==='approved'||c.status==='repaid')return `<a class="document-link" href="/api/investor-demo/certificates/${c.id}" target="_blank" rel="noopener">Certificate ↗</a> ${c.status==='approved'?`<button data-company-action="repay" data-company-id="${c.id}">Simulate repayment</button>`:''} ${c.membership?`<button data-company-action="exit" data-company-id="${c.id}">Exit pool</button>`:'<span class="caption">Exited</span>'}`;
  if(c.pool==='Decline'||c.status==='declined')return '<span class="caption">Rejected · score below 20</span>';
  return `${c.membership?`<button data-approve="${c.id}">Fund request</button> <button data-company-action="exit" data-company-id="${c.id}">Exit pool</button>`:'<span>Exited</span>'} <a class="document-link" href="#borrow/${c.id}">Review</a>`;
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-approve], [data-company-action]');if(!button)return;
  button.disabled=true;
  try{
    if(button.dataset.companyAction)await requestJSON('/api/investor-demo/companies/'+button.dataset.companyId+'/'+button.dataset.companyAction,{});
    else await requestJSON('/api/investor-demo/approvals/'+button.dataset.approve,{});
    await render();message('global-status','Saved. Pool cash, membership and investor returns have been recalculated.','success');
  }catch(error){message('global-status',error.message,'error');button.disabled=false;}
});

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
  const data=await requestJSON('/api/investor-demo/vaults');if(version!==renderVersion)return;
  const sum=key=>data.vaults.reduce((total,v)=>total+v[key],0);
  $('content').innerHTML=title('Your investments','Your pool shares, forward projections and actual simulated interest received.','Investor demo')+`<div class="stats">${metric('Total invested',money(sum('invested_cents')),'MOCKRLUSD')}${metric('Projected next 30 days',money(sum('expected_interest_cents')),'MOCKRLUSD')}${metric('Interest received',money(sum('received_interest_cents')),'MOCKRLUSD')}</div><div class="pool-grid">${data.vaults.map(v=>`<a class="panel" href="#pool/${{Safe:'core',Medium:'balanced',Risky:'opportunity'}[v.pool]}"><h2>${escape(v.pool)} Pool</h2><p class="yield-number">${(v.rate_bps/100).toFixed(2)}% <small>pool APR</small></p><dl><div><dt>Your invested capital</dt><dd>${money(v.invested_cents)}</dd></div><div><dt>Your deployed capital</dt><dd>${money(v.allocated_principal_cents)}</dd></div><div><dt>30-day projection</dt><dd>${money(v.expected_interest_cents)}</dd></div><div><dt>Annual projection</dt><dd>${money(v.annual_interest_cents)}</dd></div><div><dt>Interest received</dt><dd>${money(v.received_interest_cents)}</dd></div></dl><p>${v.company_count} companies · ${v.investor_count} investors · ${(v.utilization_bps/100).toFixed(1)}% deployed</p></a>`).join('')}</div><p class="note">Projections use today’s capital allocation and pool quote, assuming they stay constant. They are not certificate receivables or guaranteed returns. Idle cash earns no projected interest. Repayment distributes the actual agreed interest to current investor shares; legacy agreements remain unchanged.</p>`;
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
async function renderActivity(version){const data=await requestJSON('/api/investor-demo/vaults');if(version!==renderVersion)return;$('content').innerHTML=title('Pool activity','Deposits, funding, repayments and membership changes.','Investor demo')+transactionTable(data.transactions);}

const mockPoolForVault = id => ({core:'Safe',balanced:'Medium',opportunity:'Risky'}[id]);
function companyTable(companies){
  return companies.length?`<div class="table-wrap"><table class="companies-table"><thead><tr><th>Company name</th><th>Risk factor / 100</th><th>Net payout</th><th>Money requested</th><th>Debtor</th><th>From</th><th>Invoice due</th><th>Pool</th><th>Company account</th><th>Maturity / total due</th><th>Status / actions</th></tr></thead><tbody>${companies.map(c=>`<tr><td>${escape(c.company_name)}</td><td>${c.risk_factor}</td><td>${money(c.decided_disbursement_cents)}</td><td>${money(c.money_requested_cents)}</td><td>${escape(c.debtor)}</td><td>${escape(c.from_date)}</td><td>${escape(c.invoice_due)}</td><td><span class="chip">${escape(c.pool)}</span></td><td>${money(c.account_balance_cents||0)}</td><td>${escape(c.terms?.maturity_date||c.terms?.invoice_due||'—')}<br>${c.terms?money(c.terms.repayment_cents):'—'}</td><td><span class="caption">${escape(c.status||'pending')}</span><br>${fundingActions(c)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No companies in this pool yet.</p>';
}
async function renderApplications(version){
  const data=await requestJSON('/api/investor-demo/companies');if(version!==renderVersion)return;
  $('content').innerHTML=title('Company applications',`Mock companies and funding requests · amounts in MOCKRLUSD · ${data.storage==='supabase'?'Supabase connected':'Local database'}`,'Mock data')+`<p class="note">Scores: 0–19 Decline · 20–49 Risky · 50–69 Medium · 70–100 Safe. Higher scores indicate safer companies. Approval confirms the assumed demo business/background review. Verified demo requests join their risk group and receive funding automatically when cash is available. Deposits release queued requests. Exit requests are checked against rate limits and outstanding debt.</p><div class="company-filters"><label>Group<select id="company-status-filter"><option value="all">All applications</option><option value="pending">Pending approval</option><option value="approved">Approved / funded</option><option value="declined">Rejected</option><option value="repaid">Repaid</option></select></label><label>Pool<select id="company-pool"><option value="all">All pools</option>${['Decline','Risky','Medium','Safe'].map(p=>`<option>${p}</option>`).join('')}</select></label><a href="#borrow" class="primary">New funding request</a></div><p id="company-count" class="caption"></p><div id="companies"></div>`;
  const update=()=>{const rows=data.companies.filter(c=>($('company-pool').value==='all'||c.pool===$('company-pool').value)&&($('company-status-filter').value==='all'||c.status===$('company-status-filter').value));$('company-count').textContent=`${rows.length} companies`;$('companies').innerHTML=companyTable(rows);};
  $('company-pool').onchange=update;$('company-status-filter').onchange=update;update();
}
async function renderMockBorrow(id,version){
  let existing=null;
  if(id){const data=await requestJSON('/api/investor-demo/companies');if(version!==renderVersion)return;existing=data.companies.find(c=>String(c.id)===id);if(!existing)throw new Error('Company not found.');}
  const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);
  const minDate=`${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`;
  $('content').innerHTML=title(existing?'Edit funding request':'Get funded','Submit a company invoice for a mock funding assessment.','Mock assessment')+`<article class="panel funding-panel"><form id="company-funding"><fieldset><div class="form-grid"><label>Name of the company<input name="company_name" required maxlength="160" placeholder="Evergreen Supply"></label><label>Money requested · MOCKRLUSD<input name="money_requested" type="number" required min="0.01" max="100000000" step="0.01" placeholder="25000"></label><label>Debtor<input name="debtor" required maxlength="160" placeholder="Company that owes the invoice"></label><label>Invoice expected payment date<input name="invoice_due" type="date" min="${minDate}" required></label><label>Demo risk score · higher is safer<input name="risk_factor" type="number" min="0" max="100" step="1" value="62" required></label></div><button type="submit" class="primary">${existing?'Save changes':'Submit request'}</button></fieldset><p id="company-status" class="form-status" role="status"></p></form><p class="caption">Demo underwriting: enter a score from 0–100. Scores below 20 are rejected. Submitting confirms the assumed demo business/background review. Eligible requests join their pool and are funded when cash is available. Net payout is principal less a 5% fee. Interest uses the pool’s current APR, locked for the loan term on an actual/365 basis. Maturity is one day after the invoice payment date. This form records invoice details; it does not validate an uploaded invoice.</p></article><div id="company-result" aria-live="polite"></div><a href="#applications" class="document-link">View all company applications ↗</a>`;
  if(existing){const form=$('company-funding');for(const [name,value] of Object.entries({company_name:existing.company_name,money_requested:(existing.money_requested_cents/100).toFixed(2),debtor:existing.debtor,invoice_due:existing.invoice_due,risk_factor:existing.risk_factor})){form.elements.namedItem(name).value=value;}}
  $('company-funding').onsubmit=async e=>{e.preventDefault();const form=e.target;const payload=Object.fromEntries(new FormData(form));payload.risk_factor=Number(payload.risk_factor);const submissionKey='flow-company-request-'+(existing?.id||'new');let saved=JSON.parse(sessionStorage.getItem(submissionKey)||'null');const signature=JSON.stringify(payload);if(!saved||saved.signature!==signature){saved={signature,key:crypto.randomUUID()};sessionStorage.setItem(submissionKey,JSON.stringify(saved));}payload.request_key=saved.key;form.querySelector('fieldset').disabled=true;message('company-status','Saving application…');
    try{const {company:c}=await requestJSON('/api/investor-demo/companies'+(existing?'/'+existing.id:''),payload,existing?'PATCH':'POST');sessionStorage.removeItem(submissionKey);message('company-status',`Application saved${existing?' and updated':''} to the database.`,'success');$('company-result').innerHTML=`<article class="panel"><h2>${escape(c.company_name)}</h2><div class="stats">${metric('Risk factor',c.risk_factor+' / 100')}${metric('Assigned pool',escape(c.pool))}${metric('Net payout',money(c.decided_disbursement_cents),'MOCKRLUSD')}</div><p class="caption">${c.status==='declined'?'Rejected: score below 20. No funds moved.':c.status==='approved'?'Funded. The pool debited full principal, credited 95% to the company and recorded the 5% fee.':'Verified and queued for pool liquidity. The next deposit can release funding.'} Repayment: full principal plus interest at the APR locked on approval, one day after the invoice payment date.</p>${fundingActions(c)}</article>`;if(existing)existing=c;else form.reset();}
    catch(error){message('company-status',error.message,'error');}finally{form.querySelector('fieldset').disabled=false;}
  };
}

async function renderWorkflow(version){
  const [companies,data]=await Promise.all([requestJSON('/api/investor-demo/companies'),requestJSON('/api/investor-demo/vaults')]);if(version!==renderVersion)return;
  const amy=companies.companies.find(c=>c.company_name==="Amy's Cookies");
  const tx=amy&&data.transactions.find(t=>t.company_id===amy.id&&t.kind==='disbursement');
  const terms=tx?.certificate;const v=data.vaults.find(v=>v.pool==='Medium');
  let step=Math.max(0,Math.min(5,Number(sessionStorage.getItem('amy-walkthrough-step'))||0));
  const labels=['Sign in','Invoice','Verification','Pool selection','Disbursement','Certificate'];
  const draw=()=>{
    const principal=terms?.principal_cents||7000000,net=terms?.disbursed_cents||6650000,fee=terms?.fee_cents||350000,repayment=terms?.repayment_cents||7560000;
    const scenes=[
      `<div class="demo-login"><div class="cookie-avatar">AC</div><span class="eyebrow">BUSINESS WORKSPACE</span><h2>Welcome back, Amy.</h2><p>Your Walmart invoice can fund your next batch.</p><div class="demo-identity"><strong>Amy’s Cookies</strong><span>amy@amyscookies.example</span><span class="chip">Fictional demo identity</span></div><button class="primary full" id="journey-next">Continue as Amy →</button><p class="caption">Role-play sign-in. No password, real authentication or personal data is used.</p></div>`,
      `<span class="eyebrow">01 / YOUR FUNDING REQUEST</span><h2>A big order. A little breathing room.</h2><div class="invoice-preview"><div><strong>AMY’S COOKIES</strong><span>Invoice · WAL-2026-1119</span></div><div><span>Bill to</span><strong>Walmart</strong></div><div><span>Expected payment</span><strong>November 19, 2026</strong></div><div><span>Requested principal</span><strong>70,000 MOCKRLUSD</strong></div></div><p>Receive 66,500 today after a 3,500 origination fee. Original walkthrough agreement: 8% fixed interest, due November 20.</p><button class="primary" id="journey-next">${amy?'View submitted request':'Submit demo request'} →</button><p class="caption">${amy?'Showing the saved application. Replaying does not create another request.':'This creates one saved fictional request.'}</p>`,
      `<span class="eyebrow">02 / UNDERWRITING</span><h2>A business we can back.</h2><div class="review-checks"><div>✓ <strong>Business identity</strong><span>Amy’s Cookies · demo verified</span></div><div>✓ <strong>Background review</strong><span>Passed · assumed scenario result</span></div><div>✓ <strong>Invoice review</strong><span>Walmart · November 19 payment</span></div></div><div class="score-display"><strong>62<small>/100</small></strong><span>Medium risk<br>Eligible for financing</span></div><button class="primary" id="journey-next">Continue to pool selection →</button><p class="caption">These checks are scripted demo outcomes, not external verification.</p>`,
      `<span class="eyebrow">03 / CAPITAL MATCH</span><h2>The right pool for Amy.</h2><div class="pool-choice"><div><span>Safe</span><strong>70–100</strong></div><div class="selected"><span>✓ Medium</span><strong>50–69</strong><small>Amy’s score: 62</small></div><div><span>Risky</span><strong>20–49</strong></div></div><div class="stats">${metric('Medium pool cash',money(v.balance_cents))}${metric('Principal required','70,000')}${metric('Current investor quote',(v.rate_bps/100).toFixed(2)+'%','APR')}</div><p>Amy’s agreed 8% fixed-term certificate stays unchanged. Investor forward projections use the pool’s current quote.</p><button class="primary" id="journey-next">${terms?'Replay saved approval':'Approve and disburse'} →</button>`,
      `<span class="eyebrow">04 / MONEY IN MOTION</span><h2>From pooled capital to fresh cookies.</h2><div class="money-motion"><div class="money-node"><span>Medium vault</span><strong>−${money(principal)}</strong></div><div class="money-connector"><i></i><i></i><i></i><span>Funded</span></div><div class="money-split"><div class="money-node company"><span>Amy’s account</span><strong>+${money(net)}</strong></div><div class="money-node"><span>Platform fee · 5%</span><strong>+${money(fee)}</strong></div></div></div><p>${tx?`Saved vault movement: ${money(tx.balance_after_cents+tx.amount_cents)} → ${money(tx.balance_after_cents)} MOCKRLUSD.`:'Funding has not yet been recorded.'}</p><p class="caption break">${tx?'Receipt '+escape(tx.id):'Complete the approval step first.'}</p><button class="primary" id="journey-next">Open the certificate →</button>`,
      `<span class="eyebrow">05 / SAVED AGREEMENT</span><h2>One certificate. Every number accounted for.</h2><div class="certificate-summary"><div>${metric('Principal',money(principal))}${metric('Company received',money(net))}${metric('Interest',money(terms?.interest_cents||560000))}${metric('Total due',money(repayment))}</div><strong>Matures ${escape(terms?.maturity_date||'2026-11-20')}</strong></div>${terms?`<a class="primary" href="/api/investor-demo/certificates/${amy.id}" target="_blank" rel="noopener">Open / print saved certificate ↗</a><iframe class="certificate-frame" title="Amy’s saved funding certificate" src="/api/investor-demo/certificates/${amy.id}"></iframe>`:'<p>Complete approval to issue the certificate.</p>'}<p><a href="#pool/balanced">Explore the live Medium pool ↗</a> · <a href="#portfolio">Investor returns ↗</a></p>`
    ];
    $('content').innerHTML=`<div class="walkthrough-heading"><div><span class="eyebrow">THE AMY’S COOKIES STORY</span><h1>Big orders. Faster cash.</h1><p>Follow a real saved demo request from sign-in to certificate.</p></div><button id="journey-restart">Replay from start</button></div><div class="walkthrough-shell"><nav class="journey-nav" aria-label="Funding journey">${labels.map((label,i)=>`<button data-journey-step="${i}" class="${i===step?'current':i<step?'complete':''}"><span>${i<step?'✓':String(i+1).padStart(2,'0')}</span>${label}</button>`).join('')}<p>Saved data, replayable story.<br>No duplicate transfers.</p></nav><article class="panel journey-scene" aria-live="polite">${scenes[step]}<p id="journey-status" role="status"></p></article></div><div class="journey-footer"><span>STEP ${step+1} OF 6 · ${labels[step].toUpperCase()}</span><div class="journey-progress"><span style="width:${(step+1)/6*100}%"></span></div><span>MOCKRLUSD · Simulation</span></div>`;
    const go=n=>{step=n;sessionStorage.setItem('amy-walkthrough-step',String(n));draw();};
    $('journey-restart').onclick=()=>go(0);
    document.querySelectorAll('[data-journey-step]').forEach(button=>button.onclick=()=>{const n=Number(button.dataset.journeyStep);if(n>=4&&!terms){message('journey-status','Complete approval in Pool selection before viewing the transfer.');return;}go(n);});
    if($('journey-next'))$('journey-next').onclick=async e=>{e.target.disabled=true;try{if(step===1&&!amy){await requestJSON('/api/investor-demo/walkthrough',{});sessionStorage.setItem('amy-walkthrough-step','2');await render();return;}if(step===3&&!terms){let company=amy;if(!company)company=(await requestJSON('/api/investor-demo/walkthrough',{})).company;await requestJSON('/api/investor-demo/approvals/'+company.id,{});sessionStorage.setItem('amy-walkthrough-step','4');await render();return;}go(Math.min(5,step+1));}catch(error){message('journey-status',error.message,'error');e.target.disabled=false;}};
  };draw();
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
  showAccount();
  if(['native-portfolio','native-activity','invoice'].includes(location.hash.slice(1).split('/')[0]))await render();
  else {$('network-status').hidden=true;$('network-label').textContent='Mock lending · Simulation';}
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
