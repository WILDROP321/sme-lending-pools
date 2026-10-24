"use strict";
const byId = (id) => document.getElementById(id);
const element = (tag, text, className = "") => {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
};
function message(id, text, kind = "") {
  const node = byId(id);
  node.textContent = text;
  node.className = kind;
}
async function api(path, options) {
  let response;
  try { response = await fetch(path, options); }
  catch { throw new Error("Cannot reach the local server. Check the connection and retry."); }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Request failed (${response.status}).`);
  return data;
}
let selectionVersion = 0;
let selectedPool = null;
let submitting = false;
function lockForm() {
  byId("request-fields").disabled = !selectedPool || submitting;
}
async function selectPool(id) {
  const version = ++selectionVersion;
  selectedPool = null;
  lockForm();
  byId("pool-id").value = id;
  document.querySelectorAll(".pool-choice").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.id === String(id)));
  });
  byId("pool-detail").replaceChildren(element("p", id ? "Loading pool details…" : "Select a pool to see its details."));
  if (!id) return;
  try {
    const { pool } = await api(`/api/pools/${encodeURIComponent(id)}`);
    if (version !== selectionVersion) return;
    selectedPool = pool;
    byId("pool-detail").replaceChildren(
      element("h3", pool.name),
      element("p", pool.description || "No description provided."),
      element("p", `Pool #${pool.id} · ${pool.currency} · ${pool.status} · Local record`, "meta")
    );
  } catch (error) {
    if (version === selectionVersion) byId("pool-detail").replaceChildren(element("p", `${error.message} Select the pool again to retry.`, "error"));
  } finally { if (version === selectionVersion) lockForm(); }
}
async function loadPools() {
  const button = byId("refresh-pools");
  button.disabled = true;
  const previous = selectedPool?.id;
  ++selectionVersion;
  selectedPool = null;
  lockForm();
  message("pools-message", "Loading pools…");
  byId("pools").replaceChildren();
  byId("pool-id").replaceChildren(new Option("Choose a pool", ""));
  byId("pool-detail").replaceChildren();
  try {
    const { pools } = await api("/api/pools");
    for (const pool of pools) {
      const choice = element("button", `${pool.name} · ${pool.status}`, "pool-choice");
      choice.type = "button";
      choice.dataset.id = pool.id;
      choice.setAttribute("aria-pressed", "false");
      choice.addEventListener("click", () => selectPool(pool.id));
      byId("pools").append(choice);
      byId("pool-id").append(new Option(pool.name, pool.id));
    }
    message("pools-message", pools.length ? `${pools.length} local pool(s) available.` : "No pools yet. Run the README seed-demo command, then refresh.");
    await selectPool(pools.find((pool) => pool.id === previous)?.id || pools[0]?.id || "");
  } catch (error) { message("pools-message", `${error.message} Use Refresh to retry.`, "error"); }
  finally { button.disabled = false; }
}
async function loadRequests() {
  byId("refresh-requests").disabled = true;
  message("requests-message", "Loading requests…");
  byId("requests").replaceChildren();
  try {
    const { funding_requests: requests } = await api("/api/funding-requests");
    for (const request of [...requests].reverse()) {
      const card = element("article", "", "request-card");
      card.append(
        element("h3", request.business_name),
        element("p", `${Number(request.amount_drops) / 1000000} XRP requested`),
        element("p", `Expected payment: ${request.expected_payment_date}`),
        element("p", `Request #${request.id} · Pool #${request.pool_id} · ${request.status}`, "meta")
      );
      byId("requests").append(card);
    }
    message("requests-message", requests.length ? `${requests.length} request(s) in this local demo.` : "No requests yet. Submit your first funding request above.");
  } catch (error) { message("requests-message", `${error.message} Use Refresh to retry.`, "error"); }
  finally { byId("refresh-requests").disabled = false; }
}
byId("pool-id").addEventListener("change", (event) => selectPool(event.target.value));
byId("refresh-pools").addEventListener("click", loadPools);
byId("refresh-requests").addEventListener("click", loadRequests);
byId("funding-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submitting || !selectedPool) return;
  const name = byId("business-name").value.trim();
  const amount = byId("amount").value;
  if (!name) { message("form-message", "Enter a business name.", "error"); byId("business-name").focus(); return; }
  if (!/^\d+(\.\d{1,6})?$/.test(amount)) { message("form-message", "Enter a positive XRP amount with up to 6 decimal places.", "error"); return; }
  const [whole, fraction = ""] = amount.split(".");
  const drops = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
  // JSON numbers must remain exact in the browser, even though SQLite supports larger integers.
  if (drops <= 0n || drops > BigInt(Number.MAX_SAFE_INTEGER)) {
    message("form-message", "Amount must be greater than zero and at most 9007199254.740991 XRP.", "error"); return;
  }
  submitting = true;
  lockForm();
  byId("refresh-pools").disabled = true;
  document.querySelectorAll(".pool-choice").forEach((button) => { button.disabled = true; });
  message("form-message", "Submitting request…");
  try {
    const { funding_request: request } = await api("/api/funding-requests", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pool_id: selectedPool.id, business_name: name, amount_drops: Number(drops), expected_payment_date: byId("payment-date").value })
    });
    byId("business-name").value = "";
    byId("amount").value = "";
    byId("payment-date").value = "";
    message("form-message", `Request #${request.id} submitted. Awaiting review; no funds transferred.`, "success");
    await loadRequests();
  } catch (error) { message("form-message", `${error.message} Your entries have been kept. If the connection failed, refresh submitted requests before retrying to avoid duplicates.`, "error"); }
  finally {
    submitting = false;
    lockForm();
    byId("refresh-pools").disabled = false;
    document.querySelectorAll(".pool-choice").forEach((button) => { button.disabled = false; });
  }
});
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
byId("payment-date").min = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
loadPools();
loadRequests();
