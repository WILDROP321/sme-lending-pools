(() => {
  "use strict";
  const stageEl = document.getElementById("stage");
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const COUNTRIES = ["Afghanistan","Albania","Algeria","Andorra","Angola","Argentina","Armenia","Australia","Austria","Azerbaijan","Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bhutan","Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso","Burundi","Cambodia","Cameroon","Canada","Cape Verde","Central African Republic","Chad","Chile","China","Colombia","Comoros","Costa Rica","Croatia","Cuba","Cyprus","Czechia","Denmark","Djibouti","Dominica","Dominican Republic","Ecuador","Egypt","El Salvador","Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia","Fiji","Finland","France","Gabon","Gambia","Georgia","Germany","Ghana","Greece","Grenada","Guatemala","Guinea","Guinea-Bissau","Guyana","Haiti","Honduras","Hungary","Iceland","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy","Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kiribati","Kosovo","Kuwait","Kyrgyzstan","Laos","Latvia","Lebanon","Lesotho","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg","Madagascar","Malawi","Malaysia","Maldives","Mali","Malta","Mauritania","Mauritius","Mexico","Micronesia","Moldova","Monaco","Mongolia","Montenegro","Morocco","Mozambique","Myanmar","Namibia","Nauru","Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria","North Korea","North Macedonia","Norway","Oman","Pakistan","Palau","Panama","Papua New Guinea","Paraguay","Peru","Philippines","Poland","Portugal","Qatar","Romania","Russia","Rwanda","Saint Lucia","Samoa","San Marino","Saudi Arabia","Senegal","Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands","Somalia","South Africa","South Korea","South Sudan","Spain","Sri Lanka","Sudan","Suriname","Sweden","Switzerland","Syria","Taiwan","Tajikistan","Tanzania","Thailand","Timor-Leste","Togo","Tonga","Trinidad and Tobago","Tunisia","Turkey","Turkmenistan","Tuvalu","Uganda","Ukraine","United Arab Emirates","United Kingdom","United States","Uruguay","Uzbekistan","Vanuatu","Vatican City","Venezuela","Vietnam","Yemen","Zambia","Zimbabwe"];

  const answers = { firstName: "", lastName: "", email: "", dob: "", country: "", idType: "", idNumber: "", consent: false, path: null };

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value;
    return div.innerHTML;
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function minDobISO() { const d = new Date(); d.setFullYear(d.getFullYear() - 120); return d.toISOString().slice(0, 10); }
  function isAdult(dobStr) {
    if (!dobStr) return false;
    const dob = new Date(dobStr + "T00:00:00");
    if (Number.isNaN(dob.getTime())) return false;
    const today = new Date();
    if (dob > today) return false;
    let age = today.getFullYear() - dob.getFullYear();
    const beforeBirthday = (today.getMonth() < dob.getMonth()) || (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate());
    if (beforeBirthday) age -= 1;
    return age >= 18;
  }
  function emailValid(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()); }

  function icon(name, size = 16) {
    const s = size;
    const icons = {
      shield: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
      lock: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 11V8a4 4 0 018 0v3" stroke="currentColor" stroke-width="1.6"/></svg>`,
      bolt: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"><path d="M13 3L5 13h5l-1 8 8-10h-5l1-8z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
      doc: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"><path d="M7 3h7l4 4v14a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 3v4h4" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
      coins: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"><ellipse cx="9" cy="7" rx="6" ry="3" stroke="currentColor" stroke-width="1.6"/><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7" stroke="currentColor" stroke-width="1.6"/><path d="M12 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5" stroke="currentColor" stroke-width="1.6"/><ellipse cx="18" cy="12" rx="6" ry="3" stroke="currentColor" stroke-width="1.6"/></svg>`,
      check: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      checkSmall: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      arrow: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      upload: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 15V4M12 4l-4 4M12 4l4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
      wallet: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M3 10h18" stroke="currentColor" stroke-width="1.6"/><circle cx="16" cy="14" r="1.3" fill="currentColor"/></svg>`,
    };
    return icons[name] || "";
  }

  function render(html, { wide = false } = {}) {
    stageEl.classList.toggle("wide", Boolean(wide));
    stageEl.innerHTML = `<div class="scene">${html}</div>`;
  }
  function bind(sel, handler, ev = "click") { const el = stageEl.querySelector(sel); if (el) el.addEventListener(ev, handler); }
  function setProgress(visible, fraction, label, count) {
    const row = document.getElementById("progress-row");
    row.classList.toggle("show", visible);
    document.getElementById("progress-label").textContent = label || "";
    document.getElementById("progress-count").textContent = count || "";
    const bar = document.getElementById("qbar");
    bar.classList.toggle("fund", answers.path === "fund");
    bar.querySelector("i").style.width = `${Math.round((fraction || 0) * 100)}%`;
  }

  /* Visible auto-advance: fills a thin bar over `delay`ms, then fires. Any
     further input cancels and resets it, so nothing moves without warning. */
  function autoAdvance(container, delay, onFire) {
    const bar = container.querySelector(".auto-bar i");
    const hint = container.querySelector(".auto-hint");
    let timer = null;
    return {
      arm() {
        this.cancel();
        if (hint) hint.classList.add("show");
        bar.classList.remove("run");
        void bar.offsetWidth;
        if (prefersReducedMotion) { timer = setTimeout(onFire, delay); return; }
        bar.style.transitionDuration = `${delay}ms`;
        requestAnimationFrame(() => bar.classList.add("run"));
        timer = setTimeout(onFire, delay);
      },
      cancel() {
        if (timer) { clearTimeout(timer); timer = null; }
        if (hint) hint.classList.remove("show");
        bar.classList.remove("run");
        bar.style.width = "0%";
      },
    };
  }

  /* ================= Scene: intent (pick path) ========================= */
  function sceneIntent() {
    setProgress(false);
    const hasProgress = maxReached > 0;
    render(`
      <p class="eyebrow">Flow onboarding</p>
      <h1>What brings you to Flow?</h1>
      <p class="lede">Pick one to get a verification tailored to you &mdash; you can add the other later.</p>

      ${hasProgress ? `<div class="resume-note">${icon("checkSmall")}<span>You're <b>${maxReached} of ${QUESTIONS.length}</b> questions in &mdash; pick a path to pick up where you left off.</span></div>` : ""}

      <div class="intent-grid">
        <button class="intent-card fund-flavor" data-path="fund" type="button">
          <div class="intent-icon">${icon("doc", 17)}</div>
          <h3>Get funded</h3>
          <p>Turn an invoice you're owed into cash today.</p>
          <span class="go">For businesses ${icon("arrow")}</span>
        </button>
        <button class="intent-card invest-flavor" data-path="invest" type="button">
          <div class="intent-icon">${icon("coins", 17)}</div>
          <h3>Invest</h3>
          <p>Back a pool of vetted SME advances and earn yield.</p>
          <span class="go">For investors ${icon("arrow")}</span>
        </button>
      </div>

      <div class="unsure"><button class="link-btn" id="unsure-btn">Not sure yet? Compare in 10 seconds</button></div>
      <div class="compare" id="compare">
        <div><h4 style="color:var(--fund)">Get funded</h4><ul><li>Cash in days</li><li>No equity given up</li><li>Backed by your invoice</li></ul><button class="link-btn" data-pick="fund" style="font-size:12px;">Choose this &rarr;</button></div>
        <div><h4 style="color:var(--accent)">Invest</h4><ul><li>Choose your risk tier</li><li>Earn yield on repayments</li><li>Validated on XRP Ledger</li></ul><button class="link-btn" data-pick="invest" style="font-size:12px;">Choose this &rarr;</button></div>
      </div>

      <div class="trust-row">
        <span class="trust-item">${icon("lock", 13)}Encrypted end to end</span>
        <span class="trust-item">${icon("bolt", 13)}Under a minute</span>
        <span class="trust-item">${icon("shield", 13)}Verified once, not every visit</span>
      </div>
    `);
    bind("#unsure-btn", () => document.getElementById("compare").classList.toggle("show"));
    function choose(path) {
      answers.path = path;
      goToQuestion(maxReached < QUESTIONS.length ? maxReached : QUESTIONS.length - 1);
    }
    stageEl.querySelectorAll(".intent-card").forEach((card) => card.addEventListener("click", () => choose(card.dataset.path)));
    stageEl.querySelectorAll("[data-pick]").forEach((btn) => btn.addEventListener("click", () => choose(btn.dataset.pick)));
  }

  /* ================= Conversational identity flow ===================== */
  const QUESTIONS = [
    { id: "name", label: "What's your legal name?", hint: "Exactly as it appears on your ID &mdash; we match these against each other.", kind: "name" },
    { id: "email", label: "What's your email?", hint: "We'll send your verification receipt here. We'll move on automatically once it looks right.", kind: "email", placeholder: "you@example.com", valid: (v) => emailValid(v) },
    { id: "about", label: "A little about you", hint: "Only used to confirm you're 18+ and route you to the right pools.", kind: "about" },
    { id: "idScan", label: "Add a photo of your ID", hint: "Passport, national ID, or driver's licence. Used only to verify you &mdash; not shared with third parties.", kind: "scan", valid: () => Boolean(answers.idType && answers.idNumber.trim().length > 3) },
    { id: "consent", label: "Last thing.", hint: "", kind: "consent", valid: () => Boolean(answers.consent) },
  ];
  let qIndex = 0, maxReached = 0;

  function recapHtml() {
    const shown = QUESTIONS.slice(0, maxReached).filter((q) => q.id !== "consent");
    if (!shown.length) return "";
    const chips = shown.map((q) => {
      let val = answers[q.id];
      if (q.id === "name") val = `${answers.firstName} ${answers.lastName}`.trim();
      if (q.id === "about") val = `${answers.dob} \u00B7 ${answers.country}`;
      if (q.id === "idScan") val = `${answers.idType} \u00B7 ${answers.idNumber}`;
      const idx = QUESTIONS.indexOf(q);
      const label = q.id === "idScan" ? "ID" : q.id[0].toUpperCase() + q.id.slice(1);
      return `<button class="recap-chip" data-jump="${idx}" type="button"><span class="ok">${icon("checkSmall")}</span><span class="lbl">${label}:</span><span class="val">${escapeHtml(String(val))}</span></button>`;
    }).join("");
    return `<div class="recap">${chips}</div>`;
  }

  function goToQuestion(i) { qIndex = i; renderQuestion(); }

  function advance() {
    const editingPast = qIndex < maxReached;
    if (editingPast) { goToQuestion(maxReached); return; }
    maxReached = qIndex + 1;
    if (maxReached >= QUESTIONS.length) { sceneVerifying(); return; }
    qIndex = maxReached;
    renderQuestion();
  }

  function questionChrome(innerHtml) {
    const q = QUESTIONS[qIndex];
    const n = QUESTIONS.length;
    setProgress(true, qIndex / n, answers.path === "fund" ? "Business verification" : "Investor verification", `${qIndex + 1} of ${n}`);
    render(`
      ${recapHtml()}
      <div class="qcard">
        <p class="qlabel" id="qlabel-text">${q.label}</p>
        ${q.hint ? `<p class="qhint" id="qhint-text">${q.hint}</p>` : ""}
        ${innerHtml}
      </div>
    `);
    stageEl.querySelectorAll(".recap-chip").forEach((chip) => chip.addEventListener("click", () => goToQuestion(Number(chip.dataset.jump))));
  }

  function footerActions({ nextLabel = "Continue", nextDisabled = true, onNext } = {}) {
    const wrap = document.createElement("div");
    wrap.className = "actions";
    wrap.innerHTML = `
      <button class="btn btn-ghost" id="q-back">&larr; Back</button>
      <div style="display:flex;align-items:center;gap:14px;">
        <span class="q-kbd">press <kbd>Enter</kbd> &crarr;</span>
        <button class="btn btn-primary" id="q-next" ${nextDisabled ? "disabled" : ""}>${nextLabel} ${icon("arrow")}</button>
      </div>
    `;
    stageEl.querySelector(".qcard").appendChild(wrap);
    wrap.querySelector("#q-next").addEventListener("click", onNext);
    wrap.querySelector("#q-back").addEventListener("click", () => { if (qIndex === 0) sceneIntent(); else goToQuestion(qIndex - 1); });
    return wrap.querySelector("#q-next");
  }

  function renderQuestion() {
    const q = QUESTIONS[qIndex];
    if (q.kind === "name") return renderNameQuestion(q);
    if (q.kind === "email") return renderEmailQuestion(q);
    if (q.kind === "about") return renderAboutQuestion(q);
    if (q.kind === "scan") return renderScanQuestion(q);
    if (q.kind === "consent") return renderConsentQuestion(q);
  }

  function renderNameQuestion(q) {
    questionChrome(`
      <div class="two-up">
        <div class="qinput-row ${answers.path === "fund" ? "fund" : ""}" id="row-first">
          <label class="sr-only" for="q-first">First name</label>
          <input id="q-first" type="text" placeholder="First name" value="${escapeHtml(answers.firstName)}" autocomplete="given-name">
        </div>
        <div class="qinput-row ${answers.path === "fund" ? "fund" : ""}" id="row-last">
          <label class="sr-only" for="q-last">Last name</label>
          <input id="q-last" type="text" placeholder="Last name" value="${escapeHtml(answers.lastName)}" autocomplete="family-name">
        </div>
      </div>
      <p class="qerr" id="q-err" aria-live="polite"></p>
    `);
    const first = stageEl.querySelector("#q-first"), last = stageEl.querySelector("#q-last");
    const err = stageEl.querySelector("#q-err");
    function ok() { return first.value.trim().length > 0 && last.value.trim().length > 0; }
    function commit() { answers.firstName = first.value.trim(); answers.lastName = last.value.trim(); advance(); }
    const next = footerActions({ nextDisabled: !ok(), onNext: () => { if (ok()) commit(); } });
    function check(showErr) {
      const valid = ok();
      next.disabled = !valid;
      err.textContent = (showErr && !valid) ? "Enter both your first and last name." : "";
    }
    [first, last].forEach((el) => {
      el.addEventListener("input", () => check(false));
      el.addEventListener("blur", () => check(true));
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" && ok()) commit(); });
    });
    check(false);
    first.focus();
  }

  function renderEmailQuestion(q) {
    questionChrome(`
      <div class="qinput-row ${answers.path === "fund" ? "fund" : ""}" id="q-row">
        <label class="sr-only" for="q-input">${q.label}</label>
        <input id="q-input" type="email" placeholder="${q.placeholder}" value="${escapeHtml(answers.email)}" autocomplete="email">
        <span class="ok-mark">${icon("check", 16)}</span>
      </div>
      <p class="qerr" id="q-err" aria-live="polite"></p>
      <div class="auto-bar"><i></i></div>
      <p class="auto-hint">${icon("checkSmall")}Looks good &mdash; moving on&hellip;</p>
    `);
    const input = stageEl.querySelector("#q-input"), row = stageEl.querySelector("#q-row"), err = stageEl.querySelector("#q-err");
    function commit() { answers.email = input.value.trim(); advance(); }
    const next = footerActions({ nextDisabled: !q.valid(input.value), onNext: () => { if (q.valid(input.value)) { auto.cancel(); commit(); } } });
    const auto = autoAdvance(stageEl, 900, commit);
    function check(showErr) {
      const ok = q.valid(input.value);
      row.classList.toggle("valid", ok);
      row.classList.toggle("invalid", showErr && !ok && input.value.length > 0);
      next.disabled = !ok;
      err.textContent = (showErr && !ok && input.value.length > 0) ? "Enter a valid email address." : "";
      if (ok) auto.arm(); else auto.cancel();
    }
    input.addEventListener("input", () => check(false));
    input.addEventListener("blur", () => check(true));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && q.valid(input.value)) { auto.cancel(); commit(); } });
    check(false);
    input.focus();
  }

  function renderAboutQuestion(q) {
    questionChrome(`
      <div class="two-up">
        <div>
          <label class="sr-only" for="q-dob">Date of birth</label>
          <div class="qinput-row ${answers.path === "fund" ? "fund" : ""}" id="row-dob">
            <input id="q-dob" type="date" value="${escapeHtml(answers.dob)}" autocomplete="bday" min="${minDobISO()}" max="${todayISO()}">
          </div>
        </div>
        <div>
          <label class="sr-only" for="q-country">Country</label>
          <div class="combobox" id="row-country">
            <input id="q-country" type="text" placeholder="Country&hellip;" value="${escapeHtml(answers.country)}" autocomplete="country-name">
            <div class="combo-list" id="combo-list"></div>
          </div>
        </div>
      </div>
      <p class="qerr" id="q-err" aria-live="polite"></p>
      <div class="auto-bar"><i></i></div>
      <p class="auto-hint">${icon("checkSmall")}Got it &mdash; moving on&hellip;</p>
    `);
    const dob = stageEl.querySelector("#q-dob"), country = stageEl.querySelector("#q-country");
    const list = stageEl.querySelector("#combo-list"), err = stageEl.querySelector("#q-err");
    function dobOk() { return isAdult(dob.value); }
    function countryOk() { return COUNTRIES.includes(country.value); }
    function commit() { answers.dob = dob.value; answers.country = country.value; advance(); }
    const next = footerActions({ nextDisabled: true, onNext: () => { if (dobOk() && countryOk()) { auto.cancel(); commit(); } } });
    const auto = autoAdvance(stageEl, 700, commit);
    function message() {
      if (dob.value && new Date(dob.value + "T00:00:00") > new Date()) return "Date of birth can't be in the future.";
      if (dob.value && !dobOk()) return "You must be 18 or older to continue.";
      if (country.value && !countryOk()) return "Select a country from the list.";
      return "";
    }
    function check() {
      const ok = dobOk() && countryOk();
      next.disabled = !ok;
      err.textContent = message();
      if (ok) auto.arm(); else auto.cancel();
    }
    dob.addEventListener("input", check);
    dob.addEventListener("keydown", (e) => { if (e.key === "Enter" && dobOk() && countryOk()) { auto.cancel(); commit(); } });

    let active = -1;
    function matches() { return COUNTRIES.filter((c) => c.toLowerCase().includes(country.value.trim().toLowerCase())).slice(0, 40); }
    function renderList(open) {
      const m = matches();
      list.innerHTML = m.length ? m.map((c, i) => `<div class="combo-opt${i === active ? " active" : ""}" data-val="${c}">${c}</div>`).join("") : `<div class="combo-empty">No match</div>`;
      list.classList.toggle("show", open);
      list.querySelectorAll(".combo-opt").forEach((opt) => opt.addEventListener("mousedown", (e) => { e.preventDefault(); selectCountry(opt.dataset.val); }));
    }
    function selectCountry(val) { country.value = val; renderList(false); check(); }
    country.addEventListener("focus", () => renderList(true));
    country.addEventListener("input", () => { active = -1; renderList(true); check(); });
    country.addEventListener("blur", () => setTimeout(() => { renderList(false); check(); }, 120));
    country.addEventListener("keydown", (e) => {
      const m = matches();
      if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, m.length - 1); renderList(true); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); renderList(true); }
      else if (e.key === "Enter") { if (active >= 0 && m[active]) selectCountry(m[active]); else if (dobOk() && countryOk()) { auto.cancel(); commit(); } }
    });
    check();
    dob.focus();
  }

  function fakeIdDetails() {
    const options = [
      { type: "Passport", make: () => "P" + Math.random().toString(36).slice(2, 4).toUpperCase() + Math.floor(1000000 + Math.random() * 8999999) },
      { type: "National ID card", make: () => "ID" + Math.floor(100000000 + Math.random() * 899999999) },
      { type: "Driver's licence", make: () => "DL-" + Math.floor(100000 + Math.random() * 899999) },
    ];
    const chosen = options[Math.floor(Math.random() * options.length)];
    return { type: chosen.type, number: chosen.make() };
  }

  function renderScanQuestion(q) {
    const already = Boolean(answers.idType && answers.idNumber);
    questionChrome(`<div id="scan-slot">${already ? scanResultHtml() : scanZoneHtml()}</div>`);
    const next = footerActions({ nextLabel: already ? "Looks right, continue" : "Continue", nextDisabled: !already, onNext: () => { if (q.valid()) advance(); } });

    function scanZoneHtml() {
      return `<div class="scan-zone" id="scan-zone" role="button" tabindex="0" aria-label="Upload a photo of your ID">
        <div class="scan-zone-icon">${icon("upload")}</div><b>Click to upload a photo</b><span>PNG or JPG &mdash; we auto-fill the details</span></div>`;
    }
    function scanResultHtml() {
      return `<div class="scan-result">
        <div class="scan-result-head">${icon("checkSmall")}Detected from your photo</div>
        <div class="scan-fields">
          <div class="scan-field"><label for="sf-type">ID type</label>
            <select id="sf-type">${["Passport", "National ID card", "Driver's licence"].map((t) => `<option ${answers.idType === t ? "selected" : ""}>${t}</option>`).join("")}</select>
          </div>
          <div class="scan-field"><label for="sf-num">ID number</label><input id="sf-num" type="text" value="${escapeHtml(answers.idNumber)}"><p class="ferr" id="sf-err"></p></div>
        </div>
      </div>`;
    }
    function wireScanFields() {
      const t = stageEl.querySelector("#sf-type"), num = stageEl.querySelector("#sf-num"), ferr = stageEl.querySelector("#sf-err");
      if (!t) return;
      t.addEventListener("change", () => { answers.idType = t.value; });
      num.addEventListener("input", () => {
        answers.idNumber = num.value;
        const ok = num.value.trim().length > 3;
        next.disabled = !ok;
        ferr.textContent = ok ? "" : "Enter at least 4 characters.";
      });
    }
    const zone = stageEl.querySelector("#scan-zone");
    if (zone) {
      const startScan = () => {
        stageEl.querySelector("#scan-slot").innerHTML = `<div class="scanning"><div class="scan-spinner"></div><div><b style="font-size:13.5px;">Reading your ID&hellip;</b><div style="font-size:11.5px;color:var(--faint);margin-top:2px;">This takes a moment</div></div></div>`;
        setTimeout(() => {
          const d = fakeIdDetails();
          answers.idType = d.type; answers.idNumber = d.number;
          stageEl.querySelector("#scan-slot").innerHTML = scanResultHtml();
          wireScanFields();
          next.disabled = false;
          next.innerHTML = `Looks right, continue ${icon("arrow")}`;
        }, prefersReducedMotion ? 150 : 850);
      };
      zone.addEventListener("click", startScan);
      zone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startScan(); } });
    } else {
      wireScanFields();
    }
  }

  function renderConsentQuestion(q) {
    questionChrome(`
      <label class="consent-row">
        <input type="checkbox" id="q-consent" ${answers.consent ? "checked" : ""}>
        <span>I confirm this information is accurate and I agree to Flow's identity verification terms.</span>
      </label>
    `);
    const box = stageEl.querySelector("#q-consent");
    const next = footerActions({ nextLabel: "Verify my identity", nextDisabled: !box.checked, onNext: () => { answers.consent = box.checked; advance(); } });
    box.addEventListener("change", () => { next.disabled = !box.checked; });
  }

  /* ================= Verifying / verified / done ======================= */
  function sceneVerifying() {
    setProgress(true, 1, answers.path === "fund" ? "Business verification" : "Investor verification", `${QUESTIONS.length} of ${QUESTIONS.length}`);
    render(`
      <div class="verify-stage">
        <div class="orbit ${answers.path === "fund" ? "fund" : ""}">
          <svg viewBox="0 0 68 68"><circle class="track" cx="34" cy="34" r="27"></circle><circle class="sweep" cx="34" cy="34" r="27" pathLength="150"></circle></svg>
          <div class="check">${icon("check", 24)}</div>
        </div>
        <h2>Verifying your identity&hellip;</h2>
        <p>Checking your document and details.</p>
      </div>
    `);
    setTimeout(sceneVerified, prefersReducedMotion ? 250 : 950);
  }

  function sceneVerified() {
    const ref = "KYC-" + Math.random().toString(36).slice(2, 8).toUpperCase();
    render(`
      <div class="verify-stage">
        <div class="orbit"><svg viewBox="0 0 68 68"><circle class="track" cx="34" cy="34" r="27"></circle></svg>
          <div class="check" style="opacity:1;color:${answers.path === "fund" ? "var(--fund-ink)" : "var(--accent-ink)"};background:${answers.path === "fund" ? "var(--fund)" : "var(--accent)"};border-radius:50%;width:68px;height:68px;">${icon("check", 24)}</div>
        </div>
        <h2>You're verified, ${escapeHtml(answers.firstName || "there")}.</h2>
        <p>Identity confirmed. This only needs to happen once.</p>
        <p class="verify-ref">Reference ${ref}</p>
      </div>
      <button class="btn btn-primary btn-full" id="next" style="margin-top:22px;">Continue ${icon("arrow")}</button>
    `);
    bind("#next", sceneDone);
  }

  function sceneDone() {
    setProgress(false);
    const firstName = escapeHtml(answers.firstName || "there");
    const isFund = answers.path === "fund";
    render(`
      <span class="done-badge ${isFund ? "fund" : "invest"}">${icon("checkSmall")}${isFund ? "Business account" : "Investor account"}</span>
      <h2>Welcome to Flow, ${firstName}.</h2>
      <p class="lede">One step left: connect a Devnet wallet so you can ${isFund ? "submit a funding request" : "back a pool"}.</p>
      <div class="handoff">
        <div class="handoff-row now"><span class="hn">${icon("checkSmall")}</span><span>Identity verified</span></div>
        <div class="handoff-row"><span class="hn">${icon("wallet", 12)}</span><span>Connect GemWallet (Devnet)</span></div>
        <div class="handoff-row"><span class="hn">${icon(isFund ? "doc" : "coins", 12)}</span><span>${isFund ? "Submit your funding request" : "Choose a pool and invest"}</span></div>
      </div>
      <button class="btn btn-primary btn-full" id="cta">Continue to Flow ${icon("arrow")}</button>
      <div class="actions" style="margin-top:12px;"><button class="btn btn-ghost" id="back">&larr; Choose a different path</button></div>
    `);
    bind("#back", sceneIntent);
    bind("#cta", () => { window.location.href = `/${answers.path === "fund" ? "#borrow" : "#pools"}`; });
  }

  document.getElementById("exit-btn").addEventListener("click", () => {
    stageEl.style.transition = "opacity .2s";
    stageEl.style.opacity = "0.3";
    setTimeout(() => { stageEl.style.opacity = "1"; }, 250);
  });

  /* ---- Ambient ledger-field canvas -------------------------------------*/
  (function ledgerField() {
    const canvas = document.getElementById("ledger-field");
    const ctx = canvas.getContext("2d");
    let w, h, dpr;
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.width = window.innerWidth * dpr; h = canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px"; canvas.style.height = window.innerHeight + "px";
    }
    resize(); window.addEventListener("resize", resize);
    const rowGap = 34; let t = 0;
    function frame() {
      ctx.clearRect(0, 0, w, h);
      const rows = Math.ceil(h / (rowGap * dpr)) + 2;
      const [r, g, b] = answers.path === "fund" ? [231, 197, 133] : [180, 247, 207];
      for (let i = 0; i < rows; i++) {
        const y = i * rowGap * dpr;
        ctx.strokeStyle = "rgba(255,255,255,0.025)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      const bandY = ((t * 0.035) % (h + 260)) - 130;
      const grad = ctx.createLinearGradient(0, bandY - 130, 0, bandY + 130);
      grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
      grad.addColorStop(0.5, `rgba(${r},${g},${b},0.05)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad; ctx.fillRect(0, bandY - 130, w, 260);
      t += 1;
      if (!prefersReducedMotion) requestAnimationFrame(frame);
    }
    frame();
  })();

  sceneIntent();
})();
