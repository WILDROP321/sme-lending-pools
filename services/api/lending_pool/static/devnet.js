(() => {
  "use strict";

  async function api(method, path, body) {
    const options = { method };
    if (body !== undefined) {
      options.headers = { "Content-Type": "application/json" };
      options.body = JSON.stringify(body);
    }
    const response = await fetch(path, options);
    let data = null;
    try {
      data = await response.json();
    } catch (_error) {
      data = null;
    }
    if (!response.ok) {
      const message = data && data.error && data.error.message
        ? data.error.message
        : `Request failed (${response.status}).`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function setStatus(element, message, isError) {
    element.textContent = message;
    element.classList.toggle("error", Boolean(isError));
    element.classList.toggle("success", !isError && Boolean(message));
  }

  // Avoid floating-point drift (e.g. 0.1 XRP must be exactly 100000 drops).
  function xrpToDrops(input) {
    const value = String(input).trim();
    if (!/^\d+(\.\d{1,6})?$/.test(value)) {
      throw new Error("Enter an amount in XRP with up to 6 decimal places.");
    }
    const [whole, fraction = ""] = value.split(".");
    const paddedFraction = (fraction + "000000").slice(0, 6);
    const drops = BigInt(whole || "0") * 1000000n + BigInt(paddedFraction || "0");
    if (drops <= 0n) {
      throw new Error("Amount must be greater than zero.");
    }
    if (drops > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("That amount is too large for this demo form.");
    }
    return Number(drops);
  }

  function dropsToXrp(drops) {
    const xrp = Number(drops) / 1_000_000;
    return xrp.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }

  const state = { investors: [], pools: [] };

  function populateSelect(select, records, placeholder) {
    select.textContent = "";
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = records.length ? placeholder : "None registered yet";
    emptyOption.disabled = true;
    emptyOption.selected = true;
    select.appendChild(emptyOption);
    for (const record of records) {
      const option = document.createElement("option");
      option.value = String(record.id);
      option.textContent = `#${record.id} — ${record.name}`;
      select.appendChild(option);
    }
  }

  async function refreshInvestorsAndPools() {
    const [investorData, poolData] = await Promise.all([
      api("GET", "/api/investors"),
      api("GET", "/api/pools"),
    ]);
    state.investors = investorData.investors;
    state.pools = poolData.pools;
    populateSelect(document.getElementById("intent-investor"), state.investors, "Choose an investor");
    populateSelect(document.getElementById("intent-pool"), state.pools, "Choose a pool");
  }

  function nameFor(records, id) {
    const record = records.find((item) => item.id === id);
    return record ? record.name : `#${id}`;
  }

  function buildDepositCell(intent) {
    const cell = document.createElement("td");
    if (intent.status === "funded") {
      const badge = document.createElement("span");
      badge.className = "funded-badge";
      badge.textContent = "✓ Funded";
      cell.appendChild(badge);
      if (intent.tx_hash) {
        const link = document.createElement("a");
        link.className = "tx-hash";
        link.href = `https://devnet.xrpl.org/transactions/${intent.tx_hash}`;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = `${intent.tx_hash.slice(0, 10)}…${intent.tx_hash.slice(-6)}`;
        cell.appendChild(link);
      }
      return cell;
    }

    const form = document.createElement("form");
    form.className = "deposit-form";
    const input = document.createElement("input");
    input.className = "mono";
    input.placeholder = "64-char tx hash";
    input.maxLength = 64;
    input.required = true;
    input.setAttribute("aria-label", `Transaction hash for intent ${intent.id}`);
    const button = document.createElement("button");
    button.type = "submit";
    button.textContent = "Confirm";
    form.appendChild(input);
    form.appendChild(button);

    const rowStatus = document.createElement("p");
    rowStatus.className = "row-status";

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      button.disabled = true;
      setStatus(rowStatus, "Verifying against Devnet…", false);
      try {
        await api("POST", `/api/contribution-intents/${intent.id}/deposit`, { tx_hash: input.value.trim() });
        setStatus(rowStatus, "Funded.", false);
        await refreshIntents();
      } catch (error) {
        setStatus(rowStatus, error.message, true);
        button.disabled = false;
      }
    });

    cell.appendChild(form);
    cell.appendChild(rowStatus);
    return cell;
  }

  async function refreshIntents() {
    const body = document.getElementById("intents-body");
    const { contribution_intents: intents } = await api("GET", "/api/contribution-intents");
    body.textContent = "";
    if (!intents.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 6;
      cell.className = "muted";
      cell.textContent = "No contribution intents yet. Create one on the right.";
      row.appendChild(cell);
      body.appendChild(row);
      return;
    }
    for (const intent of intents) {
      const row = document.createElement("tr");

      const idCell = document.createElement("td");
      idCell.textContent = `#${intent.id}`;
      row.appendChild(idCell);

      const investorCell = document.createElement("td");
      investorCell.textContent = nameFor(state.investors, intent.investor_id);
      row.appendChild(investorCell);

      const poolCell = document.createElement("td");
      poolCell.textContent = nameFor(state.pools, intent.pool_id);
      row.appendChild(poolCell);

      const amountCell = document.createElement("td");
      amountCell.className = "nowrap";
      amountCell.textContent = `${dropsToXrp(intent.amount_drops)} XRP`;
      amountCell.title = `${intent.amount_drops} drops`;
      row.appendChild(amountCell);

      const statusCell = document.createElement("td");
      const statusSpan = document.createElement("span");
      statusSpan.className = intent.status === "funded" ? "approved" : "pending_verification";
      statusSpan.textContent = intent.status;
      statusCell.appendChild(statusSpan);
      row.appendChild(statusCell);

      row.appendChild(buildDepositCell(intent));
      body.appendChild(row);
    }
  }

  async function refreshStatus() {
    const dot = document.getElementById("xrpl-dot");
    const text = document.getElementById("xrpl-indicator-text");
    try {
      const info = await api("GET", "/api/xrpl/status");
      document.getElementById("stat-network").textContent = info.network;
      document.getElementById("stat-state").textContent = info.server_state || "unknown";
      document.getElementById("stat-ledger").textContent = info.validated_ledger ?? "—";
      text.textContent = "Devnet reachable";
      dot.style.background = "var(--accent)";
    } catch (error) {
      document.getElementById("stat-network").textContent = "devnet";
      document.getElementById("stat-state").textContent = "unavailable";
      document.getElementById("stat-ledger").textContent = "—";
      text.textContent = "Devnet unreachable";
      dot.style.background = "var(--danger)";
    }
  }

  function wireForm(formId, statusId, path, buildBody, onSuccess) {
    const form = document.getElementById(formId);
    const status = document.getElementById(statusId);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitButton = form.querySelector("button");
      submitButton.disabled = true;
      setStatus(status, "", false);
      try {
        const body = buildBody(new FormData(form));
        const result = await api("POST", path, body);
        setStatus(status, "Saved.", false);
        form.reset();
        await onSuccess(result);
      } catch (error) {
        setStatus(status, error.message, true);
      } finally {
        submitButton.disabled = false;
      }
    });
  }

  async function init() {
    wireForm("investor-form", "investor-status", "/api/investors", (form) => ({
      name: form.get("name"),
      xrpl_address: form.get("xrpl_address"),
    }), refreshInvestorsAndPools);

    wireForm("pool-form", "pool-status", "/api/pools", (form) => ({
      name: form.get("name"),
      xrpl_address: form.get("xrpl_address"),
    }), refreshInvestorsAndPools);

    wireForm("intent-form", "intent-status", "/api/contribution-intents", (form) => ({
      investor_id: Number(form.get("investor_id")),
      pool_id: Number(form.get("pool_id")),
      amount_drops: xrpToDrops(form.get("amount_xrp")),
    }), refreshIntents);

    document.getElementById("refresh").addEventListener("click", () => {
      refreshIntents().catch((error) => setStatus(document.getElementById("global-status"), error.message, true));
    });

    await Promise.all([refreshStatus(), refreshInvestorsAndPools()]);
    await refreshIntents();
  }

  document.addEventListener("DOMContentLoaded", () => {
    init().catch((error) => setStatus(document.getElementById("global-status"), error.message, true));
  });
})();
