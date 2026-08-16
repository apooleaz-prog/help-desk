import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AuthError,
  addComment,
  addPerson,
  clearToken,
  createAgent,
  createAssetType,
  createCompany,
  createCompanyAsset,
  createManufacturer,
  createTicket,
  deleteAgent,
  deleteAssetType,
  deleteCompany,
  deleteCompanyAsset,
  deleteManufacturer,
  deletePerson,
  fetchAgents,
  fetchAssetTypes,
  fetchCompanies,
  fetchCompanyAssets,
  fetchManufacturers,
  fetchMe,
  fetchStockImage,
  fetchTicket,
  fetchTickets,
  getToken,
  login,
  logout,
  setToken,
  updateAgent,
  updateAssetType,
  updateCompany,
  updateCompanyAsset,
  updateManufacturer,
  updatePerson,
  updateTicket,
} from "./api";
import "./App.css";

const STATUSES = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

const PRIORITIES = ["low", "medium", "high", "urgent"];

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function labelStatus(status) {
  return status.replace("_", " ");
}

function useCollapseMiddles(ref, deps = []) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;

    const apply = () => {
      const scopes = root.hasAttribute("data-collapse-scope")
        ? [root]
        : [...root.querySelectorAll("[data-collapse-scope]")];
      if (scopes.length === 0) scopes.push(root);

      for (const scope of scopes) {
        const mids = [...scope.querySelectorAll("[data-mid]")];
        for (const el of mids) el.classList.remove("is-mid-hidden");
        const ranks = [
          ...new Set(mids.map((el) => Number(el.dataset.mid) || 0)),
        ].sort((a, b) => b - a);
        for (const rank of ranks) {
          if (scope.scrollWidth <= scope.clientWidth + 1) break;
          for (const el of mids) {
            if (Number(el.dataset.mid) === rank) {
              el.classList.add("is-mid-hidden");
            }
          }
        }
      }
    };

    const frame = requestAnimationFrame(apply);
    const ro = new ResizeObserver(() => apply());
    ro.observe(root);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, deps);
}

