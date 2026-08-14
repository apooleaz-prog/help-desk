const API = `${import.meta.env.VITE_API_URL || ""}/api`;
const TOKEN_KEY = "deskline_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
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
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));

  if (res.status === 401 && path !== "/auth/login") {
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

export function fetchTickets({
  status = "all",
  q = "",
  companyId = "",
  priority = "",
} = {}) {
  const params = new URLSearchParams();
  if (status && status !== "all") params.set("status", status);
  if (q) params.set("q", q);
  if (companyId) params.set("companyId", companyId);
  if (priority && priority !== "all") params.set("priority", priority);
  const qs = params.toString();
  return request(`/tickets${qs ? `?${qs}` : ""}`);
}

export function fetchTicket(id) {
  return request(`/tickets/${id}`);
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

export function addComment(id, payload) {
  return request(`/tickets/${id}/comments`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
