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
  createCompanyLocation,
  createManufacturer,
  createTicket,
  deleteAgent,
  deleteAssetType,
  deleteCompany,
  deleteCompanyAsset,
  deleteCompanyLocation,
  deleteManufacturer,
  deletePerson,
  deleteTicket,
  fetchAgents,
  fetchAssetTypes,
  fetchCompanies,
  fetchCompanyAssets,
  fetchCompanyLocations,
  fetchManufacturers,
  fetchMe,
  fetchStockImage,
  fetchTicket,
  fetchTicketAssets,
  fetchTickets,
  getToken,
  login,
  logout,
  setToken,
  updateAgent,
  updateAssetType,
  updateCompany,
  updateCompanyAsset,
  updateCompanyLocation,
  updateManufacturer,
  updatePerson,
  updateTicket,
} from "./api";
import "./App.css";

const STATUSES = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "on_hold", label: "On hold" },
  { value: "closed", label: "Closed" },
];

const STATUS_FILTERS = STATUSES.filter((status) => status.value !== "all");
const DEFAULT_TICKET_STATUSES = ["open", "in_progress"];
const PRIORITIES = ["low", "medium", "high", "urgent"];
const PRIORITY_FILTERS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];
const AGENT_UPDATE_KINDS = [
  { value: "comment", label: "Comment" },
  { value: "call", label: "Call" },
  { value: "asset", label: "Asset" },
  { value: "close", label: "Close" },
];
const PERSON_UPDATE_KINDS = [
  { value: "comment", label: "Comment" },
  { value: "asset", label: "Asset" },
  { value: "close", label: "Close" },
];

function updateKindPhrase(kind) {
  if (kind === "call") return "had a call";
  if (kind === "close") return "closed";
  if (kind === "status") return "changed the status";
  if (kind === "priority") return "changed the priority";
  if (kind === "asset") return "added an asset";
  return "commented";
}

function isFieldChangeUpdate(kind) {
  return kind === "status" || kind === "priority";
}

function fieldChangePhrase(comment) {
  const body = String(comment.body || "").trim();
  if (body) return body.charAt(0).toLowerCase() + body.slice(1);
  return updateKindPhrase(comment.kind);
}

