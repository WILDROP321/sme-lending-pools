// Local product demo only. Never calls a ledger, signs, or represents official RLUSD.
const demoMode = true; // One app; legacy mode URLs also open this interface.
const demoPools = [
  {id:'core',name:'Core Income',risk:'Lower risk',apy:4.25,total:1250000,used:650000,color:'#3478ff'},
  {id:'balanced',name:'Balanced Growth',risk:'Moderate risk',apy:6.8,total:840000,used:525000,color:'#9c91ff'},
  {id:'opportunity',name:'Opportunity',risk:'Higher risk',apy:9.4,total:420000,used:280000,color:'#b5d94e'}
];
const demoInitial = () => ({cash:1000000,holdings:{core:0,balanced:0,opportunity:0},loan:0,history:[]});
let demoState=demoInitial();
try {const saved=JSON.parse(localStorage.getItem('flow-demo-v1'));if(saved && Number.isSafeInteger(saved.cash)&&saved.holdings&&Array.isArray(saved.history))demoState=saved;}catch{/* New demo session. */}
const demoNumber = n => new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n);
function renderDemo(){
  const [page='pools',id]=location.hash.slice(1).split('/');
  document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.dataset.page===(page==='pool'?'pools':page)));
  $('network-label').textContent='Flow markets · RLUSD demo';
  $('network-status').innerHTML='<div class="demo-disclosure"><span>DEMO</span> Mock RLUSD · fictional balances and illustrative APYs · no blockchain transactions.</div>';
  showAccount();
  if($('connect-wallet'))$('connect-wallet').onclick=connectDemoWallet;
  if(page==='pool')return demoDetail(demoPools.find(p=>p.id===id)||demoPools[0]);
  if(page==='pools')return demoHome();
  if(page==='workflow'){$('content').innerHTML=title('How the demo works','Every amount and action in this mode is simulated locally.')+'<div class="two-col"><article class="panel"><h2>Investor</h2><p>Start with 10,000 mock RLUSD → choose a pool → simulate a deposit → inspect your position → withdraw.</p><p>APYs are illustrative; interest does not accrue.</p></article><article class="panel"><h2>Borrower</h2><p>Simulate an advance → receive mock RLUSD → repay from the demo balance.</p><p>This shortcut has no invoice review, credit decision or signed loan agreement.</p></article></div><p class="note">Connect GemWallet to verify wallet ownership in this app. All investment and funding actions remain simulated; mock balances are separate from your wallet funds.</p>';return;}
  if(page==='activity'||page==='applications'){$('content').innerHTML=title(page==='activity'?'Demo activity':'Demo applications','Local simulation only. No transaction hashes, explorer proofs or real applications.')+demoState.history.map(h=>`<article class="panel">${escape(h)}</article>`).reverse().join('')+(!demoState.history.length?'<div class="empty">No demo activity yet.</div>':'');return;}
  $('content').innerHTML=title(page==='borrow'?'Try a mock advance':'Your demo positions','Stored only in this browser. No real RLUSD. Connecting GemWallet verifies ownership only.')+`<div class="stats">${metric('Demo wallet',demoNumber(demoState.cash/100),'mock RLUSD')}${metric('Deposited',demoNumber(Object.values(demoState.holdings).reduce((a,b)=>a+b,0)/100),'mock RLUSD')}${metric('Demo loan',demoNumber(demoState.loan/100),'mock RLUSD')}</div><div class="two-col"><article class="panel"><h2>Simulate borrowing</h2><p class="muted">Maximum 5,000 mock RLUSD outstanding. No interest or underwriting in this demo.</p>${demoForm('borrow')}</article><article class="panel"><h2>Repay the mock advance</h2>${demoForm('repay')}</article></div><button id="reset-demo">Reset demo balance and history</button><p id="demo-feedback" role="status"></p>`;
  bindDemo();$('reset-demo').onclick=()=>{demoState=demoInitial();saveDemo();renderDemo();};
}
function demoHome(){
  $('content').innerHTML=`<div class="earn-heading"><div><h1>Earn</h1><p>Supply mock RLUSD to SME lending pools. Explore yield from borrower demand.</p></div><div><span class="muted">Demo protocol deposits</span><strong>${demoNumber(demoPools.reduce((s,p)=>s+p.total,0)+Object.values(demoState.holdings).reduce((a,b)=>a+b,0)/100)} <small>RLUSD</small></strong></div></div><div class="earn-toolbar"><span class="filter-pill">◉ &nbsp; XRPL demo</span><label class="sr-only" for="pool-search">Search pools</label><input id="pool-search" placeholder="⌕  Search assets and pools"><label>Risk <select id="pool-risk"><option value="all">All strategies</option>${demoPools.map(p=>`<option>${p.risk}</option>`).join('')}</select></label><label>Sort by <select id="pool-sort"><option value="apy">APY ↓</option><option value="name">Name</option></select></label><button id="pool-view" aria-pressed="false">☷ List view</button></div><div class="section-heading"><h2>RLUSD lending pools</h2><span class="caption">Illustrative annual yields</span></div><div id="earn-grid" class="earn-grid"></div><p class="note">Mock RLUSD has no monetary value and is not issued by Ripple. Figures are fictional; risk tiers and yields demonstrate the product concept.</p>`;
  const update=()=>{let list=demoPools.filter(p=>(p.name+' RLUSD').toLowerCase().includes($('pool-search').value.toLowerCase())&&($('pool-risk').value==='all'||p.risk===$('pool-risk').value));list.sort($('pool-sort').value==='apy'?(a,b)=>b.apy-a.apy:(a,b)=>a.name.localeCompare(b.name));$('earn-grid').innerHTML=list.map(p=>`<a class="earn-card" href="#pool/${p.id}"><div class="earn-asset"><span class="token-mark" style="--token-color:${p.color}">✣</span><div><h3>${p.name}</h3><span class="muted">RLUSD · ${p.risk}</span></div></div><div class="earn-yield"><span class="muted">Demo earn APY</span><strong>${pct(p.apy)} <span>◉</span></strong></div><div class="earn-card-bottom"><span>${demoNumber(p.total+demoState.holdings[p.id]/100)} mock RLUSD</span><span>↗</span></div></a>`).join('')||'<div class="empty">No pools match your filters.</div>';};
  $('pool-search').oninput=update;$('pool-risk').onchange=update;$('pool-sort').onchange=update;$('pool-view').onclick=()=>{const list=$('earn-grid').classList.toggle('list-view');$('pool-view').setAttribute('aria-pressed',list);$('pool-view').textContent=list?'▦ Grid view':'☷ List view';};update();
}
function demoForm(action,pool='') {return `<form class="demo-action" data-action="${action}" data-pool="${pool}"><label>Amount · mock RLUSD<input name="amount" required inputmode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" placeholder="100.00"></label><button class="primary full">Simulate ${action}</button></form>`;}
function demoDetail(p){
  const deposited=demoState.holdings[p.id]/100;
  $('content').innerHTML=`<a href="#pools" class="back">← All pools</a><div class="detail-layout"><div><div class="asset-heading"><span class="token-mark" style="--token-color:${p.color}">✣</span><div><h1>${p.name}</h1><p class="muted">Mock RLUSD · ${p.risk}</p></div></div><div class="detail-stats">${metric('Demo deposits',demoNumber(p.total+deposited),'RLUSD')}${metric('Demo borrowed',demoNumber(p.used),'RLUSD')}${metric('Demo liquidity',demoNumber(p.total+deposited-p.used),'RLUSD')}${metric('Illustrative APY',pct(p.apy))}</div><section class="detail-section"><h2>About this strategy</h2><p class="muted">Finance future SME receivables in the ${p.risk.toLowerCase()} strategy. This is a product simulation, with fictional liquidity and no accruing interest.</p><h2>Your demo position</h2><div class="chart-number">${demoNumber(deposited)} mock RLUSD</div></section></div><aside class="positions"><article class="panel"><h2>Demo wallet</h2><div class="chart-number">${demoNumber(demoState.cash/100)}</div><p class="caption">Mock RLUSD · no real funds</p></article><article class="panel"><h3>Deposit</h3>${demoForm('deposit',p.id)}</article><article class="panel"><h3>Withdraw</h3>${demoForm('withdraw',p.id)}</article><p id="demo-feedback" role="status"></p></aside></div>`;bindDemo();
}
function saveDemo(){try{localStorage.setItem('flow-demo-v1',JSON.stringify(demoState));}catch{/* Session still works without persistence. */}}
function bindDemo(){document.querySelectorAll('.demo-action').forEach(f=>f.onsubmit=e=>{e.preventDefault();const value=new FormData(f).get('amount');const amount=Math.round(Number(value)*100),a=f.dataset.action,p=f.dataset.pool;
  if(!/^\d+(\.\d{1,2})?$/.test(value)||!Number.isSafeInteger(amount)||amount<=0)return message('demo-feedback','Enter a positive amount with at most two decimals.','error');
  if((a==='deposit'||a==='repay')&&amount>demoState.cash)return message('demo-feedback','Insufficient mock RLUSD.','error');
  if(a==='withdraw'&&amount>demoState.holdings[p])return message('demo-feedback','Amount exceeds your demo position.','error');
  if(a==='repay'&&amount>demoState.loan)return message('demo-feedback','Amount exceeds your demo loan.','error');
  if(a==='borrow'&&demoState.loan+amount>500000)return message('demo-feedback','Demo borrowing limit is 5,000 mock RLUSD.','error');
  if(a==='deposit'){demoState.cash-=amount;demoState.holdings[p]+=amount;}if(a==='withdraw'){demoState.cash+=amount;demoState.holdings[p]-=amount;}if(a==='borrow'){demoState.cash+=amount;demoState.loan+=amount;}if(a==='repay'){demoState.cash-=amount;demoState.loan-=amount;}
  demoState.history.push(`Simulated ${a}: ${demoNumber(amount/100)} mock RLUSD${p?' · '+p:''}`);saveDemo();renderDemo();message('demo-feedback','Demo updated. No blockchain transaction occurred.','success');
});}

async function connectDemoWallet(){
  try {
    network=await api('/status');
    await connectWallet();
    if(walletInfo)message('global-status','GemWallet ownership verified. Demo balances remain fictional; no funds were moved.','success');
  } catch(error){message('global-status',error.message,'error');}
}
