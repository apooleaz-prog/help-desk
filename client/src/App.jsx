import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AuthError,
  addComment,
  addPerson,
  clearToken,
  createAgent,
  createCompany,
  createTicket,
  deleteAgent,
  deleteCompany,
  deletePerson,
  fetchAgents,
  fetchCompanies,
  fetchMe,
  fetchTicket,
  fetchTickets,
  getToken,
  login,
  logout,
  setToken,
  updateAgent,
  updateCompany,
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

function App() {
  const [role, setRole] = useState(null);
  const [agent, setAgent] = useState(null);
  const [person, setPerson] = useState(null);
  const [authChecking, setAuthChecking] = useState(Boolean(getToken()));
  const [view, setView] = useState("list");
  const [tickets, setTickets] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [agents, setAgents] = useState([]);
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
      setCompanyFilter("");
      setPriorityFilter("");
      setStatusFilter("all");
      setQuery("");
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
      <header className="topbar">
        <div className="brand-block">
          <button
            type="button"
            className="brand"
            onClick={() => {
              setView("list");
              setSelected(null);
            }}
          >
            <span className="brand-mark">HD</span>
            <span className="brand-name">Help Desk</span>
          </button>
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
            {displayUser.name}
          </span>
        </div>
        <nav className="top-actions">
          <button
            type="button"
            className="btn icon ghost icon-tickets"
            onClick={() => {
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
            <>
              <button
                type="button"
                className="btn icon ghost icon-agents"
                onClick={() => setView("agents")}
                aria-label="Agents"
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
                className="btn icon ghost icon-customers"
                onClick={() => setView("companies")}
                aria-label="Customers"
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
                className="btn icon ghost icon-new-ticket"
                onClick={() => setView("new")}
                aria-label="New ticket"
                data-tooltip="New ticket"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path
                    fill="#0f6e6a"
                    d="M4.5 5.25A1.75 1.75 0 0 1 6.25 3.5h11.5A1.75 1.75 0 0 1 19.5 5.25v13.5A1.75 1.75 0 0 1 17.75 20.5H6.25A1.75 1.75 0 0 1 4.5 18.75V5.25Z"
                  />
                  <path
                    fill="#ccfbf1"
                    d="M7.25 7.25h6.25a.75.75 0 0 1 0 1.5H7.25a.75.75 0 0 1 0-1.5Zm0 3.25h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5Z"
                  />
                  <circle cx="17.6" cy="17.6" r="5.2" fill="#e4572e" />
                  <path
                    fill="#fff7ed"
                    d="M16.45 14.85h2.3v2.05h2.05v2.3H18.75v2.05h-2.3V19.2h-2.05v-2.3h2.05v-2.05Z"
                  />
                </svg>
              </button>
            </>
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
          />
        )}

        {isAgent && view === "companies" && (
          <CompaniesView
            companies={companies}
            saving={saving}
            onBack={() => setView("list")}
            onCreateCompany={handleCreateCompany}
            onUpdateCompany={handleUpdateCompany}
            onDeleteCompany={handleDeleteCompany}
            onAddPerson={handleAddPerson}
            onUpdatePerson={handleUpdatePerson}
            onDeletePerson={handleDeletePerson}
          />
        )}

        {isAgent && view === "agents" && (
          <AgentsView
            agents={agents}
            currentAgentId={agent.id}
            saving={saving}
            onBack={() => setView("list")}
            onCreate={handleCreateAgent}
            onUpdate={handleUpdateAgent}
            onDelete={handleDeleteAgent}
          />
        )}

        {isAgent && view === "new" && (
          <NewTicketForm
            companies={companies}
            saving={saving}
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
            onBack={() => {
              setView("list");
              setSelected(null);
            }}
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

function CancelIconButton({
  label = "Cancel",
  onClick,
  disabled = false,
  className = "",
}) {
  return (
    <button
      type="button"
      className={`btn icon-cancel ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-tooltip={label}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7a1 1 0 0 0-1.4 1.4L10.6 12l-4.9 4.9a1 1 0 1 0 1.4 1.4L12 13.4l4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4Z"
        />
      </svg>
    </button>
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
            <a className="person-email" href={`mailto:${person.email}`}>
              {person.email}
            </a>
          ) : (
            <span className="muted person-ref-email">{person.email}</span>
          )
        ) : null}
        {showEmail && person.phone ? (
          emailAsLink ? (
            <a className="person-phone" href={`tel:${person.phone}`}>
              {person.phone}
            </a>
          ) : (
            <span className="muted person-ref-phone">{person.phone}</span>
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
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await readImageAsDataUrl(file);
      onChange(dataUrl);
    } catch (err) {
      window.alert(err.message || "Could not import image");
    } finally {
      setBusy(false);
    }
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
        <button
          type="button"
          className="btn ghost compact"
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? "Importing…" : image ? "Replace image" : "Import image"}
        </button>
        {image ? (
          <button
            type="button"
            className="btn ghost compact"
            disabled={disabled || busy}
            onClick={() => onChange("")}
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
    editor.focus();
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
  const [email, setEmail] = useState("agent@deskline.local");
  const [password, setPassword] = useState("deskline123");

  function handleSubmit(e) {
    e.preventDefault();
    onLogin({ email, password });
  }

  return (
    <section className="panel narrow login-panel">
      <div className="panel-head">
        <div>
          <p className="login-brand">Help Desk</p>
          <h1>Agent sign in</h1>
          <p className="muted">Access the help desk with your support account.</p>
        </div>
      </div>

      {error && <div className="banner error login-error">{error}</div>}

      <form className="form" onSubmit={handleSubmit}>
        <label>
          Email
          <input
            required
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            required
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <div className="form-actions">
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
      <p className="muted login-hint">
        Agents and customer contacts use the same sign-in. Demo agent:{" "}
        <code>agent@deskline.local</code> / <code>deskline123</code>
      </p>
    </section>
  );
}

function AgentsView({
  agents,
  currentAgentId,
  saving,
  onBack,
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
          <button type="button" className="back" onClick={onBack}>
            ← All tickets
          </button>
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

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Updated</th>
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
                  <td>
                    <div>{row.email}</div>
                    {row.phone ? (
                      <a className="person-phone" href={`tel:${row.phone}`}>
                        {row.phone}
                      </a>
                    ) : null}
                  </td>
                  <td className="muted">{formatDate(row.updatedAt)}</td>
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
}) {
  const selectedCompanyFilter = companies.find((c) => c.id === companyFilter);
  return (
    <section className="panel">
      <div className="panel-head with-chart">
        <div>
          <h1>Tickets</h1>
          <p className="muted">
            {portalMode
              ? portalCompanyName
                ? `Support tickets for ${portalCompanyName}.`
                : "Your company’s support tickets."
              : priorityFilter
                ? `Open ${priorityFilter} priority tickets.`
                : "Track and resolve support requests."}
          </p>
        </div>
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
        <ul className="ticket-list">
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <button type="button" className="ticket-row" onClick={() => onOpen(ticket.id)}>
                <div className="ticket-row-main">
                  <div className="ticket-row-title">
                    <span className="ticket-id">{ticket.id.slice(0, 8)}</span>
                    <strong>{ticket.title}</strong>
                  </div>
                  <span className="muted ticket-row-sub">
                    <CompanyRef company={ticket.company} size="sm" />
                    <span className="ticket-row-sep">·</span>
                    <PersonRef person={ticket.person} size="sm" />
                    <span className="ticket-row-sep">·</span>
                    <span>{formatDate(ticket.updatedAt)}</span>
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

function CompaniesView({
  companies,
  saving,
  onBack,
  onCreateCompany,
  onUpdateCompany,
  onDeleteCompany,
  onAddPerson,
  onUpdatePerson,
  onDeletePerson,
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
  const [editingPersonKey, setEditingPersonKey] = useState(null);
  const [personEdit, setPersonEdit] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    image: "",
  });

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
          <button type="button" className="back" onClick={onBack}>
            ← All tickets
          </button>
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

      <ul className="company-list">
        {companies.map((company) => {
          const draft = draftFor(company.id);
          const isEditingCompany = editingCompanyId === company.id;
          const isAddingPerson = addingPersonFor === company.id;
          return (
            <li key={company.id} className="company-card">
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
                      {company.details ? (
                        <NotesContent
                          text={company.details}
                          className="company-details"
                        />
                      ) : (
                        <p className="muted company-details">No details yet.</p>
                      )}
                    </div>
                  </div>
                  <div className="company-card-actions">
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
                    <li key={person.id} className="person-row">
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

function NewTicketForm({ companies, saving, onCancel, onSubmit }) {
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
    if (!form.companyId && companies[0]) {
      setForm((prev) => ({
        ...prev,
        companyId: companies[0].id,
        personId: companies[0].people[0]?.id ?? "",
      }));
    }
  }, [companies, form.companyId]);

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
          <p className="muted">Assign the issue to a registered company contact.</p>
        </div>
        <CancelIconButton onClick={onCancel} />
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
            disabled={saving || !form.companyId || !form.personId}
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
  onBack,
  onStatusChange,
  onPriorityChange,
  onComment,
}) {
  const [body, setBody] = useState("");
  const [commentFilter, setCommentFilter] = useState("");
  const [listOverflows, setListOverflows] = useState(false);
  const commentListRef = useRef(null);
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
  const showCommentFilter =
    comments.length > 1 &&
    (listOverflows || Boolean(commentFilter.trim()));

  useEffect(() => {
    setCommentFilter("");
    setListOverflows(false);
    setBody("");
  }, [ticket.id]);

  useLayoutEffect(() => {
    const el = commentListRef.current;
    if (!el || commentFilter.trim()) return;

    const measure = () => {
      setListOverflows(el.scrollHeight > el.clientHeight + 1);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ticket.id, comments, commentFilter, filteredComments]);

  function handleComment(e) {
    e.preventDefault();
    if (notesIsEmpty(body)) return;
    onComment({ body });
    setBody("");
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <button type="button" className="back" onClick={onBack}>
            ← All tickets
          </button>
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
              <ul className="comment-list" ref={commentListRef}>
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

            <form className="form comment-form" onSubmit={handleComment}>
              <p className="muted comment-as">Commenting as {agentName}</p>
              <div className="form-field">
                Add a comment
                <NotesField
                  required
                  rows={3}
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
              <button type="submit" className="btn primary" disabled={saving}>
                {saving ? "Posting…" : "Post comment"}
              </button>
            </form>
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
