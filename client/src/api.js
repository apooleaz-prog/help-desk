const API = `${import.meta.env.VITE_API_URL || ""}/api`;
export const TOKEN_KEY = "deskline_token";

function migrateLocalStorageToken() {
  const leftover = localStorage.getItem(TOKEN_KEY);
  if (!leftover) return null;
  sessionStorage.setItem(TOKEN_KEY, leftover);
  localStorage.removeItem(TOKEN_KEY);
  return leftover;
}

export function getToken() {
  const sessionToken = sessionStorage.getItem(TOKEN_KEY);
  if (sessionToken) return sessionToken;
  return migrateLocalStorageToken();
}

export function setToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
  localStorage.removeItem(TOKEN_KEY);
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
}

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthError";
  }
}

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API}${path}`, {
    cache: "no-store",
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));

  const requestPath = path.split("?")[0];
  const publicAuthPaths = new Set([
    "/auth/login",
    "/auth/forgot-password",
    "/auth/reset-password",
  ]);
  if (res.status === 401 && !publicAuthPaths.has(requestPath)) {
    clearToken();
    throw new AuthError(data.error || "Authentication required");
  }

  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }

  return data;
}

export function login(email, password) {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function requestPasswordReset(email) {
  return request("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function fetchResetPassword(token) {
  return request(`/auth/reset-password?token=${encodeURIComponent(token)}`);
}

export function resetPassword(token, password) {
  return request("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

export function logout() {
  return request("/auth/logout", { method: "POST" });
}

export function fetchMe() {
  return request("/auth/me");
}

export function fetchAgents() {
  return request("/agents");
}

export function createAgent(payload) {
  return request("/agents", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateAgent(id, payload) {
  return request(`/agents/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteAgent(id) {
  return request(`/agents/${id}`, { method: "DELETE" });
}

export function fetchManufacturers() {
  return request("/manufacturers");
}

export function createManufacturer(payload) {
  return request("/manufacturers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateManufacturer(id, payload) {
  return request(`/manufacturers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteManufacturer(id) {
  return request(`/manufacturers/${id}`, { method: "DELETE" });
}

export function fetchAssetTypes() {
  return request("/asset-types");
}

export function createAssetType(payload) {
  return request("/asset-types", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateAssetType(id, payload) {
  return request(`/asset-types/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteAssetType(id) {
  return request(`/asset-types/${id}`, { method: "DELETE" });
}

export function fetchStockImage(query, { skip = 0 } = {}) {
  const params = new URLSearchParams({ q: query });
  if (skip > 0) params.set("skip", String(skip));
  return request(`/stock-image?${params}`);
}

export function fetchCompanies() {
  return request("/companies");
}

export function createCompany(payload) {
  return request("/companies", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateCompany(id, payload) {
  return request(`/companies/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteCompany(id) {
  return request(`/companies/${id}`, { method: "DELETE" });
}

export function addPerson(companyId, payload) {
  return request(`/companies/${companyId}/people`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updatePerson(companyId, personId, payload) {
  return request(`/companies/${companyId}/people/${personId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deletePerson(companyId, personId) {
  return request(`/companies/${companyId}/people/${personId}`, {
    method: "DELETE",
  });
}

export function fetchCompanyAssets(companyId) {
  return request(`/companies/${companyId}/assets`);
}

export function createCompanyAsset(companyId, payload) {
  return request(`/companies/${companyId}/assets`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateCompanyAsset(companyId, assetId, payload) {
  return request(`/companies/${companyId}/assets/${assetId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteCompanyAsset(companyId, assetId) {
  return request(`/companies/${companyId}/assets/${assetId}`, {
    method: "DELETE",
  });
}

export function fetchCompanyLocations(companyId) {
  return request(`/companies/${companyId}/locations`);
}

export function createCompanyLocation(companyId, payload) {
  return request(`/companies/${companyId}/locations`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateCompanyLocation(companyId, locationId, payload) {
  return request(`/companies/${companyId}/locations/${locationId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteCompanyLocation(companyId, locationId) {
  return request(`/companies/${companyId}/locations/${locationId}`, {
    method: "DELETE",
  });
}

export function fetchTickets({
  status = "all",
  q = "",
  companyId = "",
  priority = "",
  mine,
} = {}) {
  const params = new URLSearchParams();
  const statuses = Array.isArray(status)
    ? status
    : String(status || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
  if (statuses.length && !statuses.includes("all")) {
    params.set("status", statuses.join(","));
  }
  if (q) params.set("q", q);
  if (companyId) params.set("companyId", companyId);
  const priorities = Array.isArray(priority)
    ? priority
    : String(priority || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
  if (priorities.length && !priorities.includes("all")) {
    params.set("priority", priorities.join(","));
  }
  if (mine === true || mine === 1 || mine === "1") params.set("mine", "1");
  else if (mine === false || mine === 0 || mine === "0") params.set("mine", "0");
  const qs = params.toString();
  return request(`/tickets${qs ? `?${qs}` : ""}`);
}

export function fetchTicket(id) {
  return request(`/tickets/${id}`);
}

export function fetchTicketAssets(ticketId) {
  return request(`/tickets/${ticketId}/assets`);
}

export function createTicket(payload) {
  return request("/tickets", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateTicket(id, payload) {
  return request(`/tickets/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteTicket(id) {
  return request(`/tickets/${id}`, { method: "DELETE" });
}

export function addComment(id, payload) {
  return request(`/tickets/${id}/comments`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchActivityLogs({
  userId = "",
  role = "",
  action = "",
  limit = 200,
  before = "",
} = {}) {
  const params = new URLSearchParams();
  if (userId) params.set("userId", userId);
  if (role) params.set("role", role);
  if (action) params.set("action", action);
  if (limit) params.set("limit", String(limit));
  if (before) params.set("before", before);
  const qs = params.toString();
  return request(`/activity-log${qs ? `?${qs}` : ""}`);
}

export function fetchActivityLogUsers() {
  return request("/activity-log/users");
}

export function clearActivityLogs() {
  return request("/activity-log", { method: "DELETE" });
}

export function fetchAlerts() {
  return request("/alerts");
}

export function dismissAlert(id) {
  return request(`/alerts/${id}/dismiss`, { method: "POST" });
}

export function fetchCalendarSlots(from, to) {
  const params = new URLSearchParams({ from, to });
  return request(`/calendar?${params}`);
}

export function updateCalendarSlot(payload) {
  return request("/calendar", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}