function formatCount(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function formatNameList(names) {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function callParticipantNames(update, people) {
  const participants = update.callParticipants ?? {};
  const stored = (participants.people ?? []).map((person) => person.name).filter(Boolean);
  const fromCompany = (participants.personIds ?? [])
    .map((id) => people.find((person) => person.id === id)?.name)
    .filter(Boolean);
  const companyNames = stored.length ? stored : fromCompany;
  const external = (participants.externalNames ?? []).filter(Boolean);
  return [...companyNames, ...external];
}

function assetMetaParts(asset) {
  if (!asset) return [];
  return [
    asset.assetNumber,
    asset.assetTypeName || asset.assetType?.name,
    asset.manufacturerName || asset.manufacturer?.name,
    asset.locationName || asset.location?.name,
    asset.personName || asset.person?.name,
  ].filter(Boolean);
}

function assetSearchText(asset) {
  return [
    asset.name,
    asset.assetNumber,
    asset.manufacturerName || asset.manufacturer?.name,
    asset.assetTypeName || asset.assetType?.name,
    asset.locationName || asset.location?.name,
    asset.location?.address,
    asset.personName || asset.person?.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function CommentAssetCard({ asset }) {
  if (!asset) return null;
  const title = asset.name || asset.assetType?.name || "Asset";
  const typeName =
    asset.assetTypeName ||
    (asset.assetType?.name && asset.assetType.name !== title
      ? asset.assetType.name
      : "");
  const locationName = asset.locationName || asset.location?.name;
  const personName = asset.personName || asset.person?.name;
  const manufacturer = manufacturerDisplay(asset);
  const specs = Boolean(typeName || manufacturer?.name);
  const assigned = Boolean(personName || locationName);
  return (
    <div className="comment-asset">
      <PersonAvatar
        name={title}
        image={asset.image || asset.assetType?.image}
        size="sm"
        variant="asset"
      />
      <div className="comment-asset-text">
        <div className="comment-asset-head">
          <strong>{title}</strong>
          {asset.assetNumber ? (
            <span className="comment-asset-number">{asset.assetNumber}</span>
          ) : null}
        </div>
        {specs ? (
          <span className="muted comment-asset-meta">
            {typeName ? <span>{typeName}</span> : null}
            {manufacturer?.name ? (
              <ManufacturerRef manufacturer={manufacturer} />
            ) : null}
          </span>
        ) : null}
        {assigned ? (
          <span className="muted comment-asset-assign">
            {personName ? <span>{personName}</span> : null}
            {locationName ? <span>{locationName}</span> : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function assetOptionLabel(asset) {
  const name = asset.name || asset.assetType?.name || "Asset";
  const meta = assetMetaParts(asset);
  return meta.length ? `${name} · ${meta.join(" · ")}` : name;
}

function TicketAssetPicker({
  assets,
  loading,
  selectedId,
  onSelect,
  disabled = false,
}) {
  const [query, setQuery] = useState("");
  const [locationId, setLocationId] = useState("");
  const [manufacturerId, setManufacturerId] = useState("");
  const locations = useMemo(() => {
    const seen = new Set();
    return assets
      .map((asset) => asset.location)
      .filter((location) => {
        if (!location?.id || seen.has(location.id)) return false;
        seen.add(location.id);
        return true;
      });
  }, [assets]);
  const manufacturers = useMemo(() => {
    const seen = new Set();
    return assets
      .map((asset) => asset.manufacturer)
      .filter((manufacturer) => {
        if (!manufacturer?.id || seen.has(manufacturer.id)) return false;
        seen.add(manufacturer.id);
        return true;
      });
  }, [assets]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return assets.filter((asset) => {
      const assetLocationId = String(asset.locationId || asset.location?.id || "");
      const assetManufacturerId = String(
        asset.manufacturerId || asset.manufacturer?.id || ""
      );
      if (locationId && assetLocationId !== locationId) return false;
      if (manufacturerId && assetManufacturerId !== manufacturerId) return false;
      if (needle && !assetSearchText(asset).includes(needle)) return false;
      return true;
    });
  }, [assets, locationId, manufacturerId, query]);

  useEffect(() => {
    if (selectedId && !filtered.some((asset) => asset.id === selectedId)) {
      onSelect("");
    }
  }, [filtered, selectedId, onSelect]);

  if (loading) {
    return <p className="muted">Loading assets…</p>;
  }
  if (assets.length === 0) {
    return <p className="muted">This customer has no assets yet.</p>;
  }

  return (
    <div className="asset-picker">
      <div className="asset-picker-filters">
        <label>
          <span className="sr-only">Filter by location</span>
          <select
            value={locationId}
            disabled={disabled}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">All locations</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by manufacturer</span>
          <select
            value={manufacturerId}
            disabled={disabled}
            onChange={(e) => setManufacturerId(e.target.value)}
          >
            <option value="">All manufacturers</option>
            {manufacturers.map((manufacturer) => (
              <option key={manufacturer.id} value={manufacturer.id}>
                {manufacturer.name}
              </option>
            ))}
          </select>
        </label>
        <label className="asset-picker-search">
          <span className="sr-only">Filter assets</span>
          <input
            type="search"
            value={query}
            disabled={disabled}
            placeholder="Filter by name, number, type…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <label className="asset-picker-select">
        Asset ({filtered.length})
        <select
          value={selectedId}
          disabled={disabled}
          onChange={(e) => onSelect(e.target.value)}
        >
          <option value="">No asset</option>
          {filtered.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {assetOptionLabel(asset)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function notesPreview(text) {
  return parseNotesParts(text)
    .filter((part) => part.type === "text")
    .map((part) => part.value.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatCreatedOn(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function labelStatus(status) {
  return STATUSES.find((s) => s.value === status)?.label || String(status).replaceAll("_", " ");
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

function ticketCompanyId(ticket) {
  return ticket?.companyId || ticket?.company?.id || "";
}

function ticketPersonId(ticket) {
  return ticket?.personId || ticket?.person?.id || "";
}

function viewerCompanyId(person) {
  return person?.companyId || person?.company?.id || "";
}

function ticketsForCustomer(tickets, person, mine) {
  const companyId = viewerCompanyId(person);
  if (!companyId) return [];
  const scoped = tickets.filter(
    (ticket) => ticketCompanyId(ticket) === companyId
  );
  if (mine === true) {
    return scoped.filter((ticket) => ticketCreatedByPerson(ticket, person));
  }
  if (mine === false) {
    return scoped.filter((ticket) => !ticketCreatedByPerson(ticket, person));
  }
  return scoped;
}

function ticketFitsFilters(ticket, {
  statusFilter,
  priorityFilter,
  companyFilter,
  query,
  mineFilter,
  allFilter,
  isPerson,
  agent,
  person,
}) {
  if (statusFilter.length && !statusFilter.includes(ticket.status)) return false;
  if (priorityFilter.length && !priorityFilter.includes(ticket.priority)) {
    return false;
  }
  if (!isPerson && companyFilter && ticketCompanyId(ticket) !== companyFilter) {
    return false;
  }
  const needle = query.trim().toLowerCase();
  if (needle) {
    const haystack = [
      ticket.title,
      ticket.description,
      ticket.company?.name,
      ticket.person?.name,
      ticket.person?.email,
      ticket.person?.phone,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  if (isPerson) {
    const mineMode = allFilter ? undefined : mineFilter;
    return ticketsForCustomer([ticket], person, mineMode).length > 0;
  }
  if (mineFilter && agent?.id && ticket.creatorAgentId !== agent.id) {
    return false;
  }
  return true;
}

function ticketCreatedByPerson(ticket, person) {
  const personId = person?.id || "";
  if (!personId) return false;
  if (ticket.creatorPersonId === personId) return true;
  if (!ticket.creatorAgentId && !ticket.creatorPersonId) {
    return ticketPersonId(ticket) === personId;
  }
  return false;
}

function emptyPriorityCounts() {
  return { low: 0, medium: 0, high: 0, urgent: 0 };
}

function countByPriority(tickets) {
  const counts = emptyPriorityCounts();
  for (const ticket of tickets) {
    if (counts[ticket.priority] !== undefined) {
      counts[ticket.priority] += 1;
    }
  }
  return counts;
}

function pieSlicePath(cx, cy, radius, startAngle, endAngle) {
  const toPoint = (angle) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad),
    };
  };
  const start = toPoint(startAngle);
  const end = toPoint(endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
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
  const [statusFilter, setStatusFilter] = useState(DEFAULT_TICKET_STATUSES);
  const [companyFilter, setCompanyFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState([]);
  const [mineFilter, setMineFilter] = useState(false);
  const [allFilter, setAllFilter] = useState(false);
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
  const [ticketsByPriority, setTicketsByPriority] = useState({
    low: 0,
    medium: 0,
    high: 0,
    urgent: 0,
  });
  const ticketsRequestId = useRef(0);
  const mainRef = useRef(null);
  const listScrollRef = useRef(0);
  const restoreListRef = useRef(false);

  const isPerson = role === "person";
  const isAgent = role === "agent";
  const signedIn = Boolean(agent || person);
  const displayUser = isPerson ? person : agent;
  const personCompanyId = viewerCompanyId(person);
  const visibleTickets = isPerson
    ? ticketsForCustomer(tickets, person, allFilter ? undefined : mineFilter)
    : tickets;

  function clearSessionState() {
    setRole(null);
    setAgent(null);
    setPerson(null);
    setView("list");
    setSelected(null);
    setShowAdvanced(false);
    setTickets([]);
    setOpenByPriority(emptyPriorityCounts());
    setTicketsByPriority(emptyPriorityCounts());
    ticketsRequestId.current += 1;
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
          setMineFilter(true);
          setAllFilter(false);
        } else {
          setRole("agent");
          setAgent(data.agent);
          setPerson(null);
          setMineFilter(false);
          setAllFilter(true);
        }
        setStatusFilter(DEFAULT_TICKET_STATUSES);
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
    const requestId = ++ticketsRequestId.current;
    setLoading(true);
    setError("");
    try {
      if (isPerson && (!personCompanyId || !person?.id)) {
        if (requestId !== ticketsRequestId.current) return;
        setTickets([]);
        setOpenByPriority(emptyPriorityCounts());
        setTicketsByPriority(emptyPriorityCounts());
        return;
      }
      const ticketQuery = {
        status: statusFilter,
        q: query,
        priority: priorityFilter,
      };
      if (isPerson) {
        ticketQuery.companyId = personCompanyId;
        if (!allFilter) ticketQuery.mine = mineFilter;
      } else {
        ticketQuery.companyId = companyFilter;
        if (mineFilter) ticketQuery.mine = true;
      }
      const statsQuery = {};
      if (isPerson) {
        statsQuery.companyId = personCompanyId;
      }
      const [data, statsTickets] = await Promise.all([
        fetchTickets(ticketQuery),
        fetchTickets(statsQuery),
      ]);
      if (requestId !== ticketsRequestId.current) return;
      const scopedData = isPerson
        ? ticketsForCustomer(data, person, allFilter ? undefined : mineFilter)
        : data;
      const scopedStats = isPerson
        ? ticketsForCustomer(statsTickets, person)
        : statsTickets;
      setTickets(scopedData);
      setTicketsByPriority(countByPriority(scopedStats));
      setOpenByPriority(
        countByPriority(scopedStats.filter((ticket) => ticket.status === "open"))
      );
    } catch (err) {
      if (requestId !== ticketsRequestId.current) return;
      if (!handleAuthFailure(err)) setError(err.message);
    } finally {
      if (requestId === ticketsRequestId.current) setLoading(false);
    }
  }, [
    statusFilter,
    query,
    companyFilter,
    priorityFilter,
    mineFilter,
    allFilter,
    isPerson,
    personCompanyId,
    person,
  ]);

  useEffect(() => {
    if (signedIn) {
      loadTickets();
    }
  }, [signedIn, loadTickets]);

  useLayoutEffect(() => {
    if (view !== "list" || !restoreListRef.current) return;
    const scroller =
      mainRef.current?.querySelector(".ticket-list-body") ?? mainRef.current;
    if (scroller) scroller.scrollTop = listScrollRef.current;
    restoreListRef.current = false;
  }, [view]);

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
      setTickets([]);
      setOpenByPriority(emptyPriorityCounts());
      setTicketsByPriority(emptyPriorityCounts());
      setSelected(null);
      if (data.role === "person") {
        setRole("person");
        setPerson(data.person);
        setAgent(null);
        setMineFilter(true);
        setAllFilter(false);
      } else {
        setRole("agent");
        setAgent(data.agent);
        setPerson(null);
        setMineFilter(false);
        setAllFilter(true);
      }
      setView("list");
      setShowAdvanced(false);
      setCompanyFilter("");
      setPriorityFilter([]);
      setStatusFilter(DEFAULT_TICKET_STATUSES);
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

  function listFilterOpts() {
    return {
      statusFilter,
      priorityFilter,
      companyFilter,
      query,
      mineFilter,
      allFilter,
      isPerson,
      agent,
      person,
    };
  }

  function backToTickets() {
    setTickets((current) =>
      current.filter((ticket) => ticketFitsFilters(ticket, listFilterOpts()))
    );
    setView("list");
    setSelected(null);
  }

  async function openTicket(id) {
    setError("");
    const scrollTop =
      mainRef.current?.querySelector(".ticket-list-body")?.scrollTop ??
      mainRef.current?.scrollTop ??
      0;
    try {
      const ticket = await fetchTicket(id);
      if (isPerson && ticketCompanyId(ticket) !== viewerCompanyId(person)) {
        throw new Error("Ticket not found");
      }
      listScrollRef.current = scrollTop;
      restoreListRef.current = true;
      setSelected(ticket);
      setView("detail");
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
    }
  }

  async function handleCreate(payload) {
    setSaving(true);
    setError("");
    try {
      const ticket = await createTicket(payload);
      setTickets((current) => {
        if (current.some((row) => row.id === ticket.id)) return current;
        if (!ticketFitsFilters(ticket, listFilterOpts())) return current;
        return [ticket, ...current];
      });
      setSelected(ticket);
      setView("detail");
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function applyTicketUpdate(updated) {
    setSelected(updated);
    setTickets((current) => {
      const merged = current.map((ticket) =>
        ticket.id === updated.id ? { ...ticket, ...updated } : ticket
      );
      return merged.filter((ticket) =>
        ticket.id === updated.id
          ? ticketFitsFilters(ticket, listFilterOpts())
          : true
      );
    });
  }

  async function handleStatusChange(status) {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      applyTicketUpdate(await updateTicket(selected.id, { status }));
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
      applyTicketUpdate(await updateTicket(selected.id, { priority }));
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
      const created = await addComment(selected.id, payload);
      let refreshed = created.ticket;
      if (!refreshed?.id) {
        refreshed = await fetchTicket(selected.id);
      }
      applyTicketUpdate(refreshed);
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteTicket(ticketId) {
    setSaving(true);
    setError("");
    try {
      await deleteTicket(ticketId);
      setTickets((current) => current.filter((ticket) => ticket.id !== ticketId));
      if (selected?.id === ticketId) {
        setView("list");
        setSelected(null);
      }
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
      throw err;
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
      const created = await createCompanyAsset(companyId, payload);
      await loadCompanies();
      return created;
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
      await loadCompanies();
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateCompanyLocation(companyId, payload) {
    setSaving(true);
    setError("");
    try {
      const created = await createCompanyLocation(companyId, payload);
      await loadCompanies();
      return created;
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateCompanyLocation(companyId, locationId, payload) {
    setSaving(true);
    setError("");
    try {
      return await updateCompanyLocation(companyId, locationId, payload);
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCompanyLocation(companyId, locationId) {
    setSaving(true);
    setError("");
    try {
      await deleteCompanyLocation(companyId, locationId);
      await loadCompanies();
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
            <img
              className="brand-logo"
              src="/five-wits-logo.png?v=2"
              alt="Five Wits"
            />
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
            className={`btn icon ghost icon-tickets${view === "list" ? " is-active" : ""}`}
            onClick={() => {
              setShowAdvanced(false);
              setView("list");
              setSelected(null);
            }}
            aria-label="Tickets"
            aria-pressed={view === "list"}
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
          <button
            type="button"
            className={`btn icon ghost icon-stats${view === "stats" ? " is-active" : ""}`}
            onClick={() => {
              setShowAdvanced(false);
              setView("stats");
              setSelected(null);
            }}
            aria-label="Stats"
            aria-pressed={view === "stats"}
            data-tooltip="Stats"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path fill="#dbeafe" d="M3.5 19.5h17v1.75h-17V19.5Z" />
              <path fill="#2563eb" d="M5.25 11.5h2.6V19.5h-2.6v-8Z" />
              <path fill="#f59e0b" d="M10.7 8h2.6v11.5h-2.6V8Z" />
              <path fill="#e4572e" d="M16.15 4.5h2.6V19.5h-2.6V4.5Z" />
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

      <main className="main" ref={mainRef}>
        {error && <div className="banner error">{error}</div>}

        {view === "list" && (
          <TicketList
            tickets={visibleTickets}
            companies={companies}
            loading={loading}
            statusFilter={statusFilter}
            companyFilter={companyFilter}
            priorityFilter={priorityFilter}
            mineFilter={mineFilter}
            allFilter={allFilter}
            query={query}
            portalMode={isPerson}
            portalCompanyName={person?.companyName}
            onMineFilter={() => {
              const next = !mineFilter;
              setMineFilter(next);
              if (next) setAllFilter(false);
              if (isPerson) {
                setTickets((current) =>
                  ticketsForCustomer(current, person, next)
                );
              }
            }}
            onAllFilter={() => {
              const next = !allFilter;
              setAllFilter(next);
              if (next) setMineFilter(false);
              setTickets((current) =>
                isPerson
                  ? ticketsForCustomer(current, person, next ? undefined : false)
                  : current
              );
            }}
            onStatusFilter={(status) => {
              setStatusFilter((current) =>
                current.includes(status)
                  ? current.filter((value) => value !== status)
                  : [...current, status]
              );
            }}
            onCompanyFilter={setCompanyFilter}
            onPriorityFilter={(priority) => {
              setPriorityFilter((current) =>
                current.includes(priority)
                  ? current.filter((value) => value !== priority)
                  : [...current, priority]
              );
            }}
            onQuery={setQuery}
            onOpen={openTicket}
            onCreate={() => setView("new")}
          />
        )}

        {view === "stats" && (
          <StatsView
            openByPriority={openByPriority}
            ticketsByPriority={ticketsByPriority}
            selectedPriority={priorityFilter}
            portalMode={isPerson}
            portalCustomerName={person?.name}
            loading={loading}
            onRefresh={loadTickets}
            onSelectPriority={(priority) => {
              setStatusFilter((current) =>
                current.includes("open") ? current : [...current, "open"]
              );
              setPriorityFilter((current) =>
                current.includes(priority)
                  ? current.filter((value) => value !== priority)
                  : [...current, priority]
              );
              setView("list");
            }}
            onSelectAllPriority={(priority) => {
              setPriorityFilter((current) =>
                current.includes(priority)
                  ? current.filter((value) => value !== priority)
                  : [...current, priority]
              );
              setView("list");
            }}
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
            onCreateLocation={handleCreateCompanyLocation}
            onUpdateLocation={handleUpdateCompanyLocation}
            onDeleteLocation={handleDeleteCompanyLocation}
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
            itemLabel="manufacturer"
            addLabel="Add manufacturer"
            emptyLabel="No manufacturers yet."
            namePlaceholder="Dell"
            detailsPlaceholder="Support contacts, contract notes…"
            withImage
            imageVariant="manufacturer"
            imageNoun="logo"
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
            companies={companies}
            agentName={displayUser.name}
            saving={saving}
            readOnly={isPerson}
            onBack={backToTickets}
            onStatusChange={handleStatusChange}
            onPriorityChange={handlePriorityChange}
            onComment={handleComment}
            onDelete={isAgent ? handleDeleteTicket : undefined}
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
      className={`btn icon-section icon-assets${pressed ? " is-open" : ""}`}
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

function PeopleIconButton({
  label = "People",
  onClick,
  disabled = false,
  pressed = false,
}) {
  return (
    <button
      type="button"
      className={`btn icon-section icon-people${pressed ? " is-open" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      data-tooltip={label}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M8.25 11.5A3.25 3.25 0 1 0 8.25 5a3.25 3.25 0 0 0 0 6.5Zm7.5-1.25a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5ZM3.5 18.25c0-2.4 2.6-4.25 4.75-4.25h.5c2.15 0 4.75 1.85 4.75 4.25V20H3.5v-1.75Zm10.25-.15c.4-.7 1.55-1.85 3-1.85h.35c1.7 0 3.9 1.35 3.9 3.25V20h-7.25v-1.9Z"
        />
      </svg>
    </button>
  );
}

function LocationsIconButton({
  label = "Locations",
  onClick,
  disabled = false,
  pressed = false,
}) {
  return (
    <button
      type="button"
      className={`btn icon-section icon-locations${pressed ? " is-open" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      data-tooltip={label}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M12 3.5a6.25 6.25 0 0 0-6.25 6.25c0 4.2 5.05 9.55 5.77 10.3a.75.75 0 0 0 1.06 0c.72-.75 5.67-6.1 5.67-10.3A6.25 6.25 0 0 0 12 3.5Zm0 8.5a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5Z"
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

function manufacturerDisplay(asset) {
  if (asset?.manufacturer?.name) {
    return {
      name: asset.manufacturer.name,
      image:
        asset.manufacturer.image ||
        asset.manufacturer.logo ||
        asset.manufacturerImage ||
        "",
    };
  }
  if (asset?.manufacturerName) {
    return {
      name: asset.manufacturerName,
      image: asset.manufacturerImage || asset.manufacturerLogo || "",
    };
  }
  return null;
}

function ManufacturerRef({ manufacturer, size = "sm", className = "" }) {
  if (!manufacturer?.name) return null;
  const image = manufacturer.image || manufacturer.logo || "";
  return (
    <span className={`manufacturer-ref ${className}`.trim()}>
      {image ? (
        <PersonAvatar
          name={manufacturer.name}
          image={image}
          size={size}
          variant="manufacturer"
        />
      ) : null}
      <span className="manufacturer-ref-name">{manufacturer.name}</span>
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
  locationName = "",
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
        {locationName ? (
          <span className="muted person-ref-location">{locationName}</span>
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
  noun = "image",
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
              ? `Replace ${noun}`
              : `Import ${noun}`}
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
            Remove {noun}
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
          <div className="login-head">
            <img
              className="login-logo"
              src="/five-wits-logo.png?v=2"
              alt="Five Wits"
            />
            <div className="login-head-copy">
              <p className="login-brand">Help Desk</p>
              <h1>Sign in</h1>
            </div>
          </div>
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
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [editingAgent, setEditingAgent] = useState(false);
  const [editForm, setEditForm] = useState(blank);
  const [pendingDelete, setPendingDelete] = useState(null);
  const selectedAgent =
    agents.find((agent) => agent.id === selectedAgentId) ?? null;

  function openAgent(agent, { edit = false } = {}) {
    setSelectedAgentId(agent.id);
    setShowCreate(false);
    if (edit) {
      setEditingAgent(true);
      setEditForm({
        name: agent.name,
        email: agent.email,
        phone: agent.phone || "",
        password: "",
      });
    } else {
      setEditingAgent(false);
    }
  }

  function closeAgent() {
    setSelectedAgentId(null);
    setEditingAgent(false);
  }

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

  async function handleUpdate(e) {
    e.preventDefault();
    if (!selectedAgent) return;
    const payload = {
      name: editForm.name,
      email: editForm.email,
      phone: editForm.phone,
    };
    if (editForm.password.trim()) {
      payload.password = editForm.password;
    }
    try {
      await onUpdate(selectedAgent.id, payload);
      setEditingAgent(false);
    } catch {
      // parent surfaces error
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await onDelete(pendingDelete.id);
      if (selectedAgentId === pendingDelete.id) closeAgent();
      setPendingDelete(null);
    } catch {
      // parent surfaces error
    }
  }

  const deleteDialog = pendingDelete ? (
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
  ) : null;

  if (selectedAgent) {
    return (
      <section className="panel customers-panel">
        <div className="panel-head">
          <button
            type="button"
            className="btn ghost compact customer-back"
            onClick={closeAgent}
          >
            ← Support agents
          </button>
        </div>
        <div className="company-detail">
          {editingAgent ? (
            <form className="form company-edit" onSubmit={handleUpdate}>
              <h2 className="form-section-title">Edit agent</h2>
              <div className="form-row three">
                <label>
                  Name
                  <input
                    required
                    value={editForm.name}
                    onChange={(e) =>
                      setEditForm((form) => ({ ...form, name: e.target.value }))
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
                      setEditForm((form) => ({ ...form, email: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Phone <span className="optional">(optional)</span>
                  <input
                    type="tel"
                    value={editForm.phone}
                    onChange={(e) =>
                      setEditForm((form) => ({ ...form, phone: e.target.value }))
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
                    setEditForm((form) => ({ ...form, password: e.target.value }))
                  }
                  placeholder="Leave blank to keep"
                />
              </label>
              <div className="form-actions">
                <CancelIconButton
                  disabled={saving}
                  onClick={() => setEditingAgent(false)}
                />
                <button type="submit" className="btn primary" disabled={saving}>
                  {saving ? "Saving…" : "Save agent"}
                </button>
              </div>
            </form>
          ) : (
            <div className="company-card-head">
              <div className="company-card-identity">
                <PersonAvatar name={selectedAgent.name} size="lg" />
                <div>
                  <div className="agent-detail-title">
                    <h1>{selectedAgent.name}</h1>
                    {selectedAgent.id === currentAgentId ? (
                      <span className="pill you">you</span>
                    ) : null}
                  </div>
                  <div className="person-detail-meta">
                    {selectedAgent.email ? (
                      <a className="person-email" href={`mailto:${selectedAgent.email}`}>
                        {selectedAgent.email}
                      </a>
                    ) : null}
                    {selectedAgent.phone ? (
                      <a className="person-phone" href={`tel:${selectedAgent.phone}`}>
                        {selectedAgent.phone}
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="company-card-actions">
                <EditIconButton
                  label="Edit agent"
                  disabled={saving}
                  onClick={() => openAgent(selectedAgent, { edit: true })}
                />
                <RemoveIconButton
                  label="Remove agent"
                  disabled={saving || agents.length <= 1}
                  onClick={() => setPendingDelete(selectedAgent)}
                />
              </div>
            </div>
          )}
        </div>
        {deleteDialog}
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h1>Support agents</h1>
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

      <ul className="company-list">
        {agents.map((agent) => (
          <li key={agent.id}>
            <button
              type="button"
              className="company-list-row"
              onClick={() => openAgent(agent)}
            >
              <PersonAvatar name={agent.name} size="md" />
              <div className="company-list-copy">
                <strong>
                  {agent.name}
                  {agent.id === currentAgentId ? (
                    <span className="pill you">you</span>
                  ) : null}
                </strong>
                <span className="muted">
                  {[agent.email, agent.phone].filter(Boolean).join(" · ")}
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
      {deleteDialog}
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
  itemLabel,
  addLabel,
  emptyLabel,
  namePlaceholder,
  detailsPlaceholder,
  withImage = false,
  imageVariant = "company",
  imageNoun = "image",
}) {
  const blank = withImage
    ? { name: "", details: "", image: "" }
    : { name: "", details: "" };
  const [draft, setDraft] = useState(blank);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [editingItem, setEditingItem] = useState(false);
  const [editForm, setEditForm] = useState(blank);
  const [pendingDelete, setPendingDelete] = useState(null);
  const deleteTitleId = `delete-${itemLabel.replace(/\s+/g, "-")}-title`;
  const deleteDescId = `delete-${itemLabel.replace(/\s+/g, "-")}-desc`;
  const selectedItem = items.find((item) => item.id === selectedId) ?? null;

  function openItem(item, { edit = false } = {}) {
    setSelectedId(item.id);
    setShowCreate(false);
    if (edit) {
      setEditingItem(true);
      setEditForm({
        name: item.name,
        details: item.details || "",
        ...(withImage ? { image: item.image || item.logo || "" } : {}),
      });
    } else {
      setEditingItem(false);
    }
  }

  function closeItem() {
    setSelectedId(null);
    setEditingItem(false);
  }

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

  async function handleUpdate(e) {
    e.preventDefault();
    if (!selectedItem) return;
    try {
      await onUpdate(selectedItem.id, editForm);
      setEditingItem(false);
    } catch {
      // parent surfaces error
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await onDelete(pendingDelete.id);
      if (selectedId === pendingDelete.id) closeItem();
      setPendingDelete(null);
    } catch {
      // parent surfaces error
    }
  }

  const deleteDialog = pendingDelete ? (
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
  ) : null;

  if (selectedItem) {
    return (
      <section className="panel customers-panel">
        <div className="panel-head">
          <button
            type="button"
            className="btn ghost compact customer-back"
            onClick={closeItem}
          >
            ← {title}
          </button>
        </div>
        <div className="company-detail">
          {editingItem ? (
            <form className="form company-edit" onSubmit={handleUpdate}>
              <h2 className="form-section-title">Edit {itemLabel}</h2>
              {withImage && (
                <ImageImportButton
                  name={editForm.name}
                  image={editForm.image}
                  disabled={saving}
                  variant={imageVariant}
                  allowAuto
                  noun={imageNoun}
                  onChange={(image) =>
                    setEditForm((form) => ({ ...form, image }))
                  }
                />
              )}
              <label>
                Name
                <input
                  required
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm((form) => ({ ...form, name: e.target.value }))
                  }
                />
              </label>
              <label>
                Details <span className="optional">(optional)</span>
                <textarea
                  rows={3}
                  value={editForm.details}
                  onChange={(e) =>
                    setEditForm((form) => ({
                      ...form,
                      details: e.target.value,
                    }))
                  }
                />
              </label>
              <div className="form-actions">
                <CancelIconButton
                  disabled={saving}
                  onClick={() => setEditingItem(false)}
                />
                <button type="submit" className="btn primary" disabled={saving}>
                  {saving ? "Saving…" : `Save ${itemLabel}`}
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="company-card-head">
                <div className="company-card-identity">
                  <PersonAvatar
                    name={selectedItem.name}
                    image={withImage ? selectedItem.image || selectedItem.logo : undefined}
                    size="lg"
                    variant={withImage ? imageVariant : "company"}
                  />
                  <div>
                    <h1>{selectedItem.name}</h1>
                  </div>
                </div>
                <div className="company-card-actions">
                  <EditIconButton
                    label={`Edit ${itemLabel}`}
                    disabled={saving}
                    onClick={() => openItem(selectedItem, { edit: true })}
                  />
                  <RemoveIconButton
                    label={`Remove ${itemLabel}`}
                    disabled={saving}
                    onClick={() => setPendingDelete(selectedItem)}
                  />
                </div>
              </div>
              {selectedItem.details ? (
                <NotesContent
                  text={selectedItem.details}
                  className="company-details"
                />
              ) : null}
            </>
          )}
        </div>
        {deleteDialog}
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h1>{title}</h1>
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
              noun={imageNoun}
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

      {items.length === 0 && !showCreate ? (
        <p className="muted catalog-empty">{emptyLabel}</p>
      ) : (
        <ul className="company-list">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="company-list-row"
                onClick={() => openItem(item)}
              >
                <PersonAvatar
                  name={item.name}
                  image={withImage ? item.image || item.logo : undefined}
                  size="md"
                  variant={withImage ? imageVariant : "company"}
                />
                <div className="company-list-copy">
                  <strong>{item.name}</strong>
                  {item.details ? (
                    <span className="muted">{item.details}</span>
                  ) : null}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {deleteDialog}
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
          const selected = Array.isArray(selectedPriority)
            ? selectedPriority.includes(priority)
            : selectedPriority === priority;
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

function PriorityPieChart({ counts, selectedPriority, onSelectPriority }) {
  const total = PRIORITIES.reduce((sum, key) => sum + (counts[key] || 0), 0);
  let angle = 0;
  const slices = PRIORITIES.map((priority) => {
    const count = counts[priority] || 0;
    const sweep = total ? (count / total) * 360 : 0;
    const start = angle;
    angle += sweep;
    return { priority, count, start, end: angle, sweep };
  });

  return (
    <div className="priority-chart priority-pie-chart" aria-label="Tickets by priority">
      <div className="priority-chart-head">
        <span className="priority-chart-title">Tickets by priority</span>
        <span className="muted">{total} total</span>
      </div>
      <div className="priority-pie-layout">
        <svg
          className="priority-pie"
          viewBox="0 0 120 120"
          role="group"
          aria-label={PRIORITIES.map((p) => `${counts[p] || 0} ${p}`).join(", ")}
        >
          {total === 0 ? (
            <circle cx="60" cy="60" r="52" className="priority-pie-empty" />
          ) : (
            slices
              .filter((slice) => slice.count > 0)
              .map((slice) => {
                const selected = Array.isArray(selectedPriority)
                  ? selectedPriority.includes(slice.priority)
                  : selectedPriority === slice.priority;
                const full = slice.sweep >= 359.99;
                return full ? (
                  <circle
                    key={slice.priority}
                    className={`priority-pie-slice ${slice.priority}${selected ? " selected" : ""}`}
                    cx="60"
                    cy="60"
                    r="52"
                    role="button"
                    tabIndex={0}
                    aria-label={`${slice.count} ${slice.priority}`}
                    aria-pressed={selected}
                    onClick={() => onSelectPriority(slice.priority)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectPriority(slice.priority);
                      }
                    }}
                  >
                    <title>
                      {`${slice.count} ${slice.priority} ticket${slice.count === 1 ? "" : "s"}`}
                    </title>
                  </circle>
                ) : (
                  <path
                    key={slice.priority}
                    className={`priority-pie-slice ${slice.priority}${selected ? " selected" : ""}`}
                    d={pieSlicePath(60, 60, 52, slice.start, slice.end)}
                    role="button"
                    tabIndex={0}
                    aria-label={`${slice.count} ${slice.priority}`}
                    aria-pressed={selected}
                    onClick={() => onSelectPriority(slice.priority)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectPriority(slice.priority);
                      }
                    }}
                  >
                    <title>
                      {`${slice.count} ${slice.priority} ticket${slice.count === 1 ? "" : "s"}`}
                    </title>
                  </path>
                );
              })
          )}
        </svg>
        <ul className="priority-pie-legend">
          {PRIORITIES.map((priority) => {
            const count = counts[priority] || 0;
            const selected = Array.isArray(selectedPriority)
              ? selectedPriority.includes(priority)
              : selectedPriority === priority;
            return (
              <li key={priority}>
                <button
                  type="button"
                  className={`priority-pie-legend-item${selected ? " selected" : ""}`}
                  onClick={() => onSelectPriority(priority)}
                  aria-pressed={selected}
                >
                  <span className={`priority-pie-swatch ${priority}`} />
                  <span className="priority-pie-legend-label">{priority}</span>
                  <span className="priority-bar-count">{count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function StatsView({
  openByPriority,
  ticketsByPriority,
  selectedPriority,
  onSelectPriority,
  onSelectAllPriority,
  onRefresh,
  loading = false,
  portalMode = false,
  portalCustomerName = "",
}) {
  return (
    <section className="panel stats-panel">
      <div className="panel-head">
        <div>
          <h1>Stats</h1>
          <p className="muted">
            {portalMode
              ? portalCustomerName
                ? `Tickets for ${portalCustomerName} by priority.`
                : "Your tickets by priority."
              : "Tickets by priority."}
          </p>
        </div>
        {onRefresh ? (
          <button
            type="button"
            className="btn primary stats-refresh-btn"
            disabled={loading}
            onClick={() => {
              onRefresh().catch(() => {});
            }}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        ) : null}
      </div>
      <div className="stats-body">
        <PriorityPieChart
          counts={ticketsByPriority}
          selectedPriority={selectedPriority}
          onSelectPriority={onSelectAllPriority}
        />
        <OpenPriorityChart
          counts={openByPriority}
          selectedPriority={selectedPriority}
          onSelectPriority={onSelectPriority}
        />
      </div>
    </section>
  );
}

function TicketList({
  tickets,
  companies,
  loading,
  statusFilter,
  companyFilter,
  priorityFilter,
  mineFilter,
  allFilter = false,
  query,
  portalMode = false,
  portalCompanyName = "",
  onMineFilter,
  onAllFilter,
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
    <section className="panel tickets-panel">
      <div className="panel-head">
        <div>
          <h1 className="tickets-title">Tickets</h1>
          {portalMode && (
            <p className="muted tickets-head-copy">
              {portalCompanyName
                ? `Support tickets for ${portalCompanyName}.`
                : "Your company’s support tickets."}
            </p>
          )}
        </div>
        {onCreate && (
          <button
            type="button"
            className="btn primary tickets-new-btn"
            onClick={onCreate}
          >
            New ticket
          </button>
        )}
      </div>

      <div className="filters">
        <div className="filter-block">
          <div className="filter-tabs">
          {!portalMode && (
            <p className="muted filter-label">Filter:</p>
          )}
          <div className="creator-tabs" role="group" aria-label="Ticket scope">
            <button
              type="button"
              aria-pressed={mineFilter}
              className={mineFilter ? "tab active" : "tab"}
              onClick={onMineFilter}
            >
              Mine
            </button>
            <button
              type="button"
              aria-pressed={allFilter}
              className={allFilter ? "tab active" : "tab"}
              onClick={onAllFilter}
            >
              All
            </button>
          </div>
          <div className="filter-tab-groups">
            <div className="status-tabs" role="group" aria-label="Filter by status">
              {STATUS_FILTERS.map((s) => {
                const selected = statusFilter.includes(s.value);
                return (
                  <button
                    key={s.value}
                    type="button"
                    aria-pressed={selected}
                    className={selected ? "tab active" : "tab"}
                    onClick={() => onStatusFilter(s.value)}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
            <div className="status-tabs" role="group" aria-label="Filter by priority">
              {PRIORITY_FILTERS.map((p) => {
                const selected = priorityFilter.includes(p.value);
                return (
                  <button
                    key={p.value}
                    type="button"
                    aria-pressed={selected}
                    className={selected ? "tab active" : "tab"}
                    onClick={() => onPriorityFilter(p.value)}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
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

      <div className="ticket-list-body">
        {loading ? (
          <p className="muted pad">Loading tickets…</p>
        ) : tickets.length === 0 ? (
          <p className="muted pad">No tickets match this filter.</p>
        ) : (
          <ul className="ticket-list" ref={listRef}>
            {tickets.map((ticket) => {
              const preview = notesPreview(ticket.description);
              return (
              <li key={ticket.id}>
                <button type="button" className="ticket-row" onClick={() => onOpen(ticket.id)}>
                  <div className="ticket-row-main">
                    <div className="ticket-row-title">
                      <span className="ticket-id">{ticket.id.slice(0, 8)}</span>
                      <strong>{ticket.title}</strong>
                    </div>
                    <div className="ticket-row-who">
                      {!portalMode && ticket.company ? (
                        <CompanyRef company={ticket.company} size="sm" />
                      ) : null}
                      <PersonRef person={ticket.person} size="sm" />
                    </div>
                    {preview ? <p className="ticket-row-desc">{preview}</p> : null}
                  </div>
                  <div className="ticket-row-meta">
                    <span className={`pill priority ${ticket.priority}`}>{ticket.priority}</span>
                    <span className={`pill status ${ticket.status}`}>
                      {labelStatus(ticket.status)}
                    </span>
                  </div>
                </button>
              </li>
              );
            })}
          </ul>
        )}
      </div>
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
}) {
  const blank = {
    name: "",
    assetNumber: "",
    manufacturerId: "",
    assetTypeId: "",
    image: "",
    personId: "",
    locationId: "",
  };
  const companyPeople = company.people ?? [];
  const [assets, setAssets] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState(blank);
  const [viewingId, setViewingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(blank);
  const [pendingDelete, setPendingDelete] = useState(null);
  const listRef = useRef(null);
  useCollapseMiddles(listRef, [assets, editingId, viewingId]);
  const viewingAsset =
    viewingId ? assets.find((asset) => asset.id === viewingId) ?? null : null;

  async function reload() {
    const data = await fetchCompanyAssets(company.id);
    setAssets(data);
    return data;
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setViewingId(null);
    setEditingId(null);
    setShowCreate(false);
    Promise.all([fetchCompanyAssets(company.id), fetchCompanyLocations(company.id)])
      .then(([assetRows, locationRows]) => {
        if (!cancelled) {
          setAssets(assetRows);
          setLocations(locationRows);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAssets([]);
          setLocations([]);
        }
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
    setViewingId(asset.id);
    setEditingId(asset.id);
    setEditForm({
      name: asset.name || "",
      assetNumber: asset.assetNumber || "",
      manufacturerId: asset.manufacturerId,
      assetTypeId: asset.assetTypeId,
      image: asset.image || "",
      personId: asset.personId || "",
      locationId: asset.locationId || "",
    });
    setShowCreate(false);
  }

  function openAsset(asset) {
    setViewingId(asset.id);
    setEditingId(null);
    setShowCreate(false);
  }

  function closeAsset() {
    setViewingId(null);
    setEditingId(null);
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
      if (viewingId === pendingDelete.id) setViewingId(null);
      await reload();
    } catch {
      // parent surfaces error
    }
  }

  const canAdd = manufacturers.length > 0 && assetTypes.length > 0;

  return (
    <div className="company-section" aria-label={`Assets for ${company.name}`}>
      <div className="company-section-head">
        <h3>Assets</h3>
        {viewingAsset || showCreate ? (
          <CancelIconButton
            label={viewingAsset ? "Close" : "Cancel"}
            disabled={saving}
            onClick={() => {
              if (viewingAsset) {
                closeAsset();
                return;
              }
              setDraft(blank);
              setShowCreate(false);
            }}
          />
        ) : (
          <AddPlusButton
            label="Add asset"
            className="compact"
            disabled={saving || !canAdd}
            onClick={() => {
              setShowCreate(true);
              setEditingId(null);
              setViewingId(null);
            }}
          />
        )}
      </div>

      {!canAdd && !viewingAsset && !showCreate && (
        <p className="muted">
          Add manufacturers and asset types in Advanced before creating assets.
        </p>
      )}

      {showCreate && !viewingAsset && (
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
              Model number
              <input
                required
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="MX-C303P"
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
          <div className="form-row two">
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
            <label>
              Location <span className="optional">(optional)</span>
              <select
                value={draft.locationId}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, locationId: e.target.value }))
                }
              >
                <option value="">None</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
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
      ) : viewingAsset ? (
        editingId === viewingAsset.id ? (
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
                Model number
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
            <div className="form-row two">
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
                    viewingAsset.person && (
                      <option value={viewingAsset.person.id}>
                        {viewingAsset.person.name}
                      </option>
                    )}
                </select>
              </label>
              <label>
                Location <span className="optional">(optional)</span>
                <select
                  value={editForm.locationId}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      locationId: e.target.value,
                    }))
                  }
                >
                  <option value="">None</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                  {editForm.locationId &&
                    !locations.some((row) => row.id === editForm.locationId) &&
                    viewingAsset.location && (
                      <option value={viewingAsset.location.id}>
                        {viewingAsset.location.name}
                      </option>
                    )}
                </select>
              </label>
            </div>
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
        ) : (
          <div className="asset-detail">
            <div className="company-card-head">
              <div className="company-card-identity">
                <PersonAvatar
                  name={viewingAsset.name || viewingAsset.assetType?.name}
                  image={viewingAsset.image || viewingAsset.assetType?.image}
                  size="lg"
                  variant="asset"
                />
                <div>
                  <h4 className="person-detail-name">
                    {viewingAsset.name || viewingAsset.assetType?.name || "Asset"}
                  </h4>
                  <div className="person-detail-meta">
                    {viewingAsset.assetNumber ? (
                      <span>{viewingAsset.assetNumber}</span>
                    ) : null}
                    {viewingAsset.assetType?.name ? (
                      <span className="muted">{viewingAsset.assetType.name}</span>
                    ) : null}
                    {viewingAsset.manufacturer?.name ? (
                      <ManufacturerRef manufacturer={viewingAsset.manufacturer} />
                    ) : null}
                    {viewingAsset.person?.name ? (
                      <span className="muted">{viewingAsset.person.name}</span>
                    ) : null}
                    {viewingAsset.location?.name ? (
                      <span className="muted">{viewingAsset.location.name}</span>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="company-card-actions">
                <EditIconButton
                  label="Edit asset"
                  disabled={saving}
                  onClick={() => startEdit(viewingAsset)}
                />
                <RemoveIconButton
                  label="Delete asset"
                  disabled={saving}
                  onClick={() => setPendingDelete(viewingAsset)}
                />
              </div>
            </div>
          </div>
        )
      ) : showCreate ? null : assets.length === 0 ? (
        <p className="muted">No assets yet.</p>
      ) : (
        <ul className="asset-list" ref={listRef}>
          {assets.map((asset) => {
            const title = asset.name || asset.assetType?.name;
            const typeName =
              asset.assetType?.name && asset.assetType.name !== title
                ? asset.assetType.name
                : "";
            const assigned = [asset.person?.name, asset.location?.name].filter(Boolean);
            return (
            <li key={asset.id}>
              <button
                type="button"
                className="asset-row"
                onClick={() => openAsset(asset)}
              >
                <PersonAvatar
                  name={title}
                  image={asset.image || asset.assetType?.image}
                  size="md"
                  variant="asset"
                />
                <div className="asset-row-text">
                  <div className="asset-row-head">
                    <strong>{title}</strong>
                    {asset.assetNumber ? (
                      <span className="asset-row-number">{asset.assetNumber}</span>
                    ) : null}
                  </div>
                  {typeName || asset.manufacturer?.name ? (
                    <span className="muted asset-row-meta">
                      {typeName ? <span>{typeName}</span> : null}
                      {asset.manufacturer?.name ? (
                        <ManufacturerRef manufacturer={asset.manufacturer} />
                      ) : null}
                    </span>
                  ) : null}
                  {assigned.length ? (
                    <span className="muted asset-row-assign">
                      {assigned.join(" · ")}
                    </span>
                  ) : null}
                </div>
              </button>
            </li>
            );
          })}
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

function CompanyPeoplePanel({
  company,
  saving,
  onAddPerson,
  onUpdatePerson,
  onDeletePerson,
}) {
  const listRef = useRef(null);
  const [draft, setDraft] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    image: "",
    locationId: "",
  });
  const [showCreate, setShowCreate] = useState(false);
  const [viewingId, setViewingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [personEdit, setPersonEdit] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    image: "",
    locationId: "",
  });
  const [pendingDelete, setPendingDelete] = useState(null);
  const [locations, setLocations] = useState([]);
  useCollapseMiddles(listRef, [company.people, editingId, viewingId]);
  const viewingPerson =
    viewingId ? company.people.find((person) => person.id === viewingId) ?? null : null;
  const viewingLocationName = viewingPerson
    ? locations.find((row) => row.id === viewingPerson.locationId)?.name || ""
    : "";

  useEffect(() => {
    let cancelled = false;
    fetchCompanyLocations(company.id)
      .then((rows) => {
        if (!cancelled) setLocations(rows);
      })
      .catch(() => {
        if (!cancelled) setLocations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [company.id]);

  function startEdit(person) {
    setViewingId(person.id);
    setEditingId(person.id);
    setPersonEdit({
      name: person.name,
      email: person.email,
      phone: person.phone || "",
      password: "",
      image: person.image || "",
      locationId: person.locationId || "",
    });
    setShowCreate(false);
  }

  function openPerson(person) {
    setViewingId(person.id);
    setEditingId(null);
    setShowCreate(false);
  }

  function closePerson() {
    setViewingId(null);
    setEditingId(null);
  }

  async function handleAdd(e) {
    e.preventDefault();
    try {
      await onAddPerson(company.id, draft);
      setDraft({ name: "", email: "", phone: "", password: "", image: "", locationId: "" });
      setShowCreate(false);
    } catch {
      // parent surfaces error
    }
  }

  async function handleSave(e, personId) {
    e.preventDefault();
    const payload = {
      name: personEdit.name,
      email: personEdit.email,
      phone: personEdit.phone,
      image: personEdit.image,
      locationId: personEdit.locationId,
    };
    if (personEdit.password.trim()) payload.password = personEdit.password;
    try {
      await onUpdatePerson(company.id, personId, payload);
      setEditingId(null);
    } catch {
      // parent surfaces error
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await onDeletePerson(company.id, pendingDelete.id);
      setPendingDelete(null);
      if (editingId === pendingDelete.id) setEditingId(null);
      if (viewingId === pendingDelete.id) setViewingId(null);
    } catch {
      // parent surfaces error
    }
  }

  return (
    <div className="company-section" aria-label={`People for ${company.name}`}>
      <div className="company-section-head">
        <h3>People</h3>
        {viewingPerson || showCreate ? (
          <CancelIconButton
            label={viewingPerson ? "Close" : "Cancel"}
            disabled={saving}
            onClick={() => {
              if (viewingPerson) {
                closePerson();
                return;
              }
              setDraft({
                name: "",
                email: "",
                phone: "",
                password: "",
                image: "",
                locationId: "",
              });
              setShowCreate(false);
            }}
          />
        ) : (
          <AddPlusButton
            label="Add person"
            className="compact"
            disabled={saving}
            onClick={() => {
              setShowCreate(true);
              setEditingId(null);
              setViewingId(null);
            }}
          />
        )}
      </div>
      {viewingPerson ? (
        editingId === viewingPerson.id ? (
          <form className="form person-edit" onSubmit={(e) => handleSave(e, viewingPerson.id)}>
            <ImageImportButton
              name={personEdit.name}
              image={personEdit.image}
              disabled={saving}
              onChange={(image) => setPersonEdit((prev) => ({ ...prev, image }))}
            />
            <div className="form-row three">
              <label>
                Name
                <input
                  required
                  value={personEdit.name}
                  onChange={(e) =>
                    setPersonEdit((prev) => ({ ...prev, name: e.target.value }))
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
                    setPersonEdit((prev) => ({ ...prev, email: e.target.value }))
                  }
                />
              </label>
              <label>
                Phone <span className="optional">(optional)</span>
                <input
                  type="tel"
                  value={personEdit.phone}
                  onChange={(e) =>
                    setPersonEdit((prev) => ({ ...prev, phone: e.target.value }))
                  }
                />
              </label>
            </div>
            <label>
              Location <span className="optional">(optional)</span>
              <select
                value={personEdit.locationId}
                onChange={(e) =>
                  setPersonEdit((prev) => ({ ...prev, locationId: e.target.value }))
                }
              >
                <option value="">None</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              New password <span className="optional">(optional)</span>
              <input
                type="password"
                autoComplete="new-password"
                value={personEdit.password}
                onChange={(e) =>
                  setPersonEdit((prev) => ({ ...prev, password: e.target.value }))
                }
                placeholder="Leave blank to keep current"
              />
            </label>
            <div className="form-actions">
              <CancelIconButton
                className="compact"
                disabled={saving}
                onClick={() => setEditingId(null)}
              />
              <button type="submit" className="btn primary compact" disabled={saving}>
                Save
              </button>
            </div>
          </form>
        ) : (
          <div className="person-detail">
            <div className="company-card-head">
              <div className="company-card-identity">
                <PersonAvatar
                  name={viewingPerson.name}
                  image={viewingPerson.image}
                  size="lg"
                />
                <div>
                  <h4 className="person-detail-name">{viewingPerson.name}</h4>
                  <div className="person-detail-meta">
                    {viewingPerson.email ? (
                      <a className="person-email" href={`mailto:${viewingPerson.email}`}>
                        {viewingPerson.email}
                      </a>
                    ) : (
                      <span className="muted">No email</span>
                    )}
                    {viewingPerson.phone ? (
                      <a className="person-phone" href={`tel:${viewingPerson.phone}`}>
                        {viewingPerson.phone}
                      </a>
                    ) : null}
                    {viewingLocationName ? (
                      <span className="muted">{viewingLocationName}</span>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="company-card-actions">
                <EditIconButton
                  label="Edit person"
                  disabled={saving}
                  onClick={() => startEdit(viewingPerson)}
                />
                <RemoveIconButton
                  label="Remove person"
                  disabled={saving}
                  onClick={() => setPendingDelete(viewingPerson)}
                />
              </div>
            </div>
          </div>
        )
      ) : null}
      {showCreate && !viewingPerson && (
        <form className="form person-add" onSubmit={handleAdd}>
          <ImageImportButton
            name={draft.name}
            image={draft.image}
            disabled={saving}
            onChange={(image) => setDraft((prev) => ({ ...prev, image }))}
          />
          <div className="form-row three">
            <label>
              Name
              <input
                required
                value={draft.name}
                onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="New contact"
              />
            </label>
            <label>
              Email
              <input
                required
                type="email"
                value={draft.email}
                onChange={(e) => setDraft((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="contact@company.example"
              />
            </label>
            <label>
              Phone <span className="optional">(optional)</span>
              <input
                type="tel"
                value={draft.phone}
                onChange={(e) => setDraft((prev) => ({ ...prev, phone: e.target.value }))}
                placeholder="+1 555 0100"
              />
            </label>
          </div>
          <label>
            Location <span className="optional">(optional)</span>
            <select
              value={draft.locationId}
              onChange={(e) => setDraft((prev) => ({ ...prev, locationId: e.target.value }))}
            >
              <option value="">None</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Password
            <input
              required
              type="password"
              autoComplete="new-password"
              value={draft.password}
              onChange={(e) => setDraft((prev) => ({ ...prev, password: e.target.value }))}
              placeholder="At least 6 characters"
            />
          </label>
          <div className="form-actions">
            <CancelIconButton
              disabled={saving}
              onClick={() => {
                setDraft({ name: "", email: "", phone: "", password: "", image: "", locationId: "" });
                setShowCreate(false);
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
      )}
      {!viewingPerson && !showCreate && (
      <ul className="people-list" ref={listRef}>
        {company.people.length === 0 && !showCreate ? (
          <li className="muted">No people yet.</li>
        ) : (
          company.people.map((person) => (
              <li key={person.id} className="person-row" data-collapse-scope>
                <button
                  type="button"
                  className="person-row-open"
                  onClick={() => openPerson(person)}
                >
                  <PersonRef
                    person={person}
                    size="md"
                    showEmail
                    locationName={
                      locations.find((row) => row.id === person.locationId)?.name || ""
                    }
                  />
                </button>
                <div className="person-row-actions">
                  <EditIconButton
                    label="Edit person"
                    disabled={saving}
                    onClick={() => startEdit(person)}
                  />
                  <RemoveIconButton
                    label="Remove person"
                    disabled={saving}
                    onClick={() => setPendingDelete(person)}
                  />
                </div>
              </li>
          ))
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
            aria-labelledby="delete-person-title"
            aria-describedby="delete-person-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-person-title">Are you sure?</h2>
            <p id="delete-person-desc">
              Remove <strong>{pendingDelete.name}</strong> from{" "}
              <strong>{company.name}</strong>? Their login will stop working, and any
              tickets linked to them will also be deleted.
            </p>
            <div className="form-actions">
              <CancelIconButton disabled={saving} onClick={() => setPendingDelete(null)} />
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

function CompanyLocationsPanel({ company, saving, onCreate, onUpdate, onDelete }) {
  const blank = { name: "", address: "", details: "" };
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState(blank);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(blank);
  const [pendingDelete, setPendingDelete] = useState(null);

  async function reload() {
    setLocations(await fetchCompanyLocations(company.id));
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCompanyLocations(company.id)
      .then((data) => {
        if (!cancelled) setLocations(data);
      })
      .catch(() => {
        if (!cancelled) setLocations([]);
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

  function startEdit(location) {
    setEditingId(location.id);
    setEditForm({
      name: location.name || "",
      address: location.address || "",
      details: location.details || "",
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

  function locationFields(value, onChange, extra = null) {
    return (
      <>
        <label>
          Name
          <input
            required
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            placeholder="Main office"
          />
        </label>
        <label>
          Address <span className="optional">(optional)</span>
          <input
            value={value.address}
            onChange={(e) => onChange({ ...value, address: e.target.value })}
            placeholder="123 Main St, City"
          />
        </label>
        <div className="form-field">
          Details <span className="optional">(optional)</span>
          <NotesField
            rows={2}
            value={value.details}
            onChange={(details) => onChange({ ...value, details })}
            placeholder="Hours, parking, access notes…"
            disabled={saving}
          />
        </div>
        {extra}
      </>
    );
  }

  return (
    <div className="company-section" aria-label={`Locations for ${company.name}`}>
      <div className="company-section-head">
        <h3>Locations</h3>
        {showCreate || editingId ? (
          <CancelIconButton
            label={showCreate ? "Cancel" : "Close"}
            disabled={saving}
            onClick={() => {
              setDraft(blank);
              setShowCreate(false);
              setEditingId(null);
            }}
          />
        ) : (
          <AddPlusButton
            label="Add location"
            className="compact"
            disabled={saving}
            onClick={() => {
              setShowCreate(true);
              setEditingId(null);
            }}
          />
        )}
      </div>
      {showCreate && (
        <form className="form location-form" onSubmit={handleCreate}>
          {locationFields(draft, setDraft)}
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
              label={saving ? "Saving…" : "Add location"}
              disabled={saving}
              className="compact"
            />
          </div>
        </form>
      )}
      {editingId ? (
        <form className="form location-form" onSubmit={handleUpdate}>
          {locationFields(editForm, setEditForm)}
          <div className="form-actions">
            <CancelIconButton onClick={() => setEditingId(null)} />
            <button type="submit" className="btn primary compact" disabled={saving}>
              Save
            </button>
          </div>
        </form>
      ) : null}
      {loading ? (
        <p className="muted">Loading locations…</p>
      ) : showCreate || editingId ? null : locations.length === 0 ? (
        <p className="muted">No locations yet.</p>
      ) : (
        <ul className="location-list">
          {locations.map((location) => (
            <li key={location.id} className="location-row">
              <div className="location-row-text">
                <strong>{location.name}</strong>
                {location.address ? <span className="muted">{location.address}</span> : null}
                {location.details ? (
                  <NotesContent text={location.details} className="location-details" />
                ) : null}
              </div>
              <div className="location-row-actions">
                <EditIconButton
                  label="Edit location"
                  disabled={saving}
                  onClick={() => startEdit(location)}
                />
                <RemoveIconButton
                  label="Delete location"
                  disabled={saving}
                  onClick={() => setPendingDelete(location)}
                />
              </div>
            </li>
          ))}
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
            aria-labelledby="delete-location-title"
            aria-describedby="delete-location-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-location-title">Are you sure?</h2>
            <p id="delete-location-desc">
              Remove <strong>{pendingDelete.name}</strong>
              {pendingDelete.address ? ` (${pendingDelete.address})` : ""}?
            </p>
            <div className="form-actions">
              <CancelIconButton disabled={saving} onClick={() => setPendingDelete(null)} />
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
  onCreateLocation,
  onUpdateLocation,
  onDeleteLocation,
}) {
  const [companyName, setCompanyName] = useState("");
  const [companyDetails, setCompanyDetails] = useState("");
  const [companyImage, setCompanyImage] = useState("");
  const [firstPersonName, setFirstPersonName] = useState("");
  const [firstPersonEmail, setFirstPersonEmail] = useState("");
  const [firstPersonPhone, setFirstPersonPhone] = useState("");
  const [firstPersonPassword, setFirstPersonPassword] = useState("");
  const [showCreateCompany, setShowCreateCompany] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState(null);
  const [openSection, setOpenSection] = useState("people");
  const [editingCompany, setEditingCompany] = useState(false);
  const [companyEdit, setCompanyEdit] = useState({ name: "", details: "", image: "" });
  const selectedCompany =
    companies.find((company) => company.id === selectedCompanyId) ?? null;

  function resetCreateForm() {
    setCompanyName("");
    setCompanyDetails("");
    setCompanyImage("");
    setFirstPersonName("");
    setFirstPersonEmail("");
    setFirstPersonPhone("");
    setFirstPersonPassword("");
    setShowCreateCompany(false);
  }

  function openCompany(company, { edit = false } = {}) {
    setSelectedCompanyId(company.id);
    setOpenSection(edit ? null : "people");
    if (edit) {
      setEditingCompany(true);
      setCompanyEdit({
        name: company.name,
        details: company.details || "",
        image: company.image || "",
      });
    } else {
      setEditingCompany(false);
    }
  }

  function toggleSection(section) {
    setOpenSection((current) => (current === section ? null : section));
    setEditingCompany(false);
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
      resetCreateForm();
    } catch {
      // Error surfaced by parent
    }
  }

  async function handleSaveCompany(e) {
    e.preventDefault();
    if (!selectedCompany) return;
    try {
      await onUpdateCompany(selectedCompany.id, companyEdit);
      setEditingCompany(false);
      setOpenSection((current) => current || "people");
    } catch {
      // Error surfaced by parent
    }
  }

  async function confirmDeleteCompany() {
    if (!pendingDelete) return;
    try {
      await onDeleteCompany(pendingDelete.id);
      if (selectedCompanyId === pendingDelete.id) {
        setSelectedCompanyId(null);
        setOpenSection("people");
        setEditingCompany(false);
      }
      setPendingDelete(null);
    } catch {
      // Error surfaced by parent
    }
  }

  const deleteDialog = pendingDelete ? (
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
          <CancelIconButton disabled={saving} onClick={() => setPendingDelete(null)} />
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
  ) : null;

  if (selectedCompany) {
    return (
      <section className="panel customers-panel">
        <div className="panel-head">
          <button
            type="button"
            className="btn ghost compact customer-back"
            onClick={() => {
              setSelectedCompanyId(null);
              setOpenSection("people");
              setEditingCompany(false);
            }}
          >
            ← Customers
          </button>
          {!editingCompany && (
            <div className="company-card-actions">
              <AssetsIconButton
                pressed={openSection === "assets"}
                disabled={saving}
                onClick={() => toggleSection("assets")}
              />
              <PeopleIconButton
                pressed={openSection === "people"}
                disabled={saving}
                onClick={() => toggleSection("people")}
              />
              <LocationsIconButton
                pressed={openSection === "locations"}
                disabled={saving}
                onClick={() => toggleSection("locations")}
              />
              <EditIconButton
                label="Edit company"
                disabled={saving}
                onClick={() => openCompany(selectedCompany, { edit: true })}
              />
              <RemoveIconButton
                label="Delete"
                disabled={saving}
                onClick={() => setPendingDelete(selectedCompany)}
              />
            </div>
          )}
        </div>
        <div className="company-detail">
          {editingCompany ? (
            <form className="form company-edit" onSubmit={handleSaveCompany}>
              <h2 className="form-section-title">Edit company</h2>
              <ImageImportButton
                name={companyEdit.name}
                image={companyEdit.image}
                disabled={saving}
                variant="company"
                onChange={(image) => setCompanyEdit((prev) => ({ ...prev, image }))}
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
                  onClick={() => {
                    setEditingCompany(false);
                    setOpenSection((current) => current || "people");
                  }}
                />
                <button type="submit" className="btn primary" disabled={saving}>
                  {saving ? "Saving…" : "Save company"}
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="company-card-head">
                <div className="company-card-identity">
                  <PersonAvatar
                    name={selectedCompany.name}
                    image={selectedCompany.image}
                    size="md"
                    variant="company"
                  />
                  <div>
                    <h1>{selectedCompany.name}</h1>
                  </div>
                </div>
              </div>
              {selectedCompany.details ? (
                <NotesContent
                  text={selectedCompany.details}
                  className="company-details"
                />
              ) : (
                <p className="muted company-details">No details yet.</p>
              )}
            </>
          )}

          {openSection === "assets" && !editingCompany && (
            <CompanyAssetsPanel
              company={selectedCompany}
              manufacturers={manufacturers}
              assetTypes={assetTypes}
              saving={saving}
              onCreate={onCreateAsset}
              onUpdate={onUpdateAsset}
              onDelete={onDeleteAsset}
            />
          )}
          {openSection === "people" && !editingCompany && (
            <CompanyPeoplePanel
              company={selectedCompany}
              saving={saving}
              onAddPerson={onAddPerson}
              onUpdatePerson={onUpdatePerson}
              onDeletePerson={onDeletePerson}
            />
          )}
          {openSection === "locations" && !editingCompany && (
            <CompanyLocationsPanel
              company={selectedCompany}
              saving={saving}
              onCreate={onCreateLocation}
              onUpdate={onUpdateLocation}
              onDelete={onDeleteLocation}
            />
          )}
        </div>
        {deleteDialog}
      </section>
    );
  }

  return (
    <section className="panel customers-panel">
      <div className="panel-head">
        <div>
          <h1>Customers</h1>
        </div>
        {!showCreateCompany && (
          <AddPlusButton label="Add company" onClick={() => setShowCreateCompany(true)} />
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
            <CancelIconButton disabled={saving} onClick={resetCreateForm} />
            <AddPlusButton
              type="submit"
              label={saving ? "Saving…" : "Add company"}
              disabled={saving}
            />
          </div>
        </form>
      )}

      <ul className="company-list">
        {companies.map((company) => (
          <li key={company.id}>
            <button
              type="button"
              className="company-list-row"
              onClick={() => openCompany(company)}
            >
              <PersonAvatar
                name={company.name}
                image={company.image}
                size="md"
                variant="company"
              />
              <span className="company-list-copy">
                <strong>{company.name}</strong>
                <span className="muted">
                  {[
                    formatCount(company.people.length, "person", "people"),
                    formatCount(company.assetCount || 0, "asset", "assets"),
                    formatCount(company.locationCount || 0, "location", "locations"),
                  ].join(" · ")}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {deleteDialog}
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
  companies = [],
  agentName,
  saving,
  readOnly = false,
  onBack,
  onStatusChange,
  onPriorityChange,
  onComment,
  onDelete,
}) {
  const [body, setBody] = useState("");
  const [kind, setKind] = useState("comment");
  const [callPersonIds, setCallPersonIds] = useState([]);
  const [externalNames, setExternalNames] = useState([]);
  const [externalDraft, setExternalDraft] = useState("");
  const [showComposer, setShowComposer] = useState(false);
  const [commentFilter, setCommentFilter] = useState("");
  const [internal, setInternal] = useState(false);
  const [ticketAssets, setTicketAssets] = useState([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [pendingDelete, setPendingDelete] = useState(false);
  const updateKinds = readOnly ? PERSON_UPDATE_KINDS : AGENT_UPDATE_KINDS;
  const companyPeople = useMemo(() => {
    const company = companies.find((row) => row.id === ticket.companyId);
    return company?.people ?? [];
  }, [companies, ticket.companyId]);
  const comments = useMemo(() => {
    const rows = [...(ticket.comments ?? [])].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
    if (!readOnly) return rows;
    return rows.filter((comment) => comment.customerVisible !== false);
  }, [ticket.comments, readOnly]);
  const filteredComments = useMemo(() => {
    const needle = commentFilter.trim().toLowerCase();
    if (!needle) return comments;
    return comments.filter((c) => {
      const names = callParticipantNames(c, companyPeople).join(" ");
      const assetText = c.asset ? assetSearchText(c.asset) : "";
      return (
        c.author.toLowerCase().includes(needle) ||
        (c.kind || "comment").toLowerCase().includes(needle) ||
        names.toLowerCase().includes(needle) ||
        assetText.includes(needle) ||
        c.body.toLowerCase().includes(needle)
      );
    });
  }, [comments, commentFilter, companyPeople]);
  const showCommentFilter = comments.length > 1;

  function resetComposer() {
    setBody("");
    setKind("comment");
    setInternal(false);
    setCallPersonIds(ticket.personId ? [ticket.personId] : []);
    setExternalNames([]);
    setExternalDraft("");
    setSelectedAssetId("");
    setShowComposer(false);
  }

  useEffect(() => {
    setCommentFilter("");
    resetComposer();
  }, [ticket.id]);

  useEffect(() => {
    let cancelled = false;
    setAssetsLoading(true);
    fetchTicketAssets(ticket.id)
      .then((rows) => {
        if (!cancelled) setTicketAssets(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setTicketAssets([]);
      })
      .finally(() => {
        if (!cancelled) setAssetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticket.id]);

  function handleComment(e) {
    e.preventDefault();
    if (kind === "asset") {
      if (!selectedAssetId) return;
    } else if (kind !== "call" && notesIsEmpty(body)) {
      return;
    }
    onComment({
      body,
      kind,
      ...(readOnly ? {} : { customerVisible: !internal }),
      ...(kind === "call"
        ? {
            callParticipants: {
              personIds: callPersonIds,
              externalNames,
            },
          }
        : {}),
      ...(kind === "asset" ? { assetId: selectedAssetId } : {}),
    });
    resetComposer();
  }

  function addCallPerson(personId) {
    if (!personId || callPersonIds.includes(personId)) return;
    setCallPersonIds((current) => [...current, personId]);
  }

  function removeCallPerson(personId) {
    setCallPersonIds((current) => current.filter((id) => id !== personId));
  }

  function addExternalName(raw = externalDraft) {
    const name = String(raw).trim();
    if (!name) return;
    const exists = externalNames.some(
      (entry) => entry.toLowerCase() === name.toLowerCase()
    );
    if (!exists) setExternalNames((current) => [...current, name]);
    setExternalDraft("");
  }

  function removeExternalName(name) {
    setExternalNames((current) => current.filter((entry) => entry !== name));
  }

  async function confirmDeleteTicket() {
    if (!onDelete) return;
    try {
      await onDelete(ticket.id);
    } catch {
      // parent surfaces error
    }
  }

  return (
    <section className="panel ticket-detail">
      <div className="panel-head ticket-detail-head">
        <div className="ticket-detail-top">
          <button
            type="button"
            className="btn ghost compact customer-back"
            onClick={onBack}
          >
            ← Tickets
          </button>
          <div className="ticket-head-fields">
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
        </div>
        <div className="ticket-detail-intro">
          <h1>{ticket.title}</h1>
          <div className="ticket-detail-who">
            {!readOnly && ticket.company ? (
              <CompanyRef company={ticket.company} size="sm" />
            ) : null}
            <PersonRef
              person={ticket.person}
              size="sm"
              className="ticket-created-person"
            />
          </div>
          <p className="ticket-created-line">
            Ticket <span className="ticket-id">{ticket.id.slice(0, 8)}</span>
            {" · "}
            {formatCreatedOn(ticket.createdAt)}
          </p>
        </div>
      </div>

      <div className={`detail-main${showComposer ? " is-composing" : ""}`}>
          {!showComposer && (
            <div className="description-block">
              <h2>Description</h2>
              <NotesContent text={ticket.description} />
            </div>
          )}

          <div className={`comments${showComposer ? " is-composing" : ""}`}>
            {!showComposer && (
              <>
            <h2>
              Updates ({filteredComments.length}
              {commentFilter.trim() ? ` of ${comments.length}` : ""})
            </h2>
              <div className="comments-toolbar">
                {showCommentFilter ? (
                  <div className="comment-filter">
                    <label className="comment-filter-field">
                      <span className="sr-only">Filter updates</span>
                      <input
                        type="search"
                        value={commentFilter}
                        onChange={(e) => setCommentFilter(e.target.value)}
                        placeholder="Filter updates…"
                      />
                    </label>
                    {commentFilter && (
                      <button
                        type="button"
                        className="btn compact"
                        onClick={() => setCommentFilter("")}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                ) : (
                  <span className="comments-toolbar-spacer" />
                )}
                <button
                  type="button"
                  className="btn ghost compact comment-compose-btn"
                  onClick={() => setShowComposer(true)}
                >
                  Add an update
                </button>
              </div>
              </>
            )}
            {showComposer ? (
              <form className="form comment-form comment-form-overlay" onSubmit={handleComment}>
                <div className="form-field">
                  <div className="update-compose-head">
                    <span className="comment-heading">
                      Update below as {agentName}
                    </span>
                    <label className="update-kind-field">
                      <span className="sr-only">Update type</span>
                      <select
                        value={kind}
                        onChange={(e) => setKind(e.target.value)}
                        disabled={saving}
                      >
                        {updateKinds.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {kind === "call" && (
                    <div className="call-participants">
                      <span className="call-participants-label">On the call</span>
                      {(callPersonIds.length > 0 || externalNames.length > 0) && (
                        <ul className="call-chip-list">
                          {callPersonIds.map((personId) => {
                            const person = companyPeople.find(
                              (row) => row.id === personId
                            );
                            return (
                              <li key={personId} className="call-chip">
                                {person?.name || "Unknown person"}
                                <button
                                  type="button"
                                  className="call-chip-remove"
                                  aria-label={`Remove ${person?.name || "person"}`}
                                  onClick={() => removeCallPerson(personId)}
                                >
                                  ×
                                </button>
                              </li>
                            );
                          })}
                          {externalNames.map((name) => (
                            <li key={`ext-${name}`} className="call-chip">
                              {name}
                              <button
                                type="button"
                                className="call-chip-remove"
                                aria-label={`Remove ${name}`}
                                onClick={() => removeExternalName(name)}
                              >
                                ×
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="call-add-row">
                        <select
                          value=""
                          disabled={saving}
                          onChange={(e) => {
                            addCallPerson(e.target.value);
                            e.target.value = "";
                          }}
                        >
                          <option value="">Add a person</option>
                          {companyPeople
                            .filter((person) => !callPersonIds.includes(person.id))
                            .map((person) => (
                              <option key={person.id} value={person.id}>
                                {person.name}
                              </option>
                            ))}
                        </select>
                        <input
                          value={externalDraft}
                          disabled={saving}
                          placeholder="Or type a name"
                          onChange={(e) => setExternalDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addExternalName(e.currentTarget.value);
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="btn compact"
                          disabled={saving || !externalDraft.trim()}
                          onClick={() => addExternalName()}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  )}
                  {kind === "asset" && (
                    <TicketAssetPicker
                      assets={ticketAssets}
                      loading={assetsLoading}
                      selectedId={selectedAssetId}
                      onSelect={setSelectedAssetId}
                      disabled={saving}
                    />
                  )}
                  <NotesField
                    required={kind !== "asset" && kind !== "call"}
                    rows={4}
                    value={body}
                    onChange={setBody}
                    disabled={saving}
                    placeholder={
                      kind === "close"
                        ? "Note why this ticket is being closed…"
                        : kind === "call"
                          ? "Summarize the call (optional)…"
                          : kind === "asset"
                            ? "Add a comment (optional)…"
                            : readOnly
                              ? "Ask a question or add more details…"
                              : "Update the customer or note what you tried…"
                    }
                  />
                  <div className="form-actions comment-form-actions">
                    {!readOnly && (
                      <label className="internal-check" title="Don't show this update to the customer">
                        <input
                          type="checkbox"
                          checked={internal}
                          onChange={(e) => setInternal(e.target.checked)}
                          disabled={saving}
                        />
                        Internal
                      </label>
                    )}
                    <div className="comment-form-buttons">
                      <CancelIconButton
                        className="tooltip-top"
                        disabled={saving}
                        onClick={() => {
                          resetComposer();
                        }}
                      />
                      <button
                        type="submit"
                        className="btn primary"
                        disabled={saving || (kind === "asset" && !selectedAssetId)}
                      >
                        {saving ? "Posting…" : "Post update"}
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            ) : comments.length === 0 ? (
              <p className="muted">No updates yet.</p>
            ) : filteredComments.length === 0 ? (
              <p className="muted">No updates match this filter.</p>
            ) : (
              <ul className="comment-list">
                {filteredComments.map((c) => (
                  <li key={c.id} className="comment">
                    <div className="comment-meta">
                      <span className="muted">{formatDate(c.createdAt)}</span>
                      {" "}
                      <strong>{c.author}</strong>
                      {" "}
                      {c.kind === "call"
                        ? `had a call${
                            callParticipantNames(c, companyPeople).length
                              ? ` with ${formatNameList(
                                  callParticipantNames(c, companyPeople)
                                )}`
                              : ""
                          }`
                        : isFieldChangeUpdate(c.kind)
                          ? fieldChangePhrase(c)
                          : updateKindPhrase(c.kind)}
                      {!readOnly && c.customerVisible === false && (
                        <span className="update-internal-tag">Internal</span>
                      )}
                    </div>
                    {isFieldChangeUpdate(c.kind) ? null : (
                      <>
                        {c.kind === "asset" ? <CommentAssetCard asset={c.asset} /> : null}
                        {(c.kind === "asset" || c.kind === "call") &&
                        notesIsEmpty(c.body) ? null : (
                          <NotesContent text={c.body} />
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        {onDelete ? (
          <div className="ticket-detail-footer">
            <button
              type="button"
              className="btn icon-remove"
              disabled={saving}
              aria-label="Delete ticket"
              data-tooltip="Delete ticket"
              onClick={() => setPendingDelete(true)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  fill="currentColor"
                  d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7a1 1 0 0 0-1.4 1.4L10.6 12l-4.9 4.9a1 1 0 1 0 1.4 1.4L12 13.4l4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4Z"
                />
              </svg>
            </button>
          </div>
        ) : null}
        {pendingDelete ? (
          <div
            className="confirm-backdrop"
            role="presentation"
            onClick={() => !saving && setPendingDelete(false)}
          >
            <div
              className="confirm-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="delete-ticket-title"
              aria-describedby="delete-ticket-desc"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="delete-ticket-title">Are you sure?</h2>
              <p id="delete-ticket-desc">
                Delete <strong>{ticket.title}</strong> and all of its updates?
                This cannot be undone.
              </p>
              <div className="form-actions">
                <CancelIconButton
                  disabled={saving}
                  onClick={() => setPendingDelete(false)}
                />
                <button
                  type="button"
                  className="btn danger-solid"
                  disabled={saving}
                  onClick={confirmDeleteTicket}
                >
                  {saving ? "Deleting…" : "Yes, delete"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
    </section>
  );
}

export default App;
