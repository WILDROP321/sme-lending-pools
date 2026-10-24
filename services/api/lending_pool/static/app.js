'use strict';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = cents => new Intl.NumberFormat('en-US', {maximumFractionDigits:2, minimumFractionDigits:2}).format(cents / 100);
const compact = cents => new Intl.NumberFormat('en-US', {notation:'compact',maximumFractionDigits:2}).format(cents / 100);
const pct = (value, digits=2) => Number(value).toFixed(digits) + '%';
const poolName = id => state.pools.find(p => p.id === id)?.name || id;
const statusName = status => ({pending_verification:'Awaiting verification',approved:'Approved · Allocated',rejected:'Rejected'}[status] || status);
let state, authMode = 'register', quoteVersion = 0, quoteTimer;
let depositOperation = null;
const investmentDrafts = new Map();

async function api(path='', payload) {
  let response;
  try {
    response = await fetch('/api/market' + path, payload === undefined ? {} : payload instanceof FormData ?
      {method:'POST',body:payload} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  } catch { throw new Error('Unable to reach the server. Your entries are preserved; retry when connected.'); }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Request failed (${response.status}).`);
  return data;
}
function message(id, value, kind='') {
  const target = $(id);
  if (target) { target.textContent = value; target.className = `form-status ${kind}`; }
}
function statistic(label, value, unit='') {
  return `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}<small>${unit}</small></span></div>`;
}
function title(heading, description, badge='') {
  return `<div class="heading"><div><h1>${heading}</h1><p>${description}</p></div>${badge ? `<span class="chip">${badge}</span>` : ''}</div>`;
}
function renderAccount() {
  $('account').innerHTML = state.investor ? `<span class="account-name">${escape(state.investor.name)}</span><button id="logout" class="subtle">Sign out</button>` : '<button id="open-auth" class="primary">Get started</button>';
  if ($('open-auth')) $('open-auth').onclick = () => openAuth();
  if ($('logout')) $('logout').onclick = async () => {
    $('logout').disabled = true;
    try { state = await api('/logout', {}); depositOperation = null; render(); }
    catch (error) { message('global-status',error.message,'error'); $('logout').disabled = false; }
  };
}
function render() {
  ++quoteVersion;
  clearTimeout(quoteTimer);
  renderAccount();
  const route = location.hash.slice(1) || 'pools';
  const [page, id] = route.split('/');
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active',a.dataset.page === (page === 'pool' ? 'pools' : page)));
  if (page === 'pool') renderPool(state.pools.find(p => p.id === id) || state.pools[0]);
  else if (page === 'portfolio') renderPortfolio();
  else if (page === 'borrow') renderBorrow();
  else if (page === 'review') renderReview();
  else renderPools();
}
function renderPools() {
  const capital = state.pools.reduce((s,p) => s+p.capital_cents,0);
  const deployed = state.pools.reduce((s,p) => s+p.allocated_cents,0);
  const count = state.pools.reduce((s,p) => s+p.companies.length,0);
  $('content').innerHTML = title('Capital, put to work.','Finance tomorrow’s invoices. Choose the pool that fits your risk.','<span class="status-dot"></span> RLUSD lending') +
    `<div class="stats">${statistic('Total pool capital',compact(capital),'RLUSD')}${statistic('Capital deployed',pct(deployed/capital*100))}${statistic('Funded businesses',count)}</div>
    <div class="section-heading"><h3>Lending pools</h3><span class="caption">3 risk tiers · Invoice-backed advances</span></div>
    <div class="pool-grid">${state.pools.map((p,i) => `<a href="#pool/${p.id}" class="pool-card"><div class="pool-top"><h2>${p.name}</h2><span class="chip">${['Lower risk','Moderate risk','Higher risk'][i]}</span></div><span class="caption">Estimated annual pool yield</span><div class="rate">${pct(p.apr)}</div><span class="caption">Based on current allocation</span><dl><div><dt>Total capital</dt><dd>${compact(p.capital_cents)} RLUSD</dd></div><div><dt>Risk score band</dt><dd>${i ? state.pools[i-1].ceiling+'–' : '0–'}${p.ceiling}%</dd></div><div><dt>Businesses</dt><dd>${p.companies.length}</dd></div><div><dt>Available liquidity</dt><dd>${compact(p.reserve_cents)} RLUSD</dd></div></dl><div class="card-link"><span>Explore pool</span><span>↗</span></div></a>`).join('')}</div>
    <p class="note">Every pool finances verified future invoices. Risk percentages are model scores, not default probabilities. Estimates assume continued lending at current rates; delays and losses can reduce returns.</p>`;
}
function chart(apr) {
  const points = Array.from({length:13}, (_,i) => `${20+i*45},${155-i/12*115}`);
  return `<svg class="chart" viewBox="0 0 580 180" role="img" aria-label="Illustrative growth of 10,000 RLUSD over twelve months at ${pct(apr)} simple annual yield">
    <path d="M20 35H560 M20 95H560 M20 155H560" stroke="#252a30" stroke-dasharray="3 5" fill="none"/>
    <polyline points="${points.join(' ')}" fill="none" stroke="#b4f7cf" stroke-width="2"/>
    <circle cx="560" cy="40" r="3" fill="#b4f7cf"/>
    <text x="20" y="25" fill="#8c929c" font-size="10">${money(1000000*(1+apr/100))} RLUSD</text>
    <text x="20" y="175" fill="#8c929c" font-size="10">10,000.00 RLUSD</text></svg><div class="chart-labels"><span>Today</span><span>6 months</span><span>12 months</span></div>`;
}
function renderPool(p) {
  const draft = investmentDrafts.get(p.id) || {amount:'10000',months:'12'};
  $('content').innerHTML = `<a href="#pools" class="back">← All pools</a>` + title(p.name,'Short-duration business financing, grouped by invoice risk.',`Risk score ≤ ${p.ceiling}%`) +
    `<div class="stats">${statistic('Pool capital',compact(p.capital_cents),'RLUSD')}${statistic('Estimated annual yield',pct(p.apr))}${statistic('Weighted risk score',pct(p.risk))}</div>
    <div class="two-col"><div><article class="panel"><span class="eyebrow">PROJECTED GROWTH</span><div class="chart-number">${money(1000000*(1+p.apr/100))} <span class="caption">RLUSD</span></div><span class="caption">Illustrative value of 10,000 RLUSD after 12 months</span>${chart(p.apr)}<p class="caption" style="margin:20px 0 0">Simple annualized projection at today’s allocation. Assumes maturing loans are replaced at the same rates. No compounding or fees; losses excluded.</p></article>
    <article class="panel"><h3>Capital distribution</h3>${[...p.companies.map(c=>({name:c.company,value:c.amount_cents})),{name:'Undeployed reserve',value:p.reserve_cents,reserve:true}].map(c=>`<div class="allocation ${c.reserve?'reserve':''}"><div class="allocation-title"><span>${escape(c.name)}</span><span class="muted">${money(c.value)} · ${pct(c.value/p.capital_cents*100,1)}</span></div><div class="track"><div class="bar" style="width:${c.value/p.capital_cents*100}%"></div></div></div>`).join('')}<p class="caption">Reserve cash earns zero until allocated to approved businesses.</p></article></div>
    <div><article class="panel"><h3>Invest in ${p.name}</h3><form id="invest-form"><fieldset><label>Amount · RLUSD<input id="investment" type="number" min="0.01" max="100000000" step="0.01" value="${escape(draft.amount)}" required></label><label>Projection period<select id="months">${[3,6,12,24].map(months=>`<option value="${months}" ${String(months)===draft.months?'selected':''}>${months} months</option>`).join('')}</select></label>
    <div class="calc-result"><dl><div><dt>Estimated earnings</dt><dd id="quote-earnings">Calculating…</dd></div><div><dt>Loss scenario earnings</dt><dd id="quote-stress">—</dd></div><div><dt>Your share after deposit</dt><dd id="quote-share">—</dd></div><div><dt>Current holdings</dt><dd>${money(p.invested_cents)} RLUSD</dd></div><div><dt>Current pool ownership</dt><dd>${pct(p.ownership_pct,4)}</dd></div></dl></div><button class="primary full" id="invest-submit">${state.investor?'Simulate investment':'Create account to invest'}</button></fieldset><p id="invest-status" class="form-status" role="status"></p></form><p class="caption" style="margin:18px 0 0">New deposits initially stay in reserve, reducing the estimated rate. Ownership = your total deposits ÷ total pool capital. Loss scenario assumes ${p.loss_scenario}% of deployed principal is lost per year.</p></article>
    <article class="panel"><h3>Risk report</h3><dl><div><dt>Weighted company score</dt><dd>${pct(p.risk)}</dd></div><div><dt>Largest exposure</dt><dd>${pct(Math.max(...p.companies.map(c=>c.amount_cents))/p.capital_cents*100)}</dd></div><div><dt>Capital deployed</dt><dd>${pct(p.allocated_cents/p.capital_cents*100)}</dd></div><div><dt>Annual loss scenario yield</dt><dd>${pct(p.stress_apr)}</dd></div></dl><p class="caption" style="margin-top:20px">Scores combine maturity, advance ratio, debtor late payments, and business age. Higher scores mean higher borrowing rates. This is a transparent demo model, not a validated credit rating.</p><p class="caption">Late payment, default, and concentration can reduce returns. Liquidity is tied to invoice maturity; withdrawals are not implemented.</p></article></div></div>
    <article class="panel"><div class="section-heading" style="margin-top:0"><h3>Borrowers</h3><span class="caption">${p.companies.length} companies</span></div><div class="table-wrap"><table><thead><tr><th>Company / cash-flow purpose</th><th>Advance / invoice</th><th>Due date</th><th>Risk / borrowing APR</th><th>Expected loan interest</th></tr></thead><tbody>${p.companies.map(c=>`<tr><td><strong class="company-name">${escape(c.company)}</strong><div class="company-purpose">${escape(c.sector)} · ${escape(c.purpose)}</div><span class="caption">${c.synthetic?'Fictional fixture':'Reviewer approved'}</span></td><td class="nowrap">${money(c.amount_cents)} RLUSD<br><span class="caption">${money(c.invoice_cents)} invoice</span></td><td class="nowrap">${escape(c.due_date)}<br><span class="caption">${escape(c.invoice_ref)}</span></td><td>${pct(c.risk)}<br><span class="caption">${pct(c.assessment.apr)} APR</span></td><td class="nowrap">${money(c.assessment.interest_cents)} RLUSD<br><span class="caption">${c.assessment.term_days}-day term</span></td></tr>`).join('')}</tbody></table></div></article>`;
  $('investment').oninput = () => scheduleQuote(p);
  $('months').onchange = () => scheduleQuote(p);
  $('invest-form').onsubmit = async event => {
    event.preventDefault();
    if (!state.investor) { openAuth(); return; }
    const form = event.target, amount=$('investment').value;
    if (!form.reportValidity()) return;
    const fingerprint=JSON.stringify([state.investor.id,p.id,amount]);
    if (!depositOperation || depositOperation.fingerprint !== fingerprint) depositOperation={fingerprint,key:crypto.randomUUID()};
    form.querySelector('fieldset').disabled=true;
    message('invest-status','Saving simulated deposit…');
    try {
      state=await api('/deposits',{pool:p.id,amount,operation_key:depositOperation.key});
      depositOperation=null; render();
      message('invest-status','Deposit saved. Your holdings and pool share are updated.','success');
    } catch(error) { message('invest-status',error.message,'error'); form.querySelector('fieldset').disabled=false; }
  };
  scheduleQuote(p,0);
}
function scheduleQuote(p, delay=200) {
  clearTimeout(quoteTimer);
  const version=++quoteVersion;
  investmentDrafts.set(p.id,{amount:$('investment').value,months:$('months').value});
  $('quote-earnings').textContent='Calculating…'; $('quote-share').textContent='—'; $('quote-stress').textContent='—';
  if (!$('investment').checkValidity()) { $('quote-earnings').textContent='Enter a valid amount'; return; }
  const amount=$('investment').value, months=Number($('months').value);
  quoteTimer=setTimeout(async()=>{
    try {
      const {quote}=await api('/quote',{pool:p.id,amount,months});
      if (version!==quoteVersion || !$('quote-earnings')) return;
      $('quote-earnings').textContent=money(quote.earnings_cents)+' RLUSD';
      $('quote-stress').textContent=money(quote.stress_earnings_cents)+' RLUSD';
      $('quote-share').textContent=pct(quote.ownership_pct,4);
    } catch(error) { if(version===quoteVersion) message('invest-status',error.message,'error'); }
  },delay);
}
function renderPortfolio() {
  if (!state.investor) {
    $('content').innerHTML=title('Your portfolio.','Every deposit. Every pool. Your share of the capital.')+'<div class="empty"><h2>Build your first position.</h2><p>Create an investor account to keep your holdings separate and track your ownership across pools.</p><button class="primary" id="portfolio-auth">Create investor account</button></div>';
    $('portfolio-auth').onclick=()=>openAuth(); return;
  }
  const holdings=state.pools.filter(p=>p.invested_cents>0), total=holdings.reduce((s,p)=>s+p.invested_cents,0);
  $('content').innerHTML=title('Your portfolio.',`Welcome, ${escape(state.investor.name)}. Your preferred tier is ${escape(poolName(state.investor.preference))}.`,'Simulated holdings')+
    `<div class="stats">${statistic('Total invested',money(total),'RLUSD')}${statistic('Active positions',holdings.length)}${statistic('Estimated annual earnings',money(holdings.reduce((s,p)=>s+p.invested_cents*p.apr/100,0)),'RLUSD')}</div>`+
    (holdings.length ? `<article class="panel"><div class="table-wrap"><table><thead><tr><th>Pool</th><th>Your capital</th><th>Pool ownership</th><th>Estimated annual yield</th><th></th></tr></thead><tbody>${holdings.map(p=>`<tr><td>${p.name}</td><td>${money(p.invested_cents)} RLUSD</td><td>${pct(p.ownership_pct,4)}</td><td>${pct(p.apr)}</td><td><a href="#pool/${p.id}">View pool ↗</a></td></tr>`).join('')}</tbody></table></div></article>` : `<div class="empty"><h2>No investments yet.</h2><p>Choose a pool and make your first simulated deposit.</p><a class="primary" href="#pools">Explore pools</a></div>`)+
    '<p class="note">Holdings reflect your saved deposits. Your share updates when other investors add capital. Earnings are projections; repayments and interest distributions are not yet settled.</p>';
}
function renderBorrow() {
  const tomorrow=new Date(); tomorrow.setDate(tomorrow.getDate()+1);
  const limit=new Date();limit.setDate(limit.getDate()+180);
  const localDate=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  $('content').innerHTML=title('Turn invoices into liquidity.','Apply for working capital against a future customer payment.','Up to 85% advance')+
    `<div class="two-col"><article class="panel"><form id="borrow-form"><fieldset>
    <div class="form-section"><h3><span class="step">01</span> Business details</h3><div class="form-grid"><label>Company name<input name="company" required maxlength="160" placeholder="Evergreen Supply"></label><label>Industry<select name="sector" required><option value="">Select industry</option>${['Manufacturing','Logistics','Healthcare','Food & beverage','Energy','Wholesale','Technology','Creative services','Other'].map(s=>`<option>${s}</option>`).join('')}</select></label></div><label>What will the capital fund?<textarea name="purpose" required maxlength="500" placeholder="Pay suppliers while waiting for a customer invoice to settle"></textarea></label><div class="form-grid"><label>Years in business<input name="years_trading" type="number" min="0" max="100" step="0.1" required placeholder="5"></label><label>Debtor invoices paid late · %<input name="late_payment_pct" type="number" min="0" max="100" step="0.1" required placeholder="10"></label></div><p class="caption">Use the debtor’s historical late-payment rate. The reviewer must corroborate these self-reported inputs.</p></div>
    <div class="form-section"><h3><span class="step">02</span> Future invoice</h3><div class="form-grid"><label>Invoice reference<input name="invoice_ref" required maxlength="120" placeholder="INV-2026-001"></label><label>Customer / debtor<input name="debtor" required maxlength="160" placeholder="Company that owes the payment"></label><label>Invoice face value · RLUSD<input name="invoice" type="number" min="0.01" max="100000000" step="0.01" required placeholder="100000"></label><label>Payment deadline<input name="due_date" type="date" min="${localDate(tomorrow)}" max="${localDate(limit)}" required></label></div><label>Invoice document<input name="document" type="file" accept="application/pdf,image/png,image/jpeg" required></label><p class="caption">PDF, PNG or JPEG · Up to 5 MB. Use fictional business documents for this local demo.</p></div>
    <div class="form-section"><h3><span class="step">03</span> Funding request</h3><label>Requested advance · RLUSD<input name="amount" type="number" min="0.01" max="100000000" step="0.01" required placeholder="70000"></label><p class="caption">The invoice must mature within 180 days. Pool assignment and borrowing terms are calculated automatically, then confirmed at approval.</p></div><button class="primary full">Submit borrow request</button></fieldset><p id="borrow-status" class="form-status" role="status"></p></form></article>
    <aside><article class="panel side-note"><h3>From invoice to capital</h3><ol><li><strong>Submit your invoice.</strong><br>Include the debtor, amount and future payment deadline.</li><li><strong>Get a risk assessment.</strong><br>The model proposes a pool and estimates your borrowing cost.</li><li><strong>Complete manual verification.</strong><br>A reviewer confirms the invoice, debtor and financing status.</li><li><strong>Receive an allocation.</strong><br>Approval reserves available capital in the matching pool.</li></ol><p class="caption">Submitting does not move funds. This demo’s review console records human checks; it does not independently verify real invoices.</p></article><a href="#review" class="document-link">View applications & review status ↗</a></aside></div>`;
  $('borrow-form').onsubmit=async event=>{
    event.preventDefault();const form=event.target;
    if(!form.reportValidity())return;
    const payload=new FormData(form), document=payload.get('document');
    if(document.size>5*1024*1024){message('borrow-status','Invoice document must be at most 5 MB.','error');return;}
    form.querySelector('fieldset').disabled=true;message('borrow-status','Submitting invoice for review…');
    try{state=await api('/requests',payload);form.reset();const r=state.requests[0];message('borrow-status',`Request #${r.id} submitted. Proposed pool: ${poolName(r.pool)} · Risk ${pct(r.risk)} · Expected interest ${money(r.assessment.interest_cents)} RLUSD. Awaiting invoice verification.`,'success');}
    catch(error){message('borrow-status',error.message,'error');}
    finally{form.querySelector('fieldset').disabled=false;}
  };
}
function assessmentDetails(r) {
  if(!r.assessment)return '<p class="caption">Legacy application: missing underwriting data. Reject and resubmit with an invoice document.</p>';
  return `<details><summary>Risk calculation & borrowing terms</summary><ul class="risk-factors"><li><strong>Base score: ${r.assessment.base_score.toFixed(2)} points</strong></li>${r.assessment.factors.map(f=>`<li><strong>${escape(f.name)} · +${f.points.toFixed(2)} points</strong><span class="muted">${escape(f.detail)}</span></li>`).join('')}<li><strong>Total ${pct(r.assessment.score)} → ${escape(poolName(r.assessment.pool))}</strong><span class="muted">${pct(r.assessment.apr)} borrowing APR · ${r.assessment.term_days} days · ${money(r.assessment.repayment_cents)} RLUSD repayment</span></li></ul><p class="caption">Model ${escape(r.assessment.version)}. Terms recalculate at approval using the remaining invoice term.</p></details>`;
}
function renderReview() {
  const pending=state.requests.filter(r=>r.status==='pending_verification').length;
  $('content').innerHTML=title('Invoice review.','Verify the evidence. Confirm the risk. Allocate capital.',`${pending} awaiting review`)+
    '<div class="notice">Local demo review console. This screen is open to local users and has no reviewer role enforcement. Download and inspect each invoice, corroborate the underwriting inputs, and record your checks. Production identity and external verification are not connected.</div>'+
    (state.requests.length ? state.requests.map(r=>`<article class="panel"><div class="review-header"><div><h3>${escape(r.company)}</h3><p class="caption">Request #${r.id} · ${escape(r.sector)} · ${escape(r.purpose)}</p></div><span class="chip ${escape(r.status)}">${escape(statusName(r.status))}</span></div><div class="review-stats"><div><span>Requested advance</span><strong>${money(r.amount_cents)} RLUSD</strong></div><div><span>${r.status==='approved'?'Assigned':'Proposed'} pool</span><strong>${escape(poolName(r.pool))}</strong></div><div><span>Risk score</span><strong>${pct(r.risk)}</strong></div></div><dl><div><dt>Invoice / debtor</dt><dd>${escape(r.invoice_ref)} · ${escape(r.debtor)}</dd></div><div><dt>Face value / deadline</dt><dd>${money(r.invoice_cents)} RLUSD · ${escape(r.due_date)}</dd></div></dl>${r.document_name?`<a class="document-link" href="/api/market/requests/${r.id}/document">↓ Download ${escape(r.document_name)}</a>`:'<p class="error caption">No invoice document attached</p>'}${assessmentDetails(r)}
    ${r.status==='pending_verification'?`<form class="review-form" data-request-id="${r.id}"><fieldset><div class="form-grid"><label>Reviewer name<input name="reviewer" required maxlength="120" placeholder="Your name"></label><label>Decision note<input name="note" required maxlength="2000" placeholder="Evidence reviewed, or reason for rejection"></label></div><label class="check"><input type="checkbox" name="invoice_authentic"><span>Invoice is authentic; amount, deadline and business information match the evidence.</span></label><label class="check"><input type="checkbox" name="debtor_confirmed"><span>Debtor confirms the obligation; payment history and underwriting inputs are corroborated.</span></label><label class="check"><input type="checkbox" name="not_financed"><span>Invoice is not disputed, already paid or financed elsewhere.</span></label><div class="actions"><button class="primary" name="decision" value="approved">Verify & approve allocation</button><button name="decision" value="rejected">Reject request</button></div></fieldset><p id="review-status-${r.id}" class="form-status" role="status"></p></form>`:''}
    ${r.reviews.map(review=>`<div class="audit"><strong>${escape(review.decision==='approved'?'Approved':'Rejected')} by ${escape(review.reviewer)}</strong><p>${escape(review.note)}</p><span class="caption">${escape(review.created_at)} UTC</span></div>`).join('')}</article>`).join(''):'<div class="empty"><h2>No applications yet.</h2><p>Submit a borrow request with a future invoice to start the review flow.</p><a href="#borrow" class="primary">Create borrow request</a></div>');
  document.querySelectorAll('.review-form').forEach(form=>form.onsubmit=async event=>{
    event.preventDefault();const decision=event.submitter?.value;
    if(!decision)return;
    const fields=new FormData(form),id=form.dataset.requestId;
    const checks=Object.fromEntries(['invoice_authentic','debtor_confirmed','not_financed'].map(key=>[key,fields.get(key)==='on']));
    if(decision==='approved'&&!Object.values(checks).every(Boolean)){message(`review-status-${id}`,'Complete all three verification checks before approval.','error');return;}
    form.querySelector('fieldset').disabled=true;
    try{state=await api(`/requests/${id}/review`,{reviewer:fields.get('reviewer'),note:fields.get('note'),decision,checks});render();message('global-status',decision==='approved'?`Request #${id} approved. Capital is allocated in the assigned pool.`:`Request #${id} rejected. No capital allocated.`,'success');}
    catch(error){message(`review-status-${id}`,error.message,'error');form.querySelector('fieldset').disabled=false;}
  });
}
function openAuth(mode='register') {
  setAuthMode(mode);$('auth-dialog').showModal();
}
function setAuthMode(mode) {
  authMode=mode;const register=mode==='register';
  $('auth-title').textContent=register?'Start investing.':'Welcome back.';
  $('auth-submit').textContent=register?'Create account':'Sign in';
  $('auth-description').textContent=register?'Create a local account to track your share of each pool.':'Sign in to view your saved holdings and continue investing.';
  $('register-mode').setAttribute('aria-pressed',String(register));$('login-mode').setAttribute('aria-pressed',String(!register));
  document.querySelectorAll('.register-only').forEach(el=>{el.hidden=!register;el.querySelectorAll('input,select').forEach(input=>input.disabled=!register);});
  const password=$('auth-form').elements.password;password.autocomplete=register?'new-password':'current-password';password.minLength=register?10:1;
  message('auth-status','');
}
$('register-mode').onclick=()=>setAuthMode('register');$('login-mode').onclick=()=>setAuthMode('login');
$('close-auth').onclick=()=>$('auth-dialog').close();
$('auth-form').onsubmit=async event=>{
  event.preventDefault();const form=event.target,fields=Object.fromEntries(new FormData(form));
  fields.risk_acknowledged=fields.risk_acknowledged==='on';
  const fieldset=form.querySelector('fieldset');fieldset.disabled=true;
  $('register-mode').disabled=true;$('login-mode').disabled=true;
  try{state=await api(authMode==='register'?'/investors':'/login',fields);depositOperation=null;form.reset();$('auth-dialog').close();render();message('global-status',authMode==='register'?'Investor account created. Choose a pool to make your first simulated investment.':'Signed in. Your saved holdings are available.','success');}
  catch(error){message('auth-status',error.message,'error');}
  finally{fieldset.disabled=false;$('register-mode').disabled=false;$('login-mode').disabled=false;}
};
window.addEventListener('hashchange',()=>{if(state){message('global-status','');render();window.scrollTo(0,0);}});
api().then(data=>{state=data;render();}).catch(error=>{
  $('content').innerHTML='<div class="empty"><h2>Market unavailable.</h2><p id="load-error"></p><button id="retry">Try again</button></div>';
  $('load-error').textContent=error.message;$('retry').onclick=()=>location.reload();
});
