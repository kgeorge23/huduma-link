const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = { token: localStorage.getItem("huduma_token"), user: null, requests: [], analytics: null, authMode: "login" };
const statusClass = (status) => status === "Resolved" ? "status-resolved" : status === "In Progress" ? "status-progress" : "status-pending";
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const prettyDate = (value) => {
  if (!value) return "—";
  const d = new Date(value.replace(" ", "T") + (value.includes("Z") ? "" : "Z"));
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};
async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (options.body && !(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const response = await fetch(url, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.token) signOut(false);
    throw new Error(payload.error || "Something went wrong. Please try again.");
  }
  return payload;
}
function toast(message, type = "success") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  $("#toast-region").append(el);
  setTimeout(() => el.remove(), 4200);
}
function openModal(id) { $("#" + id).hidden = false; document.body.style.overflow = "hidden"; }
function closeModal(id) { $("#" + id).hidden = true; if ($$(".modal-backdrop:not([hidden])").length === 0) document.body.style.overflow = ""; }
function setAuthMode(mode) {
  state.authMode = mode;
  const registering = mode === "register";
  $("#auth-title").textContent = registering ? "Create your account." : "Welcome back.";
  $("#auth-subtitle").textContent = registering ? "Join your community in making local services better." : "Sign in to manage your service requests.";
  $("#auth-eyebrow").textContent = registering ? "GET STARTED WITH HUDUMALINK" : "WELCOME TO HUDUMALINK";
  $("#name-field").hidden = !registering;
  $("#name-field").querySelector("input").required = registering;
  $("#auth-submit").innerHTML = registering ? "Create account <span>→</span>" : "Sign in <span>→</span>";
  $("#auth-form").elements.password.autocomplete = registering ? "new-password" : "current-password";
  $$(".auth-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.authMode === mode));
}
function showAuth(mode = "login") { setAuthMode(mode); openModal("auth-modal"); }
function signOut(showMessage = true) {
  state.token = null; state.user = null; state.requests = []; state.analytics = null;
  localStorage.removeItem("huduma_token");
  renderShell();
  if (showMessage) toast("You have signed out.");
}
function renderShell() {
  const loggedIn = !!state.user;
  $("#nav-actions").hidden = loggedIn;
  $("#user-actions").hidden = !loggedIn;
  $("#user-name").textContent = loggedIn ? `Hi, ${state.user.name.split(" ")[0]}` : "";
  $("#nav-my-requests").hidden = !loggedIn || state.user.role === "admin";
  $("#my-requests").hidden = !loggedIn || state.user.role === "admin";
  $("#admin-section").hidden = !loggedIn || state.user.role !== "admin";
  $("#report-hero").textContent = loggedIn ? "Report an issue ↗" : "Get started ↗";
  $("#report-bottom").textContent = loggedIn ? "Submit a service request ↗" : "Create an account ↗";
  if (loggedIn) loadRequests().catch((e) => toast(e.message, "error"));
}
async function refreshSession() {
  if (!state.token) { renderShell(); return; }
  try {
    const data = await api("/api/me");
    state.user = data.user;
    renderShell();
  } catch {
    state.token = null; state.user = null; localStorage.removeItem("huduma_token"); renderShell();
  }
}
function requestTitle(item) {
  const snippets = { "Roads & Streetlights": "Road or streetlight issue", "Water & Sanitation": "Water and sanitation issue", "Garbage Collection": "Garbage collection issue", "Public Safety": "Public safety concern", "Licensing & Documents": "Licensing or document enquiry", Other: "Other service request" };
  return snippets[item.category] || item.category;
}
function renderRequests() {
  const list = $("#request-list");
  if (!list) return;
  const search = ($("#request-search").value || "").toLowerCase();
  const filter = $("#status-filter").value;
  const items = state.requests.filter((r) => (filter === "all" || r.status === filter) && [r.category, r.location, r.description, `#${r.id}`].join(" ").toLowerCase().includes(search));
  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><strong>${state.requests.length ? "No matching requests" : "Nothing reported yet"}</strong>${state.requests.length ? "Try changing your search or status filter." : "When you submit a service request, it will appear here."}<br><br><button class="btn btn-primary" id="empty-new-request">+ Submit a request</button></div>`;
    $("#empty-new-request")?.addEventListener("click", openRequestModal);
    return;
  }
  list.innerHTML = items.map((r) => `<article class="request-item"><div><span class="request-id">REQUEST #${r.id} · ${escapeHtml(r.category.toUpperCase())}</span><h3>${escapeHtml(requestTitle(r))}</h3><p>${escapeHtml(r.description)}</p><div class="request-meta"><span>⌖ ${escapeHtml(r.location)}</span><span>Submitted ${escapeHtml(prettyDate(r.createdAt))}</span>${r.adminNote ? `<span>Admin update: ${escapeHtml(r.adminNote)}</span>` : ""}</div>${r.imageUrl ? `<p><a class="text-link" target="_blank" rel="noopener" href="${encodeURI(r.imageUrl)}">View attached image ↗</a></p>` : ""}</div><div class="request-item-right"><span class="status-pill ${statusClass(r.status)}">${escapeHtml(r.status)}</span><span class="request-meta">Updated ${escapeHtml(prettyDate(r.updatedAt))}</span></div></article>`).join("");
}
async function loadRequests() {
  if (!state.user) return;
  const data = await api("/api/requests");
  state.requests = data.requests;
  if (state.user.role === "admin") await loadAnalytics();
  else renderRequests();
}
function renderAdminTable() {
  const search = ($("#admin-search").value || "").toLowerCase();
  const items = state.requests.filter((r) => [r.category, r.location, r.description, r.citizenName, r.citizenEmail, `#${r.id}`].join(" ").toLowerCase().includes(search));
  $("#admin-table").innerHTML = items.length ? items.map((r) => `<tr><td><span class="table-request">#${r.id} · ${escapeHtml(r.category)}</span><span class="table-sub">${escapeHtml(r.location)}</span></td><td><span class="table-request">${escapeHtml(r.citizenName)}</span><span class="table-sub">${escapeHtml(r.citizenEmail)}</span></td><td><span class="table-status ${statusClass(r.status)}">${escapeHtml(r.status)}</span></td><td>${escapeHtml(prettyDate(r.createdAt))}</td><td><button class="table-action" data-manage="${r.id}">Manage →</button></td></tr>`).join("") : `<tr><td colspan="5"><div class="empty-state">No requests match this search.</div></td></tr>`;
  $$("[data-manage]").forEach((button) => button.addEventListener("click", () => manageRequest(Number(button.dataset.manage))));
}
async function loadAnalytics() {
  const data = await api("/api/analytics");
  state.analytics = data;
  const metricData = [
    ["Total requests", data.totals.total, "All citizen reports", "↗", "icon-blue"],
    ["Pending", data.totals.pending, "Awaiting review", "◷", "icon-orange"],
    ["In progress", data.totals.inProgress, "Being addressed", "↻", "icon-cyan"],
    ["Resolved", data.totals.resolved, "Marked complete", "✓", "icon-green"]
  ];
  $("#metrics").innerHTML = metricData.map(([label, value, foot, icon, cls]) => `<div class="metric-card"><div class="metric-top">${label}<span class="metric-icon ${cls}">${icon}</span></div><div class="metric-value">${value}</div><div class="metric-foot">${foot}</div></div>`).join("");
  const max = Math.max(1, ...data.categories.map((c) => c.count));
  $("#category-bars").innerHTML = data.categories.length ? data.categories.map((c) => `<div class="category-row"><div class="category-label"><span>${escapeHtml(c.category)}</span><strong>${c.count}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, c.count / max * 100)}%"></div></div></div>`).join("") : `<div class="empty-state">Category statistics will appear once requests are submitted.</div>`;
  renderAdminTable();
}
async function manageRequest(id) {
  const item = state.requests.find((r) => r.id === id);
  if (!item) return;
  const nextStatus = prompt(`Manage request #${id}\nCurrent status: ${item.status}\n\nEnter status exactly as:\nPending\nIn Progress\nResolved`, item.status);
  if (nextStatus === null) return;
  const status = nextStatus.trim();
  if (!["Pending", "In Progress", "Resolved"].includes(status)) return toast("Choose Pending, In Progress, or Resolved.", "error");
  const adminNote = prompt("Optional update for the citizen (leave blank to clear):", item.adminNote || "");
  if (adminNote === null) return;
  try {
    await api(`/api/requests/${id}/status`, { method: "PATCH", body: JSON.stringify({ status, adminNote }) });
    await loadRequests();
    toast(`Request #${id} updated to ${status}.`);
  } catch (e) { toast(e.message, "error"); }
}
function openRequestModal(category = "") {
  if (!state.user) return showAuth("login");
  if (state.user.role === "admin") return toast("Sign in with a citizen account to submit a request.", "error");
  $("#request-form").reset();
  $("#file-preview").hidden = true;
  $("#request-category").value = category;
  openModal("request-modal");
}
async function handleAuth(event) {
  event.preventDefault();
    const formEl = event.currentTarget;
  const form = new FormData(formEl);
  const body = Object.fromEntries(form.entries());
  const mode = state.authMode;
  $("#auth-submit").disabled = true;
  $("#auth-submit").textContent = mode === "register" ? "Creating account…" : "Signing in…";
  try {
    const data = await api(`/api/auth/${mode === "register" ? "register" : "login"}`, { method: "POST", body: JSON.stringify(body) });
    state.token = data.token; state.user = data.user; localStorage.setItem("huduma_token", data.token);
        closeModal("auth-modal"); formEl.reset(); renderShell();
    toast(mode === "register" ? "Your account is ready. Welcome to HudumaLink!" : `Welcome back, ${data.user.name.split(" ")[0]}.`);
    if (data.user.role === "admin") $("#admin-section").scrollIntoView({ behavior: "smooth" });
    else if (mode === "register") openRequestModal();
  } catch (e) { toast(e.message, "error"); }
  finally { $("#auth-submit").disabled = false; setAuthMode(state.authMode); }
}
async function handleRequest(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const file = form.elements.image.files[0];
  if (file && file.size > 5 * 1024 * 1024) return toast("Image must be 5 MB or smaller.", "error");
  const data = new FormData(form);
  $("#request-submit").disabled = true; $("#request-submit").textContent = "Submitting…";
  try {
    const result = await api("/api/requests", { method: "POST", body: data });
    closeModal("request-modal"); form.reset(); $("#file-preview").hidden = true;
    toast(result.message || "Request submitted successfully.");
    await loadRequests();
    $("#my-requests").scrollIntoView({ behavior: "smooth" });
  } catch (e) { toast(e.message, "error"); }
  finally { $("#request-submit").disabled = false; $("#request-submit").innerHTML = 'Submit request <span>→</span>'; }
}
$("#login-open").addEventListener("click", () => showAuth("login"));
$("#register-open").addEventListener("click", () => showAuth("register"));
$("#logout").addEventListener("click", () => signOut());
$("#report-hero").addEventListener("click", () => state.user ? openRequestModal() : showAuth("register"));
$("#report-bottom").addEventListener("click", () => state.user ? openRequestModal() : showAuth("register"));
$("#new-request").addEventListener("click", () => openRequestModal());
$$(".service-card").forEach((card) => card.addEventListener("click", () => openRequestModal(card.dataset.category)));
$$("[data-close]").forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.close)));
$$(".modal-backdrop").forEach((backdrop) => backdrop.addEventListener("click", (event) => { if (event.target === backdrop) closeModal(backdrop.id); }));
$$("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));
$("#auth-form").addEventListener("submit", handleAuth);
$("#request-form").addEventListener("submit", handleRequest);
$("#request-search").addEventListener("input", renderRequests);
$("#status-filter").addEventListener("change", renderRequests);
$("#admin-search").addEventListener("input", renderAdminTable);
$("#image-input").addEventListener("change", (event) => {
  const file = event.target.files[0];
  const preview = $("#file-preview");
  if (!file) { preview.hidden = true; return; }
  preview.textContent = `Selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
  preview.hidden = false;
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape") $$(".modal-backdrop:not([hidden])").forEach((modal) => closeModal(modal.id)); });
$("#year").textContent = new Date().getFullYear();
setAuthMode("login");
refreshSession();