function App() {
  const [role, setRole] = useState(null);
  const [agent, setAgent] = useState(null);
  const [person, setPerson] = useState(null);
  const [authChecking, setAuthChecking] = useState(Boolean(getToken()));
  const [view, setView] = useState("list");
  const [tickets, setTickets] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [agents, setAgents] = useState([]);
  const [manufacturers, setManufacturers] = useState([]);
  const [assetTypes, setAssetTypes] = useState([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selected, setSelected] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [companyFilter, setCompanyFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [openByPriority, setOpenByPriority] = useState({
    low: 0,
    medium: 0,
    high: 0,
    urgent: 0,
  });

  const isPerson = role === "person";
  const isAgent = role === "agent";
  const signedIn = Boolean(agent || person);
  const displayUser = isPerson ? person : agent;

  function clearSessionState() {
    setRole(null);
    setAgent(null);
    setPerson(null);
    setView("list");
    setSelected(null);
    setShowAdvanced(false);
  }

  function handleAuthFailure(err) {
    if (err instanceof AuthError) {
      clearSessionState();
      setError("Session expired. Please sign in again.");
      return true;
    }
    return false;
  }

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setAuthChecking(false);
      return;
    }

    fetchMe()
      .then((data) => {
        if (data.role === "person") {
          setRole("person");
          setPerson(data.person);
          setAgent(null);
        } else {
          setRole("agent");
          setAgent(data.agent);
          setPerson(null);
        }
      })
      .catch(() => {
        clearToken();
        clearSessionState();
      })
      .finally(() => setAuthChecking(false));
  }, []);

  const loadCompanies = useCallback(async () => {
    const data = await fetchCompanies();
    setCompanies(data);
    return data;
  }, []);

  const loadAgents = useCallback(async () => {
    const data = await fetchAgents();
    setAgents(data);
    return data;
  }, []);

  const loadManufacturers = useCallback(async () => {
    const data = await fetchManufacturers();
    setManufacturers(data);
    return data;
  }, []);

  const loadAssetTypes = useCallback(async () => {
    const data = await fetchAssetTypes();
    setAssetTypes(data);
    return data;
  }, []);

  useEffect(() => {
    if (!isAgent) return;
    loadCompanies().catch((err) => {
      if (!handleAuthFailure(err)) setError(err.message);
    });
  }, [isAgent, loadCompanies]);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const ticketQuery = {
        status: statusFilter,
        q: query,
        priority: priorityFilter,
      };
      if (!isPerson) {
        ticketQuery.companyId = companyFilter;
      }
      const [data, openTickets] = await Promise.all([
        fetchTickets(ticketQuery),
        fetchTickets({ status: "open" }),
      ]);
      setTickets(data);
      const counts = { low: 0, medium: 0, high: 0, urgent: 0 };
      for (const ticket of openTickets) {
        if (counts[ticket.priority] !== undefined) {
          counts[ticket.priority] += 1;
        }
      }
      setOpenByPriority(counts);
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, query, companyFilter, priorityFilter, isPerson]);

  useEffect(() => {
    if (signedIn && view === "list") {
      loadTickets();
    }
  }, [signedIn, view, loadTickets]);

  useEffect(() => {
    if (isAgent && view === "agents") {
      loadAgents().catch((err) => {
        if (!handleAuthFailure(err)) setError(err.message);
      });
    }
  }, [isAgent, view, loadAgents]);

  useEffect(() => {
    if (isAgent && (view === "manufacturers" || view === "companies")) {
      loadManufacturers().catch((err) => {
        if (!handleAuthFailure(err)) setError(err.message);
      });
    }
  }, [isAgent, view, loadManufacturers]);

  useEffect(() => {
    if (isAgent && (view === "assetTypes" || view === "companies")) {
      loadAssetTypes().catch((err) => {
        if (!handleAuthFailure(err)) setError(err.message);
      });
    }
  }, [isAgent, view, loadAssetTypes]);

  async function handleLogin({ email, password }) {
    setSaving(true);
    setError("");
    try {
      const data = await login(email, password);
      setToken(data.token);
      if (data.role === "person") {
        setRole("person");
        setPerson(data.person);
        setAgent(null);
      } else {
        setRole("agent");
        setAgent(data.agent);
        setPerson(null);
      }
      setView("list");
      setShowAdvanced(false);
      setCompanyFilter("");
      setPriorityFilter("");
      setStatusFilter("all");
      setQuery("");
      if (window.PasswordCredential && navigator.credentials?.store) {
        navigator.credentials
          .store(new PasswordCredential({ id: email, password }))
          .catch(() => {});
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // clear local session regardless
    }
    clearToken();
    clearSessionState();
    setError("");
  }

  async function openTicket(id) {
    setError("");
    setLoading(true);
    try {
      const ticket = await fetchTicket(id);
      setSelected(ticket);
      setView("detail");
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(payload) {
    setSaving(true);
    setError("");
    try {
      const ticket = await createTicket(payload);
      setSelected(ticket);
      setView("detail");
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(status) {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      const updated = await updateTicket(selected.id, { status });
      setSelected(updated);
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handlePriorityChange(priority) {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      const updated = await updateTicket(selected.id, { priority });
      setSelected(updated);
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleComment(payload) {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      await addComment(selected.id, payload);
      const refreshed = await fetchTicket(selected.id);
      setSelected(refreshed);
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateCompany(payload) {
    setSaving(true);
    setError("");
    try {
      await createCompany(payload);
      await loadCompanies();
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCompany(companyId) {
    setSaving(true);
    setError("");
    try {
      await deleteCompany(companyId);
      if (companyFilter === companyId) {
        setCompanyFilter("");
      }
      await loadCompanies();
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateCompany(companyId, payload) {
    setSaving(true);
    setError("");
    try {
      await updateCompany(companyId, payload);
      await loadCompanies();
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleAddPerson(companyId, payload) {
    setSaving(true);
    setError("");
    try {
      await addPerson(companyId, payload);
      await loadCompanies();
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdatePerson(companyId, personId, payload) {
    setSaving(true);
    setError("");
    try {
      await updatePerson(companyId, personId, payload);
      await loadCompanies();
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePerson(companyId, personId) {
    setSaving(true);
    setError("");
    try {
      await deletePerson(companyId, personId);
      await loadCompanies();
      await loadTickets();
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateCompanyAsset(companyId, payload) {
    setSaving(true);
    setError("");
    try {
      return await createCompanyAsset(companyId, payload);
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateCompanyAsset(companyId, assetId, payload) {
    setSaving(true);
    setError("");
    try {
      return await updateCompanyAsset(companyId, assetId, payload);
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCompanyAsset(companyId, assetId) {
    setSaving(true);
    setError("");
    try {
      await deleteCompanyAsset(companyId, assetId);
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateAgent(payload) {
    setSaving(true);
    setError("");
    try {
      await createAgent(payload);
      await loadAgents();
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateAgent(id, payload) {
    setSaving(true);
    setError("");
    try {
      const updated = await updateAgent(id, payload);
      await loadAgents();
      if (agent?.id === id) {
        setAgent(updated);
      }
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAgent(id) {
    setSaving(true);
    setError("");
    try {
      await deleteAgent(id);
      if (agent?.id === id) {
        clearToken();
        setAgent(null);
        return;
      }
      await loadAgents();
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateManufacturer(payload) {
    setSaving(true);
    setError("");
    try {
      await createManufacturer(payload);
      await loadManufacturers();
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateManufacturer(id, payload) {
    setSaving(true);
    setError("");
    try {
      await updateManufacturer(id, payload);
      await loadManufacturers();
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteManufacturer(id) {
    setSaving(true);
    setError("");
    try {
      await deleteManufacturer(id);
      await loadManufacturers();
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateAssetType(payload) {
    setSaving(true);
    setError("");
    try {
      await createAssetType(payload);
      await loadAssetTypes();
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateAssetType(id, payload) {
    setSaving(true);
    setError("");
    try {
      await updateAssetType(id, payload);
      await loadAssetTypes();
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAssetType(id) {
    setSaving(true);
    setError("");
    try {
      await deleteAssetType(id);
      await loadAssetTypes();
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  if (authChecking) {
    return (
      <div className="app">
        <p className="muted pad center">Checking session…</p>
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="app">
        <LoginView saving={saving} error={error} onLogin={handleLogin} />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="chrome">
        <div className="topbar">
        <div className="brand-block">
          <button
            type="button"
            className="brand"
            onClick={() => {
              setShowAdvanced(false);
              setView("list");
              setSelected(null);
            }}
          >
            <span className="brand-mark">HD</span>
            <span className="brand-copy">
              <span className="brand-name">Help Desk</span>
              <span
                className="agent-chip"
                title={
                  isPerson
                    ? [person.email, person.phone, person.companyName]
                        .filter(Boolean)
                        .join(" · ")
                    : [agent.email, agent.phone].filter(Boolean).join(" · ")
                }
              >
                ({displayUser.name})
              </span>
            </span>
          </button>
        </div>
        <nav className="top-actions">
          <button
            type="button"
            className="btn icon ghost icon-tickets"
            onClick={() => {
              setShowAdvanced(false);
              setView("list");
              setSelected(null);
              setStatusFilter("all");
              setCompanyFilter("");
              setPriorityFilter("");
              setQuery("");
            }}
            aria-label="Tickets"
            data-tooltip="Tickets"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                fill="#2563eb"
                d="M4.5 5.25A1.75 1.75 0 0 1 6.25 3.5h11.5A1.75 1.75 0 0 1 19.5 5.25v13.5A1.75 1.75 0 0 1 17.75 20.5H6.25A1.75 1.75 0 0 1 4.5 18.75V5.25Z"
              />
              <path
                fill="#dbeafe"
                d="M7.25 7h9.5a.75.75 0 0 1 0 1.5h-9.5a.75.75 0 0 1 0-1.5Zm0 3.25h9.5a.75.75 0 0 1 0 1.5h-9.5a.75.75 0 0 1 0-1.5Zm0 3.25h6.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5Z"
              />
              <path
                fill="#1d4ed8"
                d="M4.5 9.1c.9 0 1.65.75 1.65 1.65S5.4 12.4 4.5 12.4v-3.3Zm15 0V12.4c-.9 0-1.65-.75-1.65-1.65S18.6 9.1 19.5 9.1Z"
              />
            </svg>
          </button>
          {isAgent && (
            <button
              type="button"
              className={`btn icon ghost icon-advanced${showAdvanced ? " is-open" : ""}`}
              onClick={() => setShowAdvanced(true)}
              aria-label="Advanced"
              aria-pressed={showAdvanced}
              data-tooltip="Advanced"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  fill="#7c3aed"
                  d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96c-.5-.37-1.04-.68-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.59.26-1.13.57-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.8 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.92 14.16a.5.5 0 0 0-.12.64l1.92 3.32c.13.24.43.34.7.22l2.39-.96c.5.37 1.04.68 1.63.94l.36 2.54c.05.24.26.42.49.42h3.8c.24 0 .45-.18.5-.42l.36-2.54c.59-.26 1.13-.57 1.63-.94l2.39.96c.27.11.56.02.7-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
                />
                <circle cx="12" cy="12" r="2.05" fill="#ede9fe" />
              </svg>
            </button>
          )}
          <button
            type="button"
            className="btn icon ghost icon-logout"
            onClick={handleLogout}
            aria-label="Log out"
            data-tooltip="Log out"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                fill="#64748b"
                d="M10 4.5H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25H10a.75.75 0 0 1 0 1.5H6.75A3.75 3.75 0 0 1 3 17.25V6.75A3.75 3.75 0 0 1 6.75 3H10a.75.75 0 0 1 0 1.5Z"
              />
              <path
                fill="#e4572e"
                d="M15.53 8.47a.75.75 0 0 1 1.06 0l3 3a.75.75 0 0 1 0 1.06l-3 3a.75.75 0 1 1-1.06-1.06l1.72-1.72H10a.75.75 0 0 1 0-1.5h7.19l-1.66-1.72a.75.75 0 0 1 0-1.06Z"
              />
            </svg>
          </button>
        </nav>
        </div>
        {isAgent && showAdvanced && (
          <nav className="advanced-actions" aria-label="Advanced">
            <button
              type="button"
              className={`btn icon ghost icon-agents${view === "agents" ? " is-active" : ""}`}
              onClick={() => setView("agents")}
              aria-label="Agents"
              aria-pressed={view === "agents"}
              data-tooltip="Agents"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  fill="#0d9488"
                  d="M4.5 10.5a7.5 7.5 0 0 1 15 0V12a2 2 0 0 1-2 2h-1.25a.75.75 0 0 1-.75-.75v-3.5a.75.75 0 0 1 .75-.75H18a5.5 5.5 0 1 0-11 0h.75a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-.75.75H6.5A2 2 0 0 1 4.5 12v-1.5Z"
                />
                <path
                  fill="#2563eb"
                  d="M12 16.25a.75.75 0 0 1 .75.75v.5A2.75 2.75 0 0 1 10 20.25h-.5a.75.75 0 0 1 0-1.5H10a1.25 1.25 0 0 0 1.25-1.25v-.5a.75.75 0 0 1 .75-.75Z"
                />
                <circle cx="12" cy="12.25" r="1.35" fill="#115e59" />
              </svg>
            </button>
            <button
              type="button"
              className={`btn icon ghost icon-customers${view === "companies" ? " is-active" : ""}`}
              onClick={() => setView("companies")}
              aria-label="Customers"
              aria-pressed={view === "companies"}
              data-tooltip="Customers"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  fill="#ea580c"
                  d="M3.75 21a.75.75 0 0 1-.75-.75V9.68c0-.28.12-.54.34-.71l8-6.1a.75.75 0 0 1 .92 0l8 6.1c.22.17.34.43.34.71v10.57a.75.75 0 0 1-.75.75H14.5v-5.5a.75.75 0 0 0-.75-.75h-3.5a.75.75 0 0 0-.75.75V21H3.75Z"
                />
                <path
                  fill="#ffedd5"
                  d="M8.25 10.5h2v2h-2v-2Zm5.5 0h2v2h-2v-2Zm-5.5 3.5h2v2h-2v-2Zm5.5 0h2v2h-2v-2Z"
                />
                <path fill="#c2410c" d="M10.25 21v-4.75h3.5V21h-3.5Z" />
              </svg>
            </button>
            <button
              type="button"
              className={`btn icon ghost icon-manufacturers${view === "manufacturers" ? " is-active" : ""}`}
              onClick={() => setView("manufacturers")}
              aria-label="Manufacturers"
              aria-pressed={view === "manufacturers"}
              data-tooltip="Manufacturers"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  fill="#4f46e5"
                  d="M2.75 20.5V10.4l5.25 3.1V8.9l5.5 3.25V4.5h1.85v1.7h1.55V4.5h2.35v16H2.75Z"
                />
                <path
                  fill="#c7d2fe"
                  d="M5.4 15.35h2.1v2.35H5.4v-2.35Zm3.7 0h2.1v2.35H9.1v-2.35Zm3.7 0h2.1v2.35h-2.1v-2.35Z"
                />
                <path fill="#6366f1" d="M16.9 4.5h2.35v3.15H16.9V4.5Z" />
              </svg>
            </button>
            <button
              type="button"
              className={`btn icon ghost icon-asset-types${view === "assetTypes" ? " is-active" : ""}`}
              onClick={() => setView("assetTypes")}
              aria-label="Asset types"
              aria-pressed={view === "assetTypes"}
              data-tooltip="Asset types"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  fill="#0e7490"
                  d="M12 3.4 3.6 8.05 12 12.7l8.4-4.65L12 3.4Z"
                />
                <path
                  fill="#155e75"
                  d="M3.6 11.15 12 15.8l8.4-4.65v1.85L12 17.7 3.6 13Z"
                />
                <path
                  fill="#67e8f9"
                  d="M3.6 14.85 12 19.5l8.4-4.65v1.85L12 21.4 3.6 16.7Z"
                />
              </svg>
            </button>
          </nav>
        )}
      </header>

      <main className="main">
        {error && <div className="banner error">{error}</div>}

        {view === "list" && (
          <TicketList
            tickets={tickets}
            companies={companies}
            openByPriority={openByPriority}
            loading={loading}
            statusFilter={statusFilter}
            companyFilter={companyFilter}
            priorityFilter={priorityFilter}
            query={query}
            portalMode={isPerson}
            portalCompanyName={person?.companyName}
            onStatusFilter={(status) => {
              setPriorityFilter("");
              setStatusFilter(status);
            }}
            onCompanyFilter={setCompanyFilter}
            onPriorityFilter={(priority) => {
              if (priorityFilter === priority && statusFilter === "open") {
                setPriorityFilter("");
                setStatusFilter("all");
                return;
              }
              setPriorityFilter(priority);
              setStatusFilter("open");
            }}
            onQuery={setQuery}
            onOpen={openTicket}
            onCreate={() => setView("new")}
          />
        )}

        {isAgent && view === "companies" && (
          <CompaniesView
            companies={companies}
            manufacturers={manufacturers}
            assetTypes={assetTypes}
            saving={saving}
            onCreateCompany={handleCreateCompany}
            onUpdateCompany={handleUpdateCompany}
            onDeleteCompany={handleDeleteCompany}
            onAddPerson={handleAddPerson}
            onUpdatePerson={handleUpdatePerson}
            onDeletePerson={handleDeletePerson}
            onCreateAsset={handleCreateCompanyAsset}
            onUpdateAsset={handleUpdateCompanyAsset}
            onDeleteAsset={handleDeleteCompanyAsset}
          />
        )}

        {isAgent && view === "agents" && (
          <AgentsView
            agents={agents}
            currentAgentId={agent.id}
            saving={saving}
            onCreate={handleCreateAgent}
            onUpdate={handleUpdateAgent}
            onDelete={handleDeleteAgent}
          />
        )}

        {isAgent && view === "manufacturers" && (
          <CatalogView
            items={manufacturers}
            saving={saving}
            onCreate={handleCreateManufacturer}
            onUpdate={handleUpdateManufacturer}
            onDelete={handleDeleteManufacturer}
            title="Manufacturers"
            description="Vendors and equipment makers referenced in tickets."
            itemLabel="manufacturer"
            addLabel="Add manufacturer"
            emptyLabel="No manufacturers yet."
            namePlaceholder="Dell"
            detailsPlaceholder="Support contacts, contract notes…"
          />
        )}

        {isAgent && view === "assetTypes" && (
          <CatalogView
            items={assetTypes}
            saving={saving}
            onCreate={handleCreateAssetType}
            onUpdate={handleUpdateAssetType}
            onDelete={handleDeleteAssetType}
            title="Asset types"
            description="Categories of equipment and hardware you support."
            itemLabel="asset type"
            addLabel="Add asset type"
            emptyLabel="No asset types yet."
            namePlaceholder="Laptop"
            detailsPlaceholder="Notes about this type of asset…"
            withImage
            imageVariant="asset"
          />
        )}

        {(isAgent || isPerson) && view === "new" && (
          <NewTicketForm
            companies={companies}
            saving={saving}
            portalMode={isPerson}
            portalPerson={person}
            onCancel={() => setView("list")}
            onSubmit={handleCreate}
          />
        )}

        {view === "detail" && selected && (
          <TicketDetail
            ticket={selected}
            agentName={displayUser.name}
            saving={saving}
            readOnly={isPerson}
            onStatusChange={handleStatusChange}
            onPriorityChange={handlePriorityChange}
            onComment={handleComment}
          />
        )}
      </main>
    </div>
  );
}

function AddPlusButton({
  label,
  onClick,
  type = "button",
  disabled = false,
  className = "",
}) {
  return (
    <button
      type={type}
      className={`btn add-plus ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-tooltip={label}
    >
      <span className="add-plus-sign" aria-hidden="true">
        +
      </span>
    </button>
  );
}

function EditIconButton({
  label = "Edit",
  onClick,
  disabled = false,
  className = "",
}) {
  return (
    <button
      type="button"
      className={`btn icon-edit ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-tooltip={label}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z"
        />
      </svg>
    </button>
  );
}

function RemoveIconButton({
  label = "Remove",
  onClick,
  disabled = false,
  className = "",
}) {
  return (
    <button
      type="button"
      className={`btn icon-remove ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-tooltip={label}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"
        />
      </svg>
    </button>
  );
}

function TallerIconButton({
  label = "Taller",
  onClick,
  disabled = false,
}) {
  return (
    <button
      type="button"
      className="btn icon-taller"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-tooltip={label}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M12 5.83 15.17 9l1.41-1.41L12 3 7.41 7.59 8.83 9 12 5.83Zm0 12.34L8.83 15l-1.41 1.41L12 21l4.59-4.59L15.17 15 12 18.17Z"
        />
      </svg>
    </button>
  );
}

function AssetsIconButton({
  label = "Assets",
  onClick,
  disabled = false,
  pressed = false,
}) {
  return (
    <button
      type="button"
      className={`btn icon-assets${pressed ? " is-open" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      data-tooltip={label}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M4.5 7.4 12 3.75l7.5 3.65v.1L12 11.15 4.5 7.5v-.1Zm0 4.35 6.75 3.3v5.2L4.5 16.9v-5.15Zm8.25 8.5v-5.2l6.75-3.3V16.9l-6.75 3.35Z"
        />
      </svg>
    </button>
  );
}

function CancelIconButton({
  label = "Cancel",
  onClick,
  disabled = false,
  className = "",
}) {
  return (
    <span className={`cancel-wrap ${className}`.trim()}>
      <button
        type="button"
        className="btn icon-cancel"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        title=""
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7a1 1 0 0 0-1.4 1.4L10.6 12l-4.9 4.9a1 1 0 1 0 1.4 1.4L12 13.4l4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4Z"
          />
        </svg>
      </button>
      <span
        className="btn-tip"
        aria-hidden="true"
        style={{ top: "calc(100% + 8px)", bottom: "auto" }}
      >
        {label}
      </span>
    </span>
  );
}

function PersonAvatar({ name = "", image, size = "md", variant = "person" }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      className={`person-avatar size-${size} variant-${variant}`}
      aria-hidden="true"
    >
      {image ? <img src={image} alt="" /> : <span>{initials || "?"}</span>}
    </span>
  );
}

function PersonRef({
  person,
  size = "sm",
  showEmail = false,
  emailAsLink = false,
  className = "",
}) {
  if (!person) return null;
  return (
    <span className={`person-ref ${className}`.trim()}>
      <PersonAvatar name={person.name} image={person.image} size={size} />
      <span className="person-ref-text">
        <span className="person-ref-name">{person.name}</span>
        {showEmail && person.email ? (
          emailAsLink ? (
            <a className="person-email" href={`mailto:${person.email}`} data-mid="1">
              {person.email}
            </a>
          ) : (
            <span className="muted person-ref-email" data-mid="1">
              {person.email}
            </span>
          )
        ) : null}
        {showEmail && person.phone ? (
          emailAsLink ? (
            <a className="person-phone" href={`tel:${person.phone}`} data-mid="2">
              {person.phone}
            </a>
          ) : (
            <span className="muted person-ref-phone" data-mid="2">
              {person.phone}
            </span>
          )
        ) : null}
      </span>
    </span>
  );
}

function CompanyRef({ company, size = "sm", className = "" }) {
  if (!company) return null;
  return (
    <span className={`person-ref company-ref ${className}`.trim()}>
      <PersonAvatar
        name={company.name}
        image={company.image}
        size={size}
        variant="company"
      />
      <span className="person-ref-text">
        <span className="person-ref-name">{company.name}</span>
      </span>
    </span>
  );
}

async function readImageAsDataUrl(file, mimeHint = "") {
  if (!file) {
    throw new Error("Choose a jpeg, png, gif, or webp image");
  }
  const type = (file.type || mimeHint || "").toLowerCase();
  if (type && !type.startsWith("image/")) {
    throw new Error("Choose a jpeg, png, gif, or webp image");
  }
  if (type && !/^image\/(jpeg|jpg|png|gif|webp)$/.test(type)) {
    throw new Error("Choose a jpeg, png, gif, or webp image");
  }
  const bitmap = await createImageBitmap(file);
  const maxSide = 480;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const mime = type === "image/png" ? "image/png" : "image/jpeg";
  const dataUrl = canvas.toDataURL(mime, 0.85);
  if (dataUrl.length > 1_800_000) {
    throw new Error("Image is too large after resize. Try a smaller file.");
  }
  return dataUrl;
}

function ImageImportButton({
  name = "",
  image,
  onChange,
  disabled = false,
  variant = "person",
  allowAuto = false,
}) {
  const inputRef = useRef(null);
  const skipRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await readImageAsDataUrl(file);
      skipRef.current = 0;
      onChange(dataUrl);
    } catch (err) {
      window.alert(err.message || "Could not import image");
    } finally {
      setBusy(false);
    }
  }

  async function handleImportClick() {
    if (allowAuto && auto) {
      const query = name.trim();
      if (!query) {
        window.alert("Enter a name first so auto can find a matching image.");
        return;
      }
      setBusy(true);
      try {
        const skip = image ? skipRef.current + 1 : 0;
        skipRef.current = skip;
        const data = await fetchStockImage(query, { skip });
        const res = await fetch(data.image);
        const blob = await res.blob();
        const type = blob.type || "image/jpeg";
        const file = new File([blob], "stock", { type });
        onChange(await readImageAsDataUrl(file, type));
      } catch (err) {
        window.alert(err.message || "Could not find a stock image");
      } finally {
        setBusy(false);
      }
      return;
    }
    inputRef.current?.click();
  }

  return (
    <div className="image-import">
      <PersonAvatar name={name} image={image} size="lg" variant={variant} />
      <div className="image-import-actions">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          hidden
          onChange={handleFile}
        />
        {allowAuto && (
          <label className="auto-image-check">
            <input
              type="checkbox"
              checked={auto}
              disabled={disabled || busy}
              onChange={(e) => setAuto(e.target.checked)}
            />
            auto
          </label>
        )}
        <button
          type="button"
          className="btn ghost compact"
          disabled={disabled || busy}
          onClick={handleImportClick}
        >
          {busy
            ? auto
              ? "Finding…"
              : "Importing…"
            : image
              ? "Replace image"
              : "Import image"}
        </button>
        {image ? (
          <button
            type="button"
            className="btn ghost compact"
            disabled={disabled || busy}
            onClick={() => {
              skipRef.current = 0;
              onChange("");
            }}
          >
            Remove image
          </button>
        ) : null}
      </div>
    </div>
  );
}

function parseNotesParts(text) {
  const source = String(text ?? "");
  const parts = [];
  const re = /!\[([^\]]*)\]\((data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+)\)/gi;
  let lastIndex = 0;
  let match;
  while ((match = re.exec(source)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: source.slice(lastIndex, match.index) });
    }
    const src = match[2].replace(/\s/g, "");
    if (/^data:image\/(jpeg|jpg|png|gif|webp);base64,/i.test(src)) {
      parts.push({
        type: "image",
        alt: match[1] || "Embedded image",
        src,
      });
    } else {
      parts.push({ type: "text", value: match[0] });
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < source.length) {
    parts.push({ type: "text", value: source.slice(lastIndex) });
  }
  return parts.length ? parts : [{ type: "text", value: source }];
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isSafeNotesImageSrc(src) {
  return /^data:image\/(jpeg|jpg|png|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(
    String(src || "").replace(/\s/g, "")
  );
}

function notesMarkdownToHtml(text) {
  return parseNotesParts(text)
    .map((part) => {
      if (part.type === "image") {
        return `<img src="${part.src}" alt="${escapeHtml(part.alt)}" class="notes-embed">`;
      }
      return escapeHtml(part.value).replace(/\n/g, "<br>");
    })
    .join("");
}

function notesHtmlToMarkdown(root) {
  let out = "";

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue ?? "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toLowerCase();
    if (tag === "img") {
      const src = (node.getAttribute("src") || "").replace(/\s/g, "");
      const alt = node.getAttribute("alt") || "image";
      if (isSafeNotesImageSrc(src)) {
        out += `![${alt}](${src})`;
      }
      return;
    }
    if (tag === "br") {
      out += "\n";
      return;
    }
    if (tag === "div" || tag === "p" || tag === "li") {
      if (out.length && !out.endsWith("\n")) out += "\n";
      [...node.childNodes].forEach(walk);
      if (out.length && !out.endsWith("\n")) out += "\n";
      return;
    }
    [...node.childNodes].forEach(walk);
  }

  [...root.childNodes].forEach(walk);
  return out.replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
}

function notesIsEmpty(text) {
  const parts = parseNotesParts(text);
  return !parts.some(
    (part) =>
      part.type === "image" || (part.type === "text" && part.value.trim())
  );
}

function NotesContent({ text, className = "" }) {
  const parts = useMemo(() => parseNotesParts(text), [text]);
  if (!text) return null;
  return (
    <div className={["notes-content", className].filter(Boolean).join(" ")}>
      {parts.map((part, i) =>
        part.type === "image" ? (
          <img
            key={i}
            src={part.src}
            alt={part.alt}
            className="notes-embed"
          />
        ) : (
          <span key={i}>{part.value}</span>
        )
      )}
    </div>
  );
}

function NotesField({
  value,
  onChange,
  rows = 3,
  placeholder = "",
  required = false,
  disabled = false,
  id,
}) {
  const editorRef = useRef(null);
  const lastValueRef = useRef(value ?? "");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const next = value ?? "";
    if (el.dataset.ready === "1" && next === lastValueRef.current) return;
    lastValueRef.current = next;
    el.innerHTML = notesMarkdownToHtml(next);
    el.dataset.ready = "1";
  }, [value]);

  function emitFromEditor() {
    const el = editorRef.current;
    if (!el) return;
    const md = notesHtmlToMarkdown(el);
    lastValueRef.current = md;
    el.dataset.empty = notesIsEmpty(md) ? "true" : "false";
    onChange(md);
  }

  function placeCaretAfter(node) {
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function insertImageAtCursor(dataUrl) {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = "image";
    img.className = "notes-embed";

    const sel = window.getSelection();
    const range =
      sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)
        ? sel.getRangeAt(0)
        : null;

    if (range) {
      range.deleteContents();
      range.insertNode(img);
      placeCaretAfter(img);
    } else {
      el.appendChild(img);
      placeCaretAfter(img);
    }
    emitFromEditor();
  }

  async function importImageFile(file, mimeHint = "") {
    if (!file || disabled) return;
    setBusy(true);
    try {
      const dataUrl = await readImageAsDataUrl(file, mimeHint);
      insertImageAtCursor(dataUrl);
    } catch (err) {
      window.alert(err.message || "Could not import image");
    } finally {
      setBusy(false);
    }
  }

  async function handlePaste(e) {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    const fileFromItem = imageItem?.getAsFile?.() ?? null;
    const fileFromList = [...(e.clipboardData?.files ?? [])].find(
      (f) => !f.type || f.type.startsWith("image/")
    );
    const file = fileFromItem || fileFromList;
    if (file) {
      e.preventDefault();
      await importImageFile(file, imageItem?.type || file.type || "image/png");
      return;
    }
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (!text) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    placeCaretAfter(node);
    emitFromEditor();
  }

  function handleDragOver(e) {
    if (![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(e) {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragging(false);
  }

  async function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    const file = [...(e.dataTransfer?.files ?? [])].find(
      (f) => !f.type || f.type.startsWith("image/")
    );
    if (!file) return;
    await importImageFile(file, file.type || "image/png");
  }

  const empty = notesIsEmpty(value);
  const minHeight = `${Math.max(2, rows) * 1.45 + 1.1}rem`;

  function handleEditorMouseDown(e) {
    // Nested <label> would otherwise focus the file input and steal the caret.
    e.preventDefault();
    if (disabled || busy) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus({ preventScroll: true });
    if (typeof document.caretRangeFromPoint === "function") {
      const range = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (range && editor.contains(range.startContainer)) {
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    } else if (typeof document.caretPositionFromPoint === "function") {
      const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
      if (pos?.offsetNode && editor.contains(pos.offsetNode)) {
        const range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }

  return (
    <div
      className={["notes-field", dragging ? "dragging" : ""].filter(Boolean).join(" ")}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        ref={editorRef}
        id={id}
        className="notes-editor"
        contentEditable={!disabled && !busy}
        role="textbox"
        aria-multiline="true"
        aria-required={required || undefined}
        aria-placeholder={placeholder}
        data-placeholder={placeholder}
        data-empty={empty ? "true" : "false"}
        suppressContentEditableWarning
        style={{ minHeight }}
        onMouseDown={handleEditorMouseDown}
        onInput={emitFromEditor}
        onPaste={handlePaste}
        onBlur={emitFromEditor}
      />
    </div>
  );
}

function LoginView({ saving, error, onLogin }) {
  function handleSubmit(e) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    onLogin({
      email: String(data.get("username") || "").trim(),
      password: String(data.get("password") || ""),
    });
  }

  return (
    <section className="panel narrow login-panel">
      <div className="panel-head">
        <div>
          <p className="login-brand">Help Desk</p>
          <h1>Sign in</h1>
          <p className="muted">Use your agent or customer contact account.</p>
        </div>
      </div>

      {error && <div className="banner error login-error">{error}</div>}

      <form
        className="form"
        method="post"
        action="/api/auth/login"
        autoComplete="on"
        onSubmit={handleSubmit}
      >
        <label htmlFor="login-username">
          Email
          <input
            required
            id="login-username"
            name="username"
            type="email"
            autoComplete="username"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck="false"
            disabled={saving}
          />
        </label>
        <label htmlFor="login-password">
          Password
          <input
            required
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            disabled={saving}
          />
        </label>
        <div className="form-actions">
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
    </section>
  );
}

function AgentsView({
  agents,
  currentAgentId,
  saving,
  onCreate,
  onUpdate,
  onDelete,
}) {
  const blank = { name: "", email: "", phone: "", password: "" };
  const [draft, setDraft] = useState(blank);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
  });
  const [pendingDelete, setPendingDelete] = useState(null);
  const tableRef = useRef(null);
  useCollapseMiddles(tableRef, [agents, editingId]);
  async function handleCreate(e) {
    e.preventDefault();
    try {
      await onCreate(draft);
      setDraft(blank);
      setShowCreate(false);
    } catch {
      // parent surfaces error
    }
  }

  function startEdit(agent) {
    setEditingId(agent.id);
    setEditForm({
      name: agent.name,
      email: agent.email,
      phone: agent.phone || "",
      password: "",
    });
  }

  async function handleUpdate(e) {
    e.preventDefault();
    const payload = {
      name: editForm.name,
      email: editForm.email,
      phone: editForm.phone,
    };
    if (editForm.password.trim()) {
      payload.password = editForm.password;
    }
    try {
      await onUpdate(editingId, payload);
      setEditingId(null);
    } catch {
      // parent surfaces error
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await onDelete(pendingDelete.id);
      setPendingDelete(null);
    } catch {
      // parent surfaces error
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h1>Support agents</h1>
          <p className="muted">People who can sign in and work tickets.</p>
        </div>
        {!showCreate && (
          <AddPlusButton label="Add agent" onClick={() => setShowCreate(true)} />
        )}
      </div>

      {showCreate && (
        <form className="form agent-create" onSubmit={handleCreate}>
          <h2 className="form-section-title">Add agent</h2>
          <div className="form-row three">
            <label>
              Name
              <input
                required
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Alex Support"
              />
            </label>
            <label>
              Email
              <input
                required
                type="email"
                value={draft.email}
                onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                placeholder="alex@deskline.local"
              />
            </label>
            <label>
              Phone <span className="optional">(optional)</span>
              <input
                type="tel"
                value={draft.phone}
                onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                placeholder="+1 555 0100"
              />
            </label>
          </div>
          <label>
            Password
            <input
              required
              type="password"
              minLength={6}
              value={draft.password}
              onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))}
              placeholder="At least 6 characters"
            />
          </label>
          <div className="form-actions">
            <CancelIconButton
              disabled={saving}
              onClick={() => {
                setDraft(blank);
                setShowCreate(false);
              }}
            />
            <AddPlusButton
              type="submit"
              label={saving ? "Saving…" : "Add agent"}
              disabled={saving}
            />
          </div>
        </form>
      )}

      <div className="table-wrap" ref={tableRef} data-collapse-scope>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th data-mid="1">Email</th>
              <th data-mid="2">Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((row) =>
              editingId === row.id ? (
                <tr key={row.id} className="editing">
                  <td colSpan={4}>
                    <form className="form inline-edit" onSubmit={handleUpdate}>
                      <div className="form-row three">
                        <label>
                          Name
                          <input
                            required
                            value={editForm.name}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, name: e.target.value }))
                            }
                          />
                        </label>
                        <label>
                          Email
                          <input
                            required
                            type="email"
                            value={editForm.email}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, email: e.target.value }))
                            }
                          />
                        </label>
                        <label>
                          Phone <span className="optional">(optional)</span>
                          <input
                            type="tel"
                            value={editForm.phone}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, phone: e.target.value }))
                            }
                            placeholder="+1 555 0100"
                          />
                        </label>
                      </div>
                      <label>
                        New password <span className="optional">(optional)</span>
                        <input
                          type="password"
                          minLength={6}
                          value={editForm.password}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, password: e.target.value }))
                          }
                          placeholder="Leave blank to keep"
                        />
                      </label>
                      <div className="form-actions">
                        <CancelIconButton onClick={() => setEditingId(null)} />
                        <button type="submit" className="btn primary" disabled={saving}>
                          Save
                        </button>
                      </div>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={row.id}>
                  <td>
                    <strong>{row.name}</strong>
                    {row.id === currentAgentId && (
                      <span className="pill you">you</span>
                    )}
                  </td>
                  <td data-mid="1">
                    <div>{row.email}</div>
                    {row.phone ? (
                      <a className="person-phone" href={`tel:${row.phone}`}>
                        {row.phone}
                      </a>
                    ) : null}
                  </td>
                  <td className="muted" data-mid="2">
                    {formatDate(row.updatedAt)}
                  </td>
                  <td className="table-actions">
                    <EditIconButton onClick={() => startEdit(row)} disabled={saving} />
                    <RemoveIconButton
                      disabled={saving || agents.length <= 1}
                      onClick={() => setPendingDelete(row)}
                    />
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>

      {pendingDelete && (
        <div
          className="confirm-backdrop"
          role="presentation"
          onClick={() => !saving && setPendingDelete(null)}
        >
          <div
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-agent-title"
            aria-describedby="delete-agent-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-agent-title">Are you sure?</h2>
            <p id="delete-agent-desc">
              {pendingDelete.id === currentAgentId ? (
                <>
                  Remove <strong>your own account</strong> ({pendingDelete.email})? You will
                  be signed out.
                </>
              ) : (
                <>
                  Remove agent <strong>{pendingDelete.name}</strong> (
                  {pendingDelete.email})? They will no longer be able to sign in.
                </>
              )}
            </p>
            <div className="form-actions">
              <CancelIconButton
                disabled={saving}
                onClick={() => setPendingDelete(null)}
              />
              <button
                type="button"
                className="btn danger-solid"
                disabled={saving}
                onClick={confirmDelete}
              >
                {saving ? "Removing…" : "Yes, remove"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function CatalogView({
  items,
  saving,
  onCreate,
  onUpdate,
  onDelete,
  title,
  description,
  itemLabel,
  addLabel,
  emptyLabel,
  namePlaceholder,
  detailsPlaceholder,
  withImage = false,
  imageVariant = "company",
}) {
  const blank = withImage
    ? { name: "", details: "", image: "" }
    : { name: "", details: "" };
  const [draft, setDraft] = useState(blank);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(blank);
  const tableRef = useRef(null);
  useCollapseMiddles(tableRef, [items, editingId]);
  const [pendingDelete, setPendingDelete] = useState(null);
  const deleteTitleId = `delete-${itemLabel.replace(/\s+/g, "-")}-title`;
  const deleteDescId = `delete-${itemLabel.replace(/\s+/g, "-")}-desc`;

  async function handleCreate(e) {
    e.preventDefault();
    try {
      await onCreate(draft);
      setDraft(blank);
      setShowCreate(false);
    } catch {
      // parent surfaces error
    }
  }

  function startEdit(item) {
    setEditingId(item.id);
    setEditForm({
      name: item.name,
      details: item.details || "",
      ...(withImage ? { image: item.image || "" } : {}),
    });
  }

  async function handleUpdate(e) {
    e.preventDefault();
    try {
      await onUpdate(editingId, editForm);
      setEditingId(null);
    } catch {
      // parent surfaces error
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await onDelete(pendingDelete.id);
      setPendingDelete(null);
    } catch {
      // parent surfaces error
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h1>{title}</h1>
          <p className="muted">{description}</p>
        </div>
        {!showCreate && (
          <AddPlusButton label={addLabel} onClick={() => setShowCreate(true)} />
        )}
      </div>

      {showCreate && (
        <form className="form agent-create" onSubmit={handleCreate}>
          <h2 className="form-section-title">{addLabel}</h2>
          {withImage && (
            <ImageImportButton
              name={draft.name}
              image={draft.image}
              disabled={saving}
              variant={imageVariant}
              allowAuto
              onChange={(image) => setDraft((d) => ({ ...d, image }))}
            />
          )}
          <label>
            Name
            <input
              required
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder={namePlaceholder}
            />
          </label>
          <label>
            Details <span className="optional">(optional)</span>
            <textarea
              rows={3}
              value={draft.details}
              onChange={(e) =>
                setDraft((d) => ({ ...d, details: e.target.value }))
              }
              placeholder={detailsPlaceholder}
            />
          </label>
          <div className="form-actions">
            <CancelIconButton
              disabled={saving}
              onClick={() => {
                setDraft(blank);
                setShowCreate(false);
              }}
            />
            <AddPlusButton
              type="submit"
              label={saving ? "Saving…" : addLabel}
              disabled={saving}
            />
          </div>
        </form>
      )}

      <div className="table-wrap" ref={tableRef} data-collapse-scope>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th data-mid="1">Details</th>
              <th data-mid="2">Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  {emptyLabel}
                </td>
              </tr>
            )}
            {items.map((row) =>
              editingId === row.id ? (
                <tr key={row.id} className="editing">
                  <td colSpan={4}>
                    <form className="form inline-edit" onSubmit={handleUpdate}>
                      {withImage && (
                        <ImageImportButton
                          name={editForm.name}
                          image={editForm.image}
                          disabled={saving}
                          variant={imageVariant}
                          allowAuto
                          onChange={(image) =>
                            setEditForm((f) => ({ ...f, image }))
                          }
                        />
                      )}
                      <label>
                        Name
                        <input
                          required
                          value={editForm.name}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, name: e.target.value }))
                          }
                        />
                      </label>
                      <label>
                        Details <span className="optional">(optional)</span>
                        <textarea
                          rows={3}
                          value={editForm.details}
                          onChange={(e) =>
                            setEditForm((f) => ({
                              ...f,
                              details: e.target.value,
                            }))
                          }
                        />
                      </label>
                      <div className="form-actions">
                        <CancelIconButton onClick={() => setEditingId(null)} />
                        <button
                          type="submit"
                          className="btn primary"
                          disabled={saving}
                        >
                          Save
                        </button>
                      </div>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={row.id}>
                  <td>
                    {withImage ? (
                      <span className="catalog-name">
                        <PersonAvatar
                          name={row.name}
                          image={row.image}
                          size="md"
                          variant={imageVariant}
                        />
                        <strong>{row.name}</strong>
                      </span>
                    ) : (
                      <strong>{row.name}</strong>
                    )}
                  </td>
                  <td data-mid="1">{row.details || <span className="muted">—</span>}</td>
                  <td className="muted" data-mid="2">
                    {formatDate(row.updatedAt)}
                  </td>
                  <td className="table-actions">
                    <EditIconButton
                      onClick={() => startEdit(row)}
                      disabled={saving}
                    />
                    <RemoveIconButton
                      disabled={saving}
                      onClick={() => setPendingDelete(row)}
                    />
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>

      {pendingDelete && (
        <div
          className="confirm-backdrop"
          role="presentation"
          onClick={() => !saving && setPendingDelete(null)}
        >
          <div
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={deleteTitleId}
            aria-describedby={deleteDescId}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id={deleteTitleId}>Are you sure?</h2>
            <p id={deleteDescId}>
              Remove {itemLabel} <strong>{pendingDelete.name}</strong>?
            </p>
            <div className="form-actions">
              <CancelIconButton
                disabled={saving}
                onClick={() => setPendingDelete(null)}
              />
              <button
                type="button"
                className="btn danger-solid"
                disabled={saving}
                onClick={confirmDelete}
              >
                {saving ? "Removing…" : "Yes, remove"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function OpenPriorityChart({ counts, selectedPriority, onSelectPriority }) {
  const total = PRIORITIES.reduce((sum, key) => sum + (counts[key] || 0), 0);
  const max = Math.max(1, ...PRIORITIES.map((key) => counts[key] || 0));

  return (
    <div className="priority-chart" aria-label="Open tickets by priority">
      <div className="priority-chart-head">
        <span className="priority-chart-title">Open by priority</span>
        <span className="muted">{total} open</span>
      </div>
      <div
        className="priority-bars"
        role="group"
        aria-label={PRIORITIES.map((p) => `${counts[p] || 0} ${p}`).join(", ")}
      >
        {PRIORITIES.map((priority) => {
          const count = counts[priority] || 0;
          const height = `${Math.max(count > 0 ? 12 : 4, (count / max) * 72)}px`;
          const selected = selectedPriority === priority;
          return (
            <button
              key={priority}
              type="button"
              className={`priority-bar-col${selected ? " selected" : ""}`}
              onClick={() => onSelectPriority(priority)}
              aria-pressed={selected}
              title={`Show ${count} open ${priority} ticket${count === 1 ? "" : "s"}`}
            >
              <span className="priority-bar-count">{count}</span>
              <div className="priority-bar-track">
                <div
                  className={`priority-bar ${priority}`}
                  style={{ height }}
                />
              </div>
              <span className="priority-bar-label">{priority}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TicketList({
  tickets,
  companies,
  openByPriority,
  loading,
  statusFilter,
  companyFilter,
  priorityFilter,
  query,
  portalMode = false,
  portalCompanyName = "",
  onStatusFilter,
  onCompanyFilter,
  onPriorityFilter,
  onQuery,
  onOpen,
  onCreate,
}) {
  const listRef = useRef(null);
  useCollapseMiddles(listRef, [tickets]);
  const selectedCompanyFilter = companies.find((c) => c.id === companyFilter);
  return (
    <section className="panel">
      <div className="panel-head with-chart">
        <h1 className="tickets-title">Tickets</h1>
        {onCreate && (
          <button
            type="button"
            className="btn primary tickets-new-btn"
            onClick={onCreate}
          >
            New ticket
          </button>
        )}
        <p className="muted tickets-head-copy">
          {portalMode
            ? portalCompanyName
              ? `Support tickets for ${portalCompanyName}.`
              : "Your company’s support tickets."
            : priorityFilter
              ? `Open ${priorityFilter} priority tickets.`
              : "Track and resolve support requests."}
        </p>
        <OpenPriorityChart
          counts={openByPriority}
          selectedPriority={
            statusFilter === "open" && priorityFilter ? priorityFilter : ""
          }
          onSelectPriority={onPriorityFilter}
        />
      </div>

      <div className="filters">
        <div className="status-tabs" role="tablist" aria-label="Filter by status">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="tab"
              aria-selected={statusFilter === s.value}
              className={statusFilter === s.value ? "tab active" : "tab"}
              onClick={() => onStatusFilter(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="filter-controls">
          {!portalMode && (
            <label className="company-filter">
              <span className="sr-only">Filter by company</span>
              <PersonAvatar
                name={selectedCompanyFilter?.name}
                image={selectedCompanyFilter?.image}
                size="md"
                variant="company"
              />
              <select
                value={companyFilter}
                onChange={(e) => onCompanyFilter(e.target.value)}
              >
                <option value="">All companies</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="search">
            <span className="sr-only">Search tickets</span>
            <input
              type="search"
              placeholder={
                portalMode
                  ? "Search title, person…"
                  : "Search title, company, person…"
              }
              value={query}
              onChange={(e) => onQuery(e.target.value)}
            />
          </label>
        </div>
      </div>

      {loading ? (
        <p className="muted pad">Loading tickets…</p>
      ) : tickets.length === 0 ? (
        <p className="muted pad">No tickets match this filter.</p>
      ) : (
        <ul className="ticket-list" ref={listRef}>
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <button type="button" className="ticket-row" data-collapse-scope onClick={() => onOpen(ticket.id)}>
                <div className="ticket-row-main">
                  <div className="ticket-row-title">
                    <span className="ticket-id">{ticket.id.slice(0, 8)}</span>
                    <strong>{ticket.title}</strong>
                  </div>
                  <span className="muted ticket-row-sub">
                    <span data-mid="1">
                      <CompanyRef company={ticket.company} size="sm" />
                    </span>
                    <span data-mid="2">
                      <span className="ticket-row-sep">·</span>
                      <PersonRef person={ticket.person} size="sm" />
                    </span>
                    <span data-mid="3">
                      <span className="ticket-row-sep">·</span>
                      <span>{formatDate(ticket.updatedAt)}</span>
                    </span>
                  </span>
                </div>
                <div className="ticket-row-meta">
                  <span className={`pill priority ${ticket.priority}`}>{ticket.priority}</span>
                  <span className={`pill status ${ticket.status}`}>
                    {labelStatus(ticket.status)}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CompanyAssetsPanel({
  company,
  manufacturers,
  assetTypes,
  saving,
  onCreate,
  onUpdate,
  onDelete,
  onClose,
}) {
  const blank = {
    name: "",
    assetNumber: "",
    manufacturerId: "",
    assetTypeId: "",
    image: "",
    personId: "",
  };
  const companyPeople = company.people ?? [];
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState(blank);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(blank);
  const [pendingDelete, setPendingDelete] = useState(null);
  const listRef = useRef(null);
  useCollapseMiddles(listRef, [assets, editingId]);

  async function reload() {
    const data = await fetchCompanyAssets(company.id);
    setAssets(data);
    return data;
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCompanyAssets(company.id)
      .then((data) => {
        if (!cancelled) setAssets(data);
      })
      .catch(() => {
        if (!cancelled) setAssets([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [company.id]);

  async function handleCreate(e) {
    e.preventDefault();
    try {
      await onCreate(company.id, draft);
      setDraft(blank);
      setShowCreate(false);
      await reload();
    } catch {
      // parent surfaces error
    }
  }

  function startEdit(asset) {
    setEditingId(asset.id);
    setEditForm({
      name: asset.name || "",
      assetNumber: asset.assetNumber || "",
      manufacturerId: asset.manufacturerId,
      assetTypeId: asset.assetTypeId,
      image: asset.image || "",
      personId: asset.personId || "",
    });
    setShowCreate(false);
  }

  async function handleUpdate(e) {
    e.preventDefault();
    try {
      await onUpdate(company.id, editingId, editForm);
      setEditingId(null);
      await reload();
    } catch {
      // parent surfaces error
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await onDelete(company.id, pendingDelete.id);
      setPendingDelete(null);
      if (editingId === pendingDelete.id) setEditingId(null);
      await reload();
    } catch {
      // parent surfaces error
    }
  }

  const canAdd = manufacturers.length > 0 && assetTypes.length > 0;

  return (
    <div
      className="company-assets-overlay"
      role="dialog"
      aria-label={`Assets for ${company.name}`}
    >
      <div className="company-assets-head">
        <h3>Assets</h3>
        <div className="company-assets-head-actions">
          {!showCreate && (
            <AddPlusButton
              label="Add asset"
              className="compact"
              disabled={saving || !canAdd}
              onClick={() => {
                setShowCreate(true);
                setEditingId(null);
              }}
            />
          )}
          <CancelIconButton label="Close" onClick={onClose} />
        </div>
      </div>

      {!canAdd && (
        <p className="muted">
          Add manufacturers and asset types in Advanced before creating assets.
        </p>
      )}

      {showCreate && (
        <form className="form asset-form" onSubmit={handleCreate}>
          <ImageImportButton
            name={draft.name}
            image={draft.image}
            disabled={saving}
            variant="asset"
            onChange={(image) => setDraft((d) => ({ ...d, image }))}
          />
          <div className="form-row two">
            <label>
              Name
              <input
                required
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Lobby printer"
              />
            </label>
            <label>
              Asset number
              <input
                required
                value={draft.assetNumber}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, assetNumber: e.target.value }))
                }
                placeholder="A-1042"
              />
            </label>
          </div>
          <div className="form-row two">
            <label>
              Manufacturer
              <select
                required
                value={draft.manufacturerId}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, manufacturerId: e.target.value }))
                }
              >
                <option value="">Select manufacturer</option>
                {manufacturers.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Asset type
              <select
                required
                value={draft.assetTypeId}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, assetTypeId: e.target.value }))
                }
              >
                <option value="">Select asset type</option>
                {assetTypes.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Assigned person <span className="optional">(optional)</span>
            <select
              value={draft.personId}
              onChange={(e) =>
                setDraft((d) => ({ ...d, personId: e.target.value }))
              }
            >
              <option value="">None</option>
              {companyPeople.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            <CancelIconButton
              disabled={saving}
              onClick={() => {
                setDraft(blank);
                setShowCreate(false);
              }}
            />
            <AddPlusButton
              type="submit"
              label={saving ? "Saving…" : "Add asset"}
              disabled={saving}
              className="compact"
            />
          </div>
        </form>
      )}

      {loading ? (
        <p className="muted">Loading assets…</p>
      ) : assets.length === 0 && !showCreate ? (
        <p className="muted">No assets yet.</p>
      ) : (
        <ul className="asset-list" ref={listRef}>
          {assets.map((asset) =>
            editingId === asset.id ? (
              <li key={asset.id} className="asset-row editing">
                <form className="form asset-form" onSubmit={handleUpdate}>
                  <ImageImportButton
                    name={editForm.name}
                    image={editForm.image}
                    disabled={saving}
                    variant="asset"
                    onChange={(image) =>
                      setEditForm((f) => ({ ...f, image }))
                    }
                  />
                  <div className="form-row two">
                    <label>
                      Name
                      <input
                        required
                        value={editForm.name}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, name: e.target.value }))
                        }
                      />
                    </label>
                    <label>
                      Asset number
                      <input
                        required
                        value={editForm.assetNumber}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            assetNumber: e.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                  <div className="form-row two">
                    <label>
                      Manufacturer
                      <select
                        required
                        value={editForm.manufacturerId}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            manufacturerId: e.target.value,
                          }))
                        }
                      >
                        {manufacturers.map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Asset type
                      <select
                        required
                        value={editForm.assetTypeId}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            assetTypeId: e.target.value,
                          }))
                        }
                      >
                        {assetTypes.map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label>
                    Assigned person <span className="optional">(optional)</span>
                    <select
                      value={editForm.personId}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          personId: e.target.value,
                        }))
                      }
                    >
                      <option value="">None</option>
                      {companyPeople.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name}
                        </option>
                      ))}
                      {editForm.personId &&
                        !companyPeople.some((p) => p.id === editForm.personId) &&
                        asset.person && (
                          <option value={asset.person.id}>
                            {asset.person.name}
                          </option>
                        )}
                    </select>
                  </label>
                  <div className="form-actions">
                    <CancelIconButton onClick={() => setEditingId(null)} />
                    <button
                      type="submit"
                      className="btn primary compact"
                      disabled={saving}
                    >
                      Save
                    </button>
                  </div>
                </form>
              </li>
            ) : (
              <li key={asset.id} className="asset-row">
                <PersonAvatar
                  name={asset.name || asset.assetType?.name}
                  image={asset.image || asset.assetType?.image}
                  size="md"
                  variant="asset"
                />
                <div className="asset-row-text" data-collapse-scope>
                  <strong>{asset.name || asset.assetType?.name}</strong>
                  <span className="muted asset-row-meta">
                    {[
                      asset.assetNumber,
                      asset.assetType?.name,
                      asset.manufacturer?.name,
                      asset.person?.name,
                    ]
                      .filter(Boolean)
                      .map((part, index) => (
                        <span key={`${part}-${index}`} data-mid={index + 1}>
                          {index > 0 ? (
                            <span className="ticket-row-sep"> · </span>
                          ) : null}
                          {part}
                        </span>
                      ))}
                  </span>
                </div>
                <div className="asset-row-actions">
                  <EditIconButton
                    label="Edit asset"
                    disabled={saving}
                    onClick={() => startEdit(asset)}
                  />
                  <RemoveIconButton
                    label="Delete asset"
                    disabled={saving}
                    onClick={() => setPendingDelete(asset)}
                  />
                </div>
              </li>
            )
          )}
        </ul>
      )}

      {pendingDelete && (
        <div
          className="confirm-backdrop"
          role="presentation"
          onClick={() => !saving && setPendingDelete(null)}
        >
          <div
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-asset-title"
            aria-describedby="delete-asset-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-asset-title">Are you sure?</h2>
            <p id="delete-asset-desc">
              Remove{" "}
              <strong>{pendingDelete.name || pendingDelete.assetType?.name}</strong>
              {pendingDelete.assetNumber ? ` (${pendingDelete.assetNumber})` : ""}?
            </p>
            <div className="form-actions">
              <CancelIconButton
                disabled={saving}
                onClick={() => setPendingDelete(null)}
              />
              <button
                type="button"
                className="btn danger-solid"
                disabled={saving}
                onClick={confirmDelete}
              >
                {saving ? "Removing…" : "Yes, remove"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CompaniesView({
  companies,
  manufacturers = [],
  assetTypes = [],
  saving,
  onCreateCompany,
  onUpdateCompany,
  onDeleteCompany,
  onAddPerson,
  onUpdatePerson,
  onDeletePerson,
  onCreateAsset,
  onUpdateAsset,
  onDeleteAsset,
}) {
  const [companyName, setCompanyName] = useState("");
  const [companyDetails, setCompanyDetails] = useState("");
  const [companyImage, setCompanyImage] = useState("");
  const [firstPersonName, setFirstPersonName] = useState("");
  const [firstPersonEmail, setFirstPersonEmail] = useState("");
  const [firstPersonPhone, setFirstPersonPhone] = useState("");
  const [firstPersonPassword, setFirstPersonPassword] = useState("");
  const [showCreateCompany, setShowCreateCompany] = useState(false);
  const [personDrafts, setPersonDrafts] = useState({});
  const [addingPersonFor, setAddingPersonFor] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [pendingDeletePerson, setPendingDeletePerson] = useState(null);
  const [editingCompanyId, setEditingCompanyId] = useState(null);
  const [companyEdit, setCompanyEdit] = useState({ name: "", details: "", image: "" });
  const [assetsOpenFor, setAssetsOpenFor] = useState(null);
  const [cardGrowSteps, setCardGrowSteps] = useState({});
  const [editingPersonKey, setEditingPersonKey] = useState(null);
  const [personEdit, setPersonEdit] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    image: "",
  });
  const listRef = useRef(null);
  useCollapseMiddles(listRef, [companies, editingPersonKey]);

  function draftFor(companyId) {
    return (
      personDrafts[companyId] ?? {
        name: "",
        email: "",
        phone: "",
        password: "",
        image: "",
      }
    );
  }

  function updateDraft(companyId, field, value) {
    setPersonDrafts((prev) => ({
      ...prev,
      [companyId]: {
        ...draftFor(companyId),
        [field]: value,
      },
    }));
  }

  function startEditCompany(company) {
    setEditingCompanyId(company.id);
    setCompanyEdit({
      name: company.name,
      details: company.details || "",
      image: company.image || "",
    });
    setEditingPersonKey(null);
    setAssetsOpenFor(null);
  }

  function startEditPerson(companyId, person) {
    setEditingPersonKey(`${companyId}:${person.id}`);
    setPersonEdit({
      name: person.name,
      email: person.email,
      phone: person.phone || "",
      password: "",
      image: person.image || "",
    });
    setEditingCompanyId(null);
  }

  async function handleCreateCompany(e) {
    e.preventDefault();
    const people = [];
    if (firstPersonName.trim() || firstPersonEmail.trim() || firstPersonPassword.trim()) {
      people.push({
        name: firstPersonName,
        email: firstPersonEmail,
        phone: firstPersonPhone,
        password: firstPersonPassword,
      });
    }
    try {
      await onCreateCompany({
        name: companyName,
        details: companyDetails,
        people,
        image: companyImage,
      });
      setCompanyName("");
      setCompanyDetails("");
      setCompanyImage("");
      setFirstPersonName("");
      setFirstPersonEmail("");
      setFirstPersonPhone("");
      setFirstPersonPassword("");
      setShowCreateCompany(false);
    } catch {
      // Error surfaced by parent
    }
  }

  async function handleSaveCompany(e) {
    e.preventDefault();
    try {
      await onUpdateCompany(editingCompanyId, companyEdit);
      setEditingCompanyId(null);
    } catch {
      // Error surfaced by parent
    }
  }

  async function handleSavePerson(e, companyId, personId) {
    e.preventDefault();
    const payload = {
      name: personEdit.name,
      email: personEdit.email,
      phone: personEdit.phone,
      image: personEdit.image,
    };
    if (personEdit.password.trim()) {
      payload.password = personEdit.password;
    }
    try {
      await onUpdatePerson(companyId, personId, payload);
      setEditingPersonKey(null);
    } catch {
      // Error surfaced by parent
    }
  }

  async function confirmDeleteCompany() {
    if (!pendingDelete) return;
    const company = pendingDelete;
    try {
      await onDeleteCompany(company.id);
      setPersonDrafts((prev) => {
        const next = { ...prev };
        delete next[company.id];
        return next;
      });
      if (editingCompanyId === company.id) setEditingCompanyId(null);
      setPendingDelete(null);
    } catch {
      // Error surfaced by parent
    }
  }

  async function confirmDeletePerson() {
    if (!pendingDeletePerson) return;
    const { companyId, person } = pendingDeletePerson;
    try {
      await onDeletePerson(companyId, person.id);
      if (editingPersonKey === `${companyId}:${person.id}`) {
        setEditingPersonKey(null);
      }
      setPendingDeletePerson(null);
    } catch {
      // Error surfaced by parent
    }
  }

  async function handleAddPerson(e, companyId) {
    e.preventDefault();
    const draft = draftFor(companyId);
    try {
      await onAddPerson(companyId, draft);
      setPersonDrafts((prev) => ({
        ...prev,
        [companyId]: { name: "", email: "", phone: "", password: "", image: "" },
      }));
      setAddingPersonFor(null);
    } catch {
      // Error surfaced by parent
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h1>Customers</h1>
          <p className="muted">Registered companies and people who can open tickets.</p>
        </div>
        {!showCreateCompany && (
          <AddPlusButton
            label="Add company"
            onClick={() => setShowCreateCompany(true)}
          />
        )}
      </div>

      {showCreateCompany && (
        <form className="form company-create" onSubmit={handleCreateCompany}>
          <h2 className="form-section-title">Add company</h2>
          <ImageImportButton
            name={companyName}
            image={companyImage}
            disabled={saving}
            variant="company"
            onChange={setCompanyImage}
          />
          <label>
            Company name
            <input
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Corp"
            />
          </label>
          <div className="form-field">
            Details <span className="optional">(optional)</span>
            <NotesField
              rows={2}
              value={companyDetails}
              onChange={setCompanyDetails}
              placeholder="Notes, account info, preferences…"
              disabled={saving}
            />
          </div>
          <div className="form-row three">
            <label>
              First contact name <span className="optional">(optional)</span>
              <input
                value={firstPersonName}
                onChange={(e) => setFirstPersonName(e.target.value)}
                placeholder="Jamie Torres"
              />
            </label>
            <label>
              First contact email <span className="optional">(optional)</span>
              <input
                type="email"
                value={firstPersonEmail}
                onChange={(e) => setFirstPersonEmail(e.target.value)}
                placeholder="jamie@acme.example"
              />
            </label>
            <label>
              First contact phone <span className="optional">(optional)</span>
              <input
                type="tel"
                value={firstPersonPhone}
                onChange={(e) => setFirstPersonPhone(e.target.value)}
                placeholder="+1 555 0100"
              />
            </label>
          </div>
          <label>
            First contact password{" "}
            <span className="optional">(required if adding a contact)</span>
            <input
              type="password"
              autoComplete="new-password"
              value={firstPersonPassword}
              onChange={(e) => setFirstPersonPassword(e.target.value)}
              placeholder="At least 6 characters"
            />
          </label>
          <div className="form-actions">
            <CancelIconButton
              disabled={saving}
              onClick={() => {
                setCompanyName("");
                setCompanyDetails("");
                setCompanyImage("");
                setFirstPersonName("");
                setFirstPersonEmail("");
                setFirstPersonPhone("");
                setFirstPersonPassword("");
                setShowCreateCompany(false);
              }}
            />
            <AddPlusButton
              type="submit"
              label={saving ? "Saving…" : "Add company"}
              disabled={saving}
            />
          </div>
        </form>
      )}

      <ul className="company-list" ref={listRef}>
        {companies.map((company) => {
          const draft = draftFor(company.id);
          const isEditingCompany = editingCompanyId === company.id;
          const isAddingPerson = addingPersonFor === company.id;
          const assetsOpen = assetsOpenFor === company.id;
          const growSteps = cardGrowSteps[company.id] || 0;
          return (
            <li
              key={company.id}
              className={`company-card${assetsOpen ? " assets-open" : ""}`}
              style={
                growSteps
                  ? {
                      minHeight: `${(assetsOpen ? 20 : 10) + growSteps * 8}rem`,
                    }
                  : undefined
              }
            >
              {isEditingCompany ? (
                <form className="form company-edit" onSubmit={handleSaveCompany}>
                  <h2 className="form-section-title">Edit company</h2>
                  <ImageImportButton
                    name={companyEdit.name}
                    image={companyEdit.image}
                    disabled={saving}
                    variant="company"
                    onChange={(image) =>
                      setCompanyEdit((prev) => ({ ...prev, image }))
                    }
                  />
                  <label>
                    Company name
                    <input
                      required
                      value={companyEdit.name}
                      onChange={(e) =>
                        setCompanyEdit((prev) => ({ ...prev, name: e.target.value }))
                      }
                    />
                  </label>
                  <div className="form-field">
                    Details
                    <NotesField
                      rows={3}
                      value={companyEdit.details}
                      onChange={(details) =>
                        setCompanyEdit((prev) => ({ ...prev, details }))
                      }
                      placeholder="Notes, account info, preferences…"
                      disabled={saving}
                    />
                  </div>
                  <div className="form-actions">
                    <CancelIconButton
                      disabled={saving}
                      onClick={() => setEditingCompanyId(null)}
                    />
                    <button type="submit" className="btn primary" disabled={saving}>
                      {saving ? "Saving…" : "Save company"}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="company-card-head">
                  <div className="company-card-identity">
                    <PersonAvatar
                      name={company.name}
                      image={company.image}
                      size="lg"
                      variant="company"
                    />
                    <div>
                      <h2>{company.name}</h2>
                      <span className="muted">
                        {company.people.length} registered{" "}
                        {company.people.length === 1 ? "person" : "people"}
                      </span>
                    </div>
                  </div>
                  <div className="company-card-actions">
                    <TallerIconButton
                      disabled={saving}
                      onClick={() =>
                        setCardGrowSteps((prev) => ({
                          ...prev,
                          [company.id]: (prev[company.id] || 0) + 1,
                        }))
                      }
                    />
                    <AssetsIconButton
                      pressed={assetsOpen}
                      disabled={saving}
                      onClick={() => {
                        setAddingPersonFor(null);
                        setEditingPersonKey(null);
                        setAssetsOpenFor(assetsOpen ? null : company.id);
                      }}
                    />
                    <EditIconButton
                      label="Edit company"
                      disabled={saving}
                      onClick={() => startEditCompany(company)}
                    />
                    <RemoveIconButton
                      label="Delete"
                      disabled={saving}
                      onClick={() => setPendingDelete(company)}
                    />
                  </div>
                </div>
              )}

              <div className="company-card-body">
                {assetsOpen && !isEditingCompany && (
                  <CompanyAssetsPanel
                    company={company}
                    manufacturers={manufacturers}
                    assetTypes={assetTypes}
                    saving={saving}
                    onCreate={onCreateAsset}
                    onUpdate={onUpdateAsset}
                    onDelete={onDeleteAsset}
                    onClose={() => setAssetsOpenFor(null)}
                  />
                )}
                {!isEditingCompany && (
                  company.details ? (
                    <NotesContent
                      text={company.details}
                      className="company-details"
                    />
                  ) : (
                    <p className="muted company-details">No details yet.</p>
                  )
                )}
              <ul className="people-list">
                {company.people.map((person) => {
                  const personKey = `${company.id}:${person.id}`;
                  if (editingPersonKey === personKey) {
                    return (
                      <li key={person.id} className="person-edit-row">
                        <form
                          className="form person-edit"
                          onSubmit={(e) => handleSavePerson(e, company.id, person.id)}
                        >
                          <ImageImportButton
                            name={personEdit.name}
                            image={personEdit.image}
                            disabled={saving}
                            onChange={(image) =>
                              setPersonEdit((prev) => ({ ...prev, image }))
                            }
                          />
                          <div className="form-row three">
                            <label>
                              Name
                              <input
                                required
                                value={personEdit.name}
                                onChange={(e) =>
                                  setPersonEdit((prev) => ({
                                    ...prev,
                                    name: e.target.value,
                                  }))
                                }
                              />
                            </label>
                            <label>
                              Email
                              <input
                                required
                                type="email"
                                value={personEdit.email}
                                onChange={(e) =>
                                  setPersonEdit((prev) => ({
                                    ...prev,
                                    email: e.target.value,
                                  }))
                                }
                              />
                            </label>
                            <label>
                              Phone <span className="optional">(optional)</span>
                              <input
                                type="tel"
                                value={personEdit.phone}
                                onChange={(e) =>
                                  setPersonEdit((prev) => ({
                                    ...prev,
                                    phone: e.target.value,
                                  }))
                                }
                              />
                            </label>
                          </div>
                          <label>
                            New password <span className="optional">(optional)</span>
                            <input
                              type="password"
                              autoComplete="new-password"
                              value={personEdit.password}
                              onChange={(e) =>
                                setPersonEdit((prev) => ({
                                  ...prev,
                                  password: e.target.value,
                                }))
                              }
                              placeholder="Leave blank to keep current"
                            />
                          </label>
                          <div className="form-actions">
                            <CancelIconButton
                              className="compact"
                              disabled={saving}
                              onClick={() => setEditingPersonKey(null)}
                            />
                            <button
                              type="submit"
                              className="btn primary compact"
                              disabled={saving}
                            >
                              Save
                            </button>
                          </div>
                        </form>
                      </li>
                    );
                  }

                  return (
                    <li key={person.id} className="person-row" data-collapse-scope>
                      <PersonRef person={person} size="md" showEmail />
                      <div className="person-row-actions">
                        <EditIconButton
                          label="Edit person"
                          disabled={saving}
                          onClick={() => startEditPerson(company.id, person)}
                        />
                        <RemoveIconButton
                          label="Remove person"
                          disabled={saving}
                          onClick={() =>
                            setPendingDeletePerson({
                              companyId: company.id,
                              companyName: company.name,
                              person,
                            })
                          }
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
              {isAddingPerson ? (
                <form
                  className="form person-add"
                  onSubmit={(e) => handleAddPerson(e, company.id)}
                >
                  <ImageImportButton
                    name={draft.name}
                    image={draft.image}
                    disabled={saving}
                    onChange={(image) => updateDraft(company.id, "image", image)}
                  />
                  <div className="form-row three">
                    <label>
                      Name
                      <input
                        required
                        value={draft.name}
                        onChange={(e) => updateDraft(company.id, "name", e.target.value)}
                        placeholder="New contact"
                      />
                    </label>
                    <label>
                      Email
                      <input
                        required
                        type="email"
                        value={draft.email}
                        onChange={(e) => updateDraft(company.id, "email", e.target.value)}
                        placeholder="contact@company.example"
                      />
                    </label>
                    <label>
                      Phone <span className="optional">(optional)</span>
                      <input
                        type="tel"
                        value={draft.phone}
                        onChange={(e) => updateDraft(company.id, "phone", e.target.value)}
                        placeholder="+1 555 0100"
                      />
                    </label>
                  </div>
                  <label>
                    Password
                    <input
                      required
                      type="password"
                      autoComplete="new-password"
                      value={draft.password}
                      onChange={(e) => updateDraft(company.id, "password", e.target.value)}
                      placeholder="At least 6 characters"
                    />
                  </label>
                  <div className="form-actions">
                    <CancelIconButton
                      disabled={saving}
                      onClick={() => {
                        setPersonDrafts((prev) => ({
                          ...prev,
                          [company.id]: {
                            name: "",
                            email: "",
                            phone: "",
                            password: "",
                            image: "",
                          },
                        }));
                        setAddingPersonFor(null);
                      }}
                    />
                    <AddPlusButton
                      type="submit"
                      label={saving ? "Saving…" : "Add person"}
                      disabled={saving}
                      className="compact"
                    />
                  </div>
                </form>
              ) : (
                !isEditingCompany && (
                  <div className="person-add-trigger">
                    <AddPlusButton
                      label="Add person"
                      className="compact"
                      disabled={saving}
                      onClick={() => setAddingPersonFor(company.id)}
                    />
                  </div>
                )
              )}
              </div>
            </li>
          );
        })}
      </ul>

      {pendingDelete && (
        <div
          className="confirm-backdrop"
          role="presentation"
          onClick={() => !saving && setPendingDelete(null)}
        >
          <div
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-company-title"
            aria-describedby="delete-company-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-company-title">Are you sure?</h2>
            <p id="delete-company-desc">
              Delete <strong>{pendingDelete.name}</strong>? This permanently removes{" "}
              {pendingDelete.people.length} registered{" "}
              {pendingDelete.people.length === 1 ? "person" : "people"} and all tickets
              for this company.
            </p>
            <div className="form-actions">
              <CancelIconButton
                disabled={saving}
                onClick={() => setPendingDelete(null)}
              />
              <button
                type="button"
                className="btn danger-solid"
                disabled={saving}
                onClick={confirmDeleteCompany}
              >
                {saving ? "Deleting…" : "Yes, delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDeletePerson && (
        <div
          className="confirm-backdrop"
          role="presentation"
          onClick={() => !saving && setPendingDeletePerson(null)}
        >
          <div
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-person-title"
            aria-describedby="delete-person-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-person-title">Are you sure?</h2>
            <p id="delete-person-desc">
              Remove <strong>{pendingDeletePerson.person.name}</strong> from{" "}
              <strong>{pendingDeletePerson.companyName}</strong>? Their login will stop
              working, and any tickets linked to them will also be deleted.
            </p>
            <div className="form-actions">
              <CancelIconButton
                disabled={saving}
                onClick={() => setPendingDeletePerson(null)}
              />
              <button
                type="button"
                className="btn danger-solid"
                disabled={saving}
                onClick={confirmDeletePerson}
              >
                {saving ? "Removing…" : "Yes, remove"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function NewTicketForm({
  companies,
  saving,
  onCancel,
  onSubmit,
  portalMode = false,
  portalPerson = null,
}) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    companyId: companies[0]?.id ?? "",
    personId: companies[0]?.people[0]?.id ?? "",
    priority: "medium",
  });

  const people = useMemo(() => {
    const company = companies.find((c) => c.id === form.companyId);
    return company?.people ?? [];
  }, [companies, form.companyId]);

  const selectedCompany = companies.find((c) => c.id === form.companyId);
  const selectedPerson = people.find((p) => p.id === form.personId);

  useEffect(() => {
    if (portalMode) return;
    if (!form.companyId && companies[0]) {
      setForm((prev) => ({
        ...prev,
        companyId: companies[0].id,
        personId: companies[0].people[0]?.id ?? "",
      }));
    }
  }, [companies, form.companyId, portalMode]);

  function update(field, value) {
    setForm((prev) => {
      if (field === "companyId") {
        const company = companies.find((c) => c.id === value);
        return {
          ...prev,
          companyId: value,
          personId: company?.people[0]?.id ?? "",
        };
      }
      return { ...prev, [field]: value };
    });
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (notesIsEmpty(form.description)) {
      window.alert("Add a description before creating the ticket.");
      return;
    }
    if (portalMode) {
      onSubmit({
        title: form.title,
        description: form.description,
        priority: form.priority,
      });
      return;
    }
    onSubmit({
      title: form.title,
      description: form.description,
      companyId: form.companyId,
      personId: form.personId,
      priority: form.priority,
    });
  }

  return (
    <section className="panel narrow">
      <div className="panel-head">
        <div>
          <h1>New ticket</h1>
          <p className="muted">
            {portalMode
              ? portalPerson?.companyName
                ? `Open a support request for ${portalPerson.companyName}.`
                : "Tell us what you need help with."
              : "Assign the issue to a registered company contact."}
          </p>
        </div>
        <CancelIconButton className="tooltip-below" onClick={onCancel} />
      </div>

      <form className="form" onSubmit={handleSubmit}>
        <label>
          Title
          <input
            required
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
            placeholder="Short summary of the issue"
          />
        </label>
        <div className="form-field">
          Description
          <NotesField
            required
            rows={5}
            value={form.description}
            onChange={(description) => update("description", description)}
            placeholder="What happened? Steps to reproduce, expected vs actual…"
            disabled={saving}
          />
        </div>
        {!portalMode && (
          <div className="form-row">
            <label>
              Company
              <div className="contact-person-field">
                <PersonAvatar
                  name={selectedCompany?.name}
                  image={selectedCompany?.image}
                  size="md"
                  variant="company"
                />
                <select
                  required
                  value={form.companyId}
                  onChange={(e) => update("companyId", e.target.value)}
                >
                  {companies.length === 0 && <option value="">No companies</option>}
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            <label>
              Contact person
              <div className="contact-person-field">
                <PersonAvatar
                  name={selectedPerson?.name}
                  image={selectedPerson?.image}
                  size="md"
                />
                <select
                  required
                  value={form.personId}
                  onChange={(e) => update("personId", e.target.value)}
                  disabled={people.length === 0}
                >
                  {people.length === 0 && <option value="">No people</option>}
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </label>
          </div>
        )}
        <label>
          Priority
          <select
            value={form.priority}
            onChange={(e) => update("priority", e.target.value)}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <div className="form-actions">
          <button
            type="submit"
            className="btn primary"
            disabled={
              saving ||
              (!portalMode && (!form.companyId || !form.personId))
            }
          >
            {saving ? "Creating…" : "Create ticket"}
          </button>
        </div>
      </form>
    </section>
  );
}

function TicketDetail({
  ticket,
  agentName,
  saving,
  readOnly = false,
  onStatusChange,
  onPriorityChange,
  onComment,
}) {
  const [body, setBody] = useState("");
  const [showComposer, setShowComposer] = useState(false);
  const [commentFilter, setCommentFilter] = useState("");
  const comments = useMemo(
    () =>
      [...(ticket.comments ?? [])].sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      ),
    [ticket.comments]
  );
  const filteredComments = useMemo(() => {
    const needle = commentFilter.trim().toLowerCase();
    if (!needle) return comments;
    return comments.filter(
      (c) =>
        c.author.toLowerCase().includes(needle) ||
        c.body.toLowerCase().includes(needle)
    );
  }, [comments, commentFilter]);
  const showCommentFilter = comments.length > 1;

  useEffect(() => {
    setCommentFilter("");
    setBody("");
    setShowComposer(false);
  }, [ticket.id]);

  function handleComment(e) {
    e.preventDefault();
    if (notesIsEmpty(body)) return;
    onComment({ body });
    setBody("");
    setShowComposer(false);
  }

  return (
    <section className="panel ticket-detail">
      <div className="panel-head">
        <div>
          <h1>{ticket.title}</h1>
          <p className="muted">
            <span className="ticket-id">{ticket.id.slice(0, 8)}</span>
            {" · "}
            opened {formatDate(ticket.createdAt)}
          </p>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-main">
          <div className="description-block">
            <h2>Description</h2>
            <NotesContent text={ticket.description} />
          </div>

          <div className="comments">
            <h2>
              Comments ({filteredComments.length}
              {commentFilter.trim() ? ` of ${comments.length}` : ""})
            </h2>
            {showCommentFilter && (
              <div className="comment-filter">
                <label className="comment-filter-field">
                  <span className="sr-only">Filter comments</span>
                  <input
                    type="search"
                    value={commentFilter}
                    onChange={(e) => setCommentFilter(e.target.value)}
                    placeholder="Filter comments…"
                  />
                </label>
                {commentFilter && (
                  <button
                    type="button"
                    className="btn ghost compact"
                    onClick={() => setCommentFilter("")}
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
            {comments.length === 0 ? (
              <p className="muted">No comments yet.</p>
            ) : filteredComments.length === 0 ? (
              <p className="muted">No comments match this filter.</p>
            ) : (
              <ul className="comment-list">
                {filteredComments.map((c) => (
                  <li key={c.id} className="comment">
                    <div className="comment-meta">
                      <strong>{c.author}</strong>
                      <span className="muted">{formatDate(c.createdAt)}</span>
                    </div>
                    <NotesContent text={c.body} />
                  </li>
                ))}
              </ul>
            )}

            {showComposer ? (
              <form className="form comment-form" onSubmit={handleComment}>
                <div className="form-field">
                  <span className="comment-heading">
                    Comment below as {agentName}
                  </span>
                  <NotesField
                    required
                    rows={4}
                    value={body}
                    onChange={setBody}
                    disabled={saving}
                    placeholder={
                      readOnly
                        ? "Ask a question or add more details…"
                        : "Update the customer or note what you tried…"
                    }
                  />
                </div>
                <div className="form-actions">
                  <CancelIconButton
                    className="tooltip-top"
                    disabled={saving}
                    onClick={() => {
                      setBody("");
                      setShowComposer(false);
                    }}
                  />
                  <button type="submit" className="btn primary" disabled={saving}>
                    {saving ? "Posting…" : "Post comment"}
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                className="btn ghost comment-compose-btn"
                onClick={() => setShowComposer(true)}
              >
                Add a comment
              </button>
            )}
          </div>
        </div>

        <aside className="detail-side">
          <div className="side-customer">
            <span className="muted">Company</span>
            <div className="side-customer-person">
              <CompanyRef company={ticket.company} size="md" />
            </div>
            <span className="muted">Contact</span>
            <div className="side-customer-person">
              <PersonRef
                person={ticket.person}
                size="md"
                showEmail
                emailAsLink={!readOnly}
              />
            </div>
          </div>
          <div className="side-fields-row">
            <label>
              Status
              {readOnly ? (
                <span className={`pill status ${ticket.status}`}>
                  {labelStatus(ticket.status)}
                </span>
              ) : (
                <select
                  value={ticket.status}
                  disabled={saving}
                  onChange={(e) => onStatusChange(e.target.value)}
                >
                  {STATUSES.filter((s) => s.value !== "all").map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label>
              Priority
              {readOnly ? (
                <span className={`pill priority ${ticket.priority}`}>
                  {ticket.priority}
                </span>
              ) : (
                <select
                  value={ticket.priority}
                  disabled={saving}
                  onChange={(e) => onPriorityChange(e.target.value)}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              )}
            </label>
          </div>
          <div className="side-meta">
            <div>
              <span className="muted">Updated</span>
              <strong>{formatDate(ticket.updatedAt)}</strong>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

export default App;
