import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v4 as uuidv4 } from "uuid";
import {
  createSession,
  destroySession,
  destroySessionsForAgent,
  getBearerToken,
  hashPassword,
  requireAgent,
  requireAuth,
  verifyPassword,
} from "./auth.js";
import {
  DEFAULT_AGENT,
  PRIORITIES,
  SQLITE_PATH,
  STATUSES,
  enrichTicket,
  findCompany,
  findPerson,
  findPersonByEmail,
  publicAgent,
  publicCompany,
  publicPerson,
  publicPortalPerson,
  ensureReady,
  readDb,
  writeDb,
  listManufacturers,
  findManufacturerById,
  findManufacturerByName,
  insertManufacturer,
  updateManufacturerRecord,
  removeManufacturer,
  listAssetTypes,
  findAssetTypeById,
  findAssetTypeByName,
  insertAssetType,
  updateAssetTypeRecord,
  removeAssetType,
  listCompanyAssets,
  findAssetById,
  commentAssetSnapshot,
  findAssetByNumber,
  insertAsset,
  updateAssetRecord,
  removeAsset,
  removeAssetsForCompany,
  listCompanyLocations,
  findLocationById,
  insertLocation,
  updateLocationRecord,
  removeLocation,
  removeLocationsForCompany,
  countAssetsByCompany,
  countLocationsByCompany,
  removeCompany,
} from "./db.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PERSON_IMAGE_MAX = 2_000_000;
const PERSON_IMAGE_RE = /^data:image\/(jpeg|jpg|png|gif|webp);base64,/i;
const NOTES_BODY_MAX = 8_000_000;

function notesBodyTooLarge(value) {
  return typeof value === "string" && value.length > NOTES_BODY_MAX;
}

function normalizePersonImage(image) {
  if (image === undefined) return undefined;
  if (image === null || image === "") return "";
  if (typeof image !== "string") return null;
  if (!PERSON_IMAGE_RE.test(image)) return null;
  if (image.length > PERSON_IMAGE_MAX) return null;
  return image;
}

function normalizePersonPhone(phone) {
  if (phone === undefined) return undefined;
  if (phone === null || phone === "") return "";
  return String(phone).trim();
}

function assignedPersonIdForCompany(company, personId) {
  if (personId === undefined) return { ok: true };
  if (personId === null || personId === "") return { ok: true, personId: "" };
  const person = findPerson(company, personId);
  if (!person) return { ok: false };
  return { ok: true, personId: person.id };
}

async function assignedLocationIdForCompany(companyId, locationId) {
  if (locationId === undefined) return { ok: true };
  if (locationId === null || locationId === "") return { ok: true, locationId: "" };
  const location = await findLocationById(companyId, locationId);
  if (!location) return { ok: false };
  return { ok: true, locationId: location.id };
}

const STOCK_UA = "HelpDesk/1.0 (asset type stock images)";
const UPDATE_KINDS = ["comment", "call", "close", "asset"];
const PERSON_UPDATE_KINDS = ["comment", "close", "asset"];

function normalizeUpdateKind(kind, role) {
  const value = String(kind ?? "comment").trim().toLowerCase() || "comment";
  const allowed = role === "person" ? PERSON_UPDATE_KINDS : UPDATE_KINDS;
  if (!allowed.includes(value)) return null;
  return value;
}

const STATUS_LABELS = {
  open: "Open",
  in_progress: "In progress",
  on_hold: "On hold",
  closed: "Closed",
};

const PRIORITY_LABELS = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

function labelTicketStatus(status) {
  return STATUS_LABELS[status] || String(status).replaceAll("_", " ");
}

function labelTicketPriority(priority) {
  return PRIORITY_LABELS[priority] || String(priority);
}

function fieldChangeComment(agent, kind, body, customerVisible = false) {
  return {
    id: uuidv4(),
    author: agent.name,
    agentId: agent.id,
    kind,
    body,
    customerVisible,
    createdAt: new Date().toISOString(),
  };
}

function mineFilterMode(mine) {
  if (mine === undefined || mine === null || mine === "") return "all";
  const value = String(mine).trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes") return "only";
  if (value === "0" || value === "false" || value === "no") return "exclude";
  return "all";
}

function ticketCreatedByCurrentUser(ticket, req) {
  if (req.role === "agent") {
    return ticket.creatorAgentId === req.agent.id;
  }
  if (req.role === "person") {
    if (ticket.creatorPersonId === req.person.id) return true;
    if (!ticket.creatorAgentId && !ticket.creatorPersonId) {
      return ticket.personId === req.person.id;
    }
  }
  return false;
}

function ticketVisibleToPerson(ticket, req, db) {
  const companyId = String(req.person?.companyId || "");
  if (!companyId) return false;
  const ticketCompany = String(ticket.companyId || ticket.company?.id || "");
  if (ticketCompany !== companyId) return false;
  const company = findCompany(db, companyId);
  return Boolean(findPerson(company, ticket.personId));
}

function parseExternalNames(value) {
  if (Array.isArray(value)) {
    return value.map((name) => String(name).trim()).filter(Boolean);
  }
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function callParticipantsForTicket(ticket, company, payload) {
  const personIds = Array.isArray(payload?.personIds)
    ? [...new Set(payload.personIds.map(String).filter(Boolean))]
    : [];
  const peopleById = new Map((company?.people ?? []).map((person) => [person.id, person]));
  const people = personIds
    .map((id) => peopleById.get(id))
    .filter(Boolean)
    .map((person) => ({ id: person.id, name: person.name }));
  return {
    personIds: people.map((person) => person.id),
    people,
    externalNames: parseExternalNames(payload?.externalNames),
  };
}

async function fetchJsonUrl(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": STOCK_UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`search failed (${res.status})`);
  }
  return res.json();
}

async function downloadStockImage(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": STOCK_UA },
    signal: AbortSignal.timeout(10000),
    redirect: "follow",
  });
  if (!res.ok) return null;
  const mime = (res.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!/^image\/(jpeg|jpg|png|gif|webp)$/.test(mime)) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 800 || buf.length > 1_500_000) return null;
  const normalizedMime = mime === "image/jpg" ? "image/jpeg" : mime;
  const dataUrl = `data:${normalizedMime};base64,${buf.toString("base64")}`;
  if (dataUrl.length > PERSON_IMAGE_MAX) return null;
  return dataUrl;
}

async function stockImageUrlsFor(query) {
  const urls = [];
  try {
    const data = await fetchJsonUrl(
      `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=20&mature=false`
    );
    for (const result of data.results ?? []) {
      urls.push(result.thumbnail || result.url);
    }
  } catch {
    // try Wikipedia next
  }
  try {
    const data = await fetchJsonUrl(
      `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=10&prop=pageimages&pithumbsize=480&format=json`
    );
    for (const page of Object.values(data.query?.pages ?? {})) {
      if (page.thumbnail?.source) urls.push(page.thumbnail.source);
    }
  } catch {
    // ignore
  }
  return [...new Set(urls)];
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email?.trim() || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const db = await readDb();
  const normalizedEmail = email.trim().toLowerCase();
  const agent = db.agents.find((a) => a.email.toLowerCase() === normalizedEmail);

  if (agent) {
    if (!verifyPassword(password, agent.passwordHash)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const token = await createSession({ agentId: agent.id });
    return res.json({ token, role: "agent", agent: publicAgent(agent) });
  }

  const match = findPersonByEmail(db, normalizedEmail);
  if (!match || !verifyPassword(password, match.person.passwordHash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = await createSession({ personId: match.person.id });
  res.json({
    token,
    role: "person",
    person: publicPortalPerson(match.person, match.company),
  });
});

app.post("/api/auth/logout", async (req, res) => {
  const token = getBearerToken(req);
  if (token) {
    await destroySession(token);
  }
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  if (req.role === "person") {
    return res.json({ role: "person", person: req.person });
  }
  res.json({ role: "agent", agent: req.agent });
});

app.use("/api", (req, res, next) => {
  if (req.path === "/health" || req.path === "/auth/login") {
    return next();
  }
  if (req.path === "/auth/logout" || req.path === "/auth/me") {
    return next();
  }
  return requireAuth(req, res, next);
});

app.get("/api/stock-image", requireAgent, async (req, res) => {
  const query = String(req.query.q ?? "").trim();
  if (!query) {
    return res.status(400).json({ error: "a name is required to find a stock image" });
  }

  const skip = Math.max(0, Number.parseInt(String(req.query.skip ?? "0"), 10) || 0);

  try {
    const urls = await stockImageUrlsFor(query);
    const candidates = [];
    for (const url of urls) {
      const image = await downloadStockImage(url);
      if (!image) continue;
      candidates.push({ image, source: url });
      if (skip === 0) {
        return res.json(candidates[0]);
      }
      if (candidates.length > skip) {
        return res.json(candidates[skip]);
      }
    }
    if (!candidates.length) {
      return res.status(404).json({ error: "No stock image found for that name" });
    }
    if (candidates.length === 1 && skip > 0) {
      return res.status(404).json({
        error: "No other stock image found for that name",
      });
    }
    return res.json(candidates[skip % candidates.length]);
  } catch (err) {
    return res.status(502).json({
      error: err.message || "Could not search stock images",
    });
  }
});

app.get("/api/agents", requireAgent, async (_req, res) => {
  const { agents } = await readDb();
  const sorted = [...agents]
    .map(publicAgent)
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json(sorted);
});

app.post("/api/agents", requireAgent, async (req, res) => {
  const { name, email, phone, password } = req.body ?? {};

  if (!name?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ error: "name, email, and password are required" });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ error: "password must be at least 6 characters" });
  }

  const db = await readDb();
  const normalizedEmail = email.trim().toLowerCase();
  if (db.agents.some((a) => a.email.toLowerCase() === normalizedEmail)) {
    return res.status(409).json({ error: "An agent with that email already exists" });
  }

  const normalizedPhone = normalizePersonPhone(phone) ?? "";
  const now = new Date().toISOString();
  const agent = {
    id: uuidv4(),
    name: name.trim(),
    email: normalizedEmail,
    ...(normalizedPhone ? { phone: normalizedPhone } : {}),
    passwordHash: hashPassword(password),
    createdAt: now,
    updatedAt: now,
  };

  db.agents.push(agent);
  await writeDb(db);

  res.status(201).json(publicAgent(agent));
});

app.patch("/api/agents/:id", requireAgent, async (req, res) => {
  const db = await readDb();
  const index = db.agents.findIndex((a) => a.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: "Agent not found" });
  }

  const { name, email, phone, password } = req.body ?? {};
  const agent = db.agents[index];

  if (name !== undefined) {
    if (!name?.trim()) {
      return res.status(400).json({ error: "name cannot be empty" });
    }
    agent.name = name.trim();
  }

  if (email !== undefined) {
    if (!email?.trim()) {
      return res.status(400).json({ error: "email cannot be empty" });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const taken = db.agents.some(
      (a, i) => i !== index && a.email.toLowerCase() === normalizedEmail
    );
    if (taken) {
      return res.status(409).json({ error: "An agent with that email already exists" });
    }
    agent.email = normalizedEmail;
  }

  if (phone !== undefined) {
    const normalizedPhone = normalizePersonPhone(phone) ?? "";
    if (normalizedPhone) {
      agent.phone = normalizedPhone;
    } else {
      delete agent.phone;
    }
  }

  if (password !== undefined && password !== "") {
    if (String(password).length < 6) {
      return res.status(400).json({ error: "password must be at least 6 characters" });
    }
    agent.passwordHash = hashPassword(password);
    await destroySessionsForAgent(agent.id);
  }

  agent.updatedAt = new Date().toISOString();
  db.agents[index] = agent;
  await writeDb(db);

  res.json(publicAgent(agent));
});

app.delete("/api/agents/:id", requireAgent, async (req, res) => {
  const db = await readDb();
  const index = db.agents.findIndex((a) => a.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: "Agent not found" });
  }

  if (db.agents.length <= 1) {
    return res.status(400).json({ error: "Cannot remove the last support agent" });
  }

  const [removed] = db.agents.splice(index, 1);
  db.sessions = db.sessions.filter((s) => s.agentId !== removed.id);
  await writeDb(db);

  res.json({ ok: true });
});

function publicManufacturer(row) {
  if (!row) return row;
  const image = row.image || "";
  return { ...row, image, logo: image };
}

app.get("/api/manufacturers", requireAgent, async (_req, res) => {
  const rows = await listManufacturers();
  res.json(rows.map(publicManufacturer));
});

app.post("/api/manufacturers", requireAgent, async (req, res) => {
  const { name, details = "" } = req.body ?? {};
  const image = req.body?.logo ?? req.body?.image;

  if (!name?.trim()) {
    return res.status(400).json({ error: "name is required" });
  }

  if (notesBodyTooLarge(details)) {
    return res.status(400).json({ error: "details is too large" });
  }

  const normalizedImage = normalizePersonImage(image);
  if (image !== undefined && image !== "" && normalizedImage === null) {
    return res.status(400).json({
      error: "logo must be a jpeg, png, gif, or webp under 1.5MB",
    });
  }

  const normalizedName = name.trim();
  const duplicate = await findManufacturerByName(normalizedName);
  if (duplicate) {
    return res.status(409).json({
      error: "A manufacturer with that name already exists",
    });
  }

  const now = new Date().toISOString();
  const manufacturer = await insertManufacturer({
    id: uuidv4(),
    name: normalizedName,
    details: String(details ?? "").trim(),
    image: normalizedImage || "",
    createdAt: now,
    updatedAt: now,
  });

  res.status(201).json(publicManufacturer(manufacturer));
});

app.patch("/api/manufacturers/:id", requireAgent, async (req, res) => {
  const current = await findManufacturerById(req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Manufacturer not found" });
  }

  const { name, details } = req.body ?? {};
  const image = req.body?.logo !== undefined ? req.body.logo : req.body?.image;
  const fields = {};

  if (name !== undefined) {
    if (!String(name).trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    const normalizedName = String(name).trim();
    const duplicate = await findManufacturerByName(normalizedName);
    if (duplicate && duplicate.id !== current.id) {
      return res.status(409).json({
        error: "A manufacturer with that name already exists",
      });
    }
    fields.name = normalizedName;
  }

  if (details !== undefined) {
    if (notesBodyTooLarge(details)) {
      return res.status(400).json({ error: "details is too large" });
    }
    fields.details = String(details ?? "").trim();
  }

  if (image !== undefined) {
    if (image === null || image === "") {
      fields.image = "";
    } else {
      const normalizedImage = normalizePersonImage(image);
      if (normalizedImage === null) {
        return res.status(400).json({
          error: "logo must be a jpeg, png, gif, or webp under 1.5MB",
        });
      }
      fields.image = normalizedImage;
    }
  }

  const updated = await updateManufacturerRecord(current.id, fields);
  res.json(publicManufacturer(updated));
});

app.delete("/api/manufacturers/:id", requireAgent, async (req, res) => {
  const removed = await removeManufacturer(req.params.id);
  if (!removed) {
    return res.status(404).json({ error: "Manufacturer not found" });
  }
  res.json({ ok: true });
});

app.get("/api/asset-types", requireAgent, async (_req, res) => {
  res.json(await listAssetTypes());
});

app.post("/api/asset-types", requireAgent, async (req, res) => {
  const { name, details = "", image } = req.body ?? {};

  if (!name?.trim()) {
    return res.status(400).json({ error: "name is required" });
  }

  if (notesBodyTooLarge(details)) {
    return res.status(400).json({ error: "details is too large" });
  }

  const normalizedImage = normalizePersonImage(image);
  if (image !== undefined && normalizedImage === null) {
    return res.status(400).json({
      error: "image must be a jpeg, png, gif, or webp under 1.5MB",
    });
  }

  const normalizedName = name.trim();
  const duplicate = await findAssetTypeByName(normalizedName);
  if (duplicate) {
    return res.status(409).json({
      error: "An asset type with that name already exists",
    });
  }

  const now = new Date().toISOString();
  const assetType = await insertAssetType({
    id: uuidv4(),
    name: normalizedName,
    details: String(details ?? "").trim(),
    image: normalizedImage || "",
    createdAt: now,
    updatedAt: now,
  });

  res.status(201).json(assetType);
});

app.patch("/api/asset-types/:id", requireAgent, async (req, res) => {
  const current = await findAssetTypeById(req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Asset type not found" });
  }

  const { name, details, image } = req.body ?? {};
  const fields = {};

  if (name !== undefined) {
    if (!String(name).trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    const normalizedName = String(name).trim();
    const duplicate = await findAssetTypeByName(normalizedName);
    if (duplicate && duplicate.id !== current.id) {
      return res.status(409).json({
        error: "An asset type with that name already exists",
      });
    }
    fields.name = normalizedName;
  }

  if (details !== undefined) {
    if (notesBodyTooLarge(details)) {
      return res.status(400).json({ error: "details is too large" });
    }
    fields.details = String(details ?? "").trim();
  }

  if (image !== undefined) {
    const normalizedImage = normalizePersonImage(image);
    if (normalizedImage === null) {
      return res.status(400).json({
        error: "image must be a jpeg, png, gif, or webp under 1.5MB",
      });
    }
    fields.image = normalizedImage;
  }

  const updated = await updateAssetTypeRecord(current.id, fields);
  res.json(updated);
});

app.delete("/api/asset-types/:id", requireAgent, async (req, res) => {
  const removed = await removeAssetType(req.params.id);
  if (!removed) {
    return res.status(404).json({ error: "Asset type not found" });
  }
  res.json({ ok: true });
});

app.get("/api/companies", requireAgent, async (_req, res) => {
  const { companies } = await readDb();
  const assetCounts = await countAssetsByCompany();
  const locationCounts = await countLocationsByCompany();
  const sorted = [...companies]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((company) => ({
      ...publicCompany(company),
      assetCount: assetCounts[company.id] || 0,
      locationCount: locationCounts[company.id] || 0,
    }));
  res.json(sorted);
});

app.get("/api/companies/:id", requireAgent, async (req, res) => {
  const company = findCompany(await readDb(), req.params.id);
  if (!company) {
    return res.status(404).json({ error: "Company not found" });
  }
  res.json(publicCompany(company));
});

app.post("/api/companies", requireAgent, async (req, res) => {
  const { name, details = "", people = [], image } = req.body ?? {};

  if (!name?.trim()) {
    return res.status(400).json({ error: "name is required" });
  }

  if (notesBodyTooLarge(details)) {
    return res.status(400).json({ error: "details is too large" });
  }

  if (!Array.isArray(people)) {
    return res.status(400).json({ error: "people must be an array" });
  }

  const companyImage = normalizePersonImage(image);
  if (companyImage === null) {
    return res.status(400).json({
      error: "company image must be a jpeg, png, gif, or webp under 1.5MB",
    });
  }

  const parsedPeople = [];
  for (const person of people) {
    if (!person?.name?.trim() || !person?.email?.trim() || !person?.password) {
      return res.status(400).json({
        error: "each person requires name, email, and password",
      });
    }
    if (String(person.password).length < 6) {
      return res.status(400).json({ error: "password must be at least 6 characters" });
    }
    const personImage = normalizePersonImage(person.image);
    if (personImage === null) {
      return res.status(400).json({
        error: "person image must be a jpeg, png, gif, or webp under 1.5MB",
      });
    }
    const personPhone = normalizePersonPhone(person.phone) ?? "";
    parsedPeople.push({
      id: uuidv4(),
      name: person.name.trim(),
      email: person.email.trim().toLowerCase(),
      passwordHash: hashPassword(person.password),
      ...(personPhone ? { phone: personPhone } : {}),
      ...(personImage ? { image: personImage } : {}),
    });
  }

  const db = await readDb();
  const normalizedName = name.trim();
  const duplicate = db.companies.find(
    (c) => c.name.toLowerCase() === normalizedName.toLowerCase()
  );
  if (duplicate) {
    return res.status(409).json({ error: "A company with that name already exists" });
  }

  const company = {
    id: uuidv4(),
    name: normalizedName,
    details: String(details ?? "").trim(),
    people: parsedPeople,
    ...(companyImage ? { image: companyImage } : {}),
  };

  db.companies.push(company);
  await writeDb(db);

  res.status(201).json(publicCompany(company));
});

app.patch("/api/companies/:id", requireAgent, async (req, res) => {
  const db = await readDb();
  const index = db.companies.findIndex((c) => c.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: "Company not found" });
  }

  const { name, details, image } = req.body ?? {};
  const company = db.companies[index];

  if (name !== undefined) {
    if (!name?.trim()) {
      return res.status(400).json({ error: "name cannot be empty" });
    }
    const normalizedName = name.trim();
    const duplicate = db.companies.find(
      (c, i) => i !== index && c.name.toLowerCase() === normalizedName.toLowerCase()
    );
    if (duplicate) {
      return res.status(409).json({ error: "A company with that name already exists" });
    }
    company.name = normalizedName;
  }

  if (details !== undefined) {
    if (notesBodyTooLarge(details)) {
      return res.status(400).json({ error: "details is too large" });
    }
    company.details = String(details).trim();
  }

  if (image !== undefined) {
    const normalizedImage = normalizePersonImage(image);
    if (normalizedImage === null) {
      return res.status(400).json({
        error: "image must be a jpeg, png, gif, or webp under 1.5MB",
      });
    }
    if (normalizedImage) {
      company.image = normalizedImage;
    } else {
      delete company.image;
    }
  }

  db.companies[index] = company;
  await writeDb(db);

  res.json(publicCompany(company));
});

app.post("/api/companies/:id/people", requireAgent, async (req, res) => {
  const { name, email, phone, image, password, locationId } = req.body ?? {};

  if (!name?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ error: "name, email, and password are required" });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: "password must be at least 6 characters" });
  }

  const normalizedImage = normalizePersonImage(image);
  if (normalizedImage === null) {
    return res.status(400).json({
      error: "image must be a jpeg, png, gif, or webp under 1.5MB",
    });
  }
  const normalizedPhone = normalizePersonPhone(phone) ?? "";

  const db = await readDb();
  const index = db.companies.findIndex((c) => c.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: "Company not found" });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const exists = db.companies[index].people.some(
    (p) => p.email.toLowerCase() === normalizedEmail
  );
  if (exists) {
    return res
      .status(409)
      .json({ error: "A person with that email is already registered at this company" });
  }

  const assignedLocation = await assignedLocationIdForCompany(req.params.id, locationId);
  if (!assignedLocation.ok) {
    return res.status(400).json({
      error: "Location must belong to this customer",
    });
  }

  const person = {
    id: uuidv4(),
    name: name.trim(),
    email: normalizedEmail,
    passwordHash: hashPassword(password),
    ...(normalizedPhone ? { phone: normalizedPhone } : {}),
    ...(normalizedImage ? { image: normalizedImage } : {}),
    ...(assignedLocation.locationId ? { locationId: assignedLocation.locationId } : {}),
  };

  db.companies[index].people.push(person);
  await writeDb(db);

  res.status(201).json(publicPerson(person));
});

app.patch("/api/companies/:companyId/people/:personId", requireAgent, async (req, res) => {
  const { name, email, phone, image, password, locationId } = req.body ?? {};
  const db = await readDb();
  const companyIndex = db.companies.findIndex((c) => c.id === req.params.companyId);
  if (companyIndex === -1) {
    return res.status(404).json({ error: "Company not found" });
  }

  const people = db.companies[companyIndex].people;
  const personIndex = people.findIndex((p) => p.id === req.params.personId);
  if (personIndex === -1) {
    return res.status(404).json({ error: "Person not found" });
  }

  const person = people[personIndex];

  if (name !== undefined) {
    if (!name?.trim()) {
      return res.status(400).json({ error: "name cannot be empty" });
    }
    person.name = name.trim();
  }

  if (email !== undefined) {
    if (!email?.trim()) {
      return res.status(400).json({ error: "email cannot be empty" });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const taken = people.some(
      (p, i) => i !== personIndex && p.email.toLowerCase() === normalizedEmail
    );
    if (taken) {
      return res
        .status(409)
        .json({ error: "A person with that email is already registered at this company" });
    }
    person.email = normalizedEmail;
  }

  if (phone !== undefined) {
    const normalizedPhone = normalizePersonPhone(phone) ?? "";
    if (normalizedPhone) {
      person.phone = normalizedPhone;
    } else {
      delete person.phone;
    }
  }

  if (image !== undefined) {
    const normalizedImage = normalizePersonImage(image);
    if (normalizedImage === null) {
      return res.status(400).json({
        error: "image must be a jpeg, png, gif, or webp under 1.5MB",
      });
    }
    if (normalizedImage) {
      person.image = normalizedImage;
    } else {
      delete person.image;
    }
  }

  if (password !== undefined && password !== "") {
    if (String(password).length < 6) {
      return res.status(400).json({ error: "password must be at least 6 characters" });
    }
    person.passwordHash = hashPassword(password);
  }

  if (locationId !== undefined) {
    const assignedLocation = await assignedLocationIdForCompany(
      req.params.companyId,
      locationId
    );
    if (!assignedLocation.ok) {
      return res.status(400).json({
        error: "Location must belong to this customer",
      });
    }
    if (assignedLocation.locationId) {
      person.locationId = assignedLocation.locationId;
    } else {
      delete person.locationId;
    }
  }

  people[personIndex] = person;
  db.companies[companyIndex].people = people;
  await writeDb(db);

  res.json(publicPerson(person));
});

app.delete("/api/companies/:companyId/people/:personId", requireAgent, async (req, res) => {
  const db = await readDb();
  const companyIndex = db.companies.findIndex((c) => c.id === req.params.companyId);
  if (companyIndex === -1) {
    return res.status(404).json({ error: "Company not found" });
  }

  const people = db.companies[companyIndex].people;
  const personIndex = people.findIndex((p) => p.id === req.params.personId);
  if (personIndex === -1) {
    return res.status(404).json({ error: "Person not found" });
  }

  const [removed] = people.splice(personIndex, 1);
  db.companies[companyIndex].people = people;
  db.sessions = db.sessions.filter((s) => s.personId !== removed.id);
  const removedTickets = db.tickets.filter((t) => t.personId === removed.id);
  db.tickets = db.tickets.filter((t) => t.personId !== removed.id);
  await writeDb(db);

  res.json({
    ok: true,
    deletedTickets: removedTickets.length,
  });
});

app.get("/api/companies/:id/assets", requireAgent, async (req, res) => {
  const company = findCompany(await readDb(), req.params.id);
  if (!company) {
    return res.status(404).json({ error: "Company not found" });
  }
  res.json(await listCompanyAssets(req.params.id));
});

app.post("/api/companies/:id/assets", requireAgent, async (req, res) => {
  const company = findCompany(await readDb(), req.params.id);
  if (!company) {
    return res.status(404).json({ error: "Company not found" });
  }

  const { name, assetNumber, manufacturerId, assetTypeId, image, personId, locationId } =
    req.body ?? {};
  if (!name?.trim() || !String(assetNumber ?? "").trim() || !manufacturerId || !assetTypeId) {
    return res.status(400).json({
      error: "model number, asset number, manufacturer, and asset type are required",
    });
  }

  const normalizedImage = normalizePersonImage(image);
  if (normalizedImage === null) {
    return res.status(400).json({
      error: "image must be a jpeg, png, gif, or webp under 1.5MB",
    });
  }

  const manufacturer = await findManufacturerById(manufacturerId);
  if (!manufacturer) {
    return res.status(400).json({ error: "Manufacturer not found" });
  }
  const assetType = await findAssetTypeById(assetTypeId);
  if (!assetType) {
    return res.status(400).json({ error: "Asset type not found" });
  }

  const assigned = assignedPersonIdForCompany(company, personId);
  if (!assigned.ok) {
    return res.status(400).json({
      error: "Assigned person must belong to this customer",
    });
  }

  const assignedLocation = await assignedLocationIdForCompany(company.id, locationId);
  if (!assignedLocation.ok) {
    return res.status(400).json({
      error: "Location must belong to this customer",
    });
  }

  const normalizedNumber = String(assetNumber).trim();
  const duplicate = await findAssetByNumber(company.id, normalizedNumber);
  if (duplicate) {
    return res.status(409).json({
      error: "An asset with that number already exists for this customer",
    });
  }

  const now = new Date().toISOString();
  const asset = await insertAsset({
    id: uuidv4(),
    companyId: company.id,
    name: name.trim(),
    assetNumber: normalizedNumber,
    manufacturerId: manufacturer.id,
    assetTypeId: assetType.id,
    image: normalizedImage || "",
    personId: assigned.personId || "",
    locationId: assignedLocation.locationId || "",
    createdAt: now,
    updatedAt: now,
  });

  res.status(201).json(asset);
});

app.patch("/api/companies/:companyId/assets/:assetId", requireAgent, async (req, res) => {
  const current = await findAssetById(req.params.companyId, req.params.assetId);
  if (!current) {
    return res.status(404).json({ error: "Asset not found" });
  }

  const { name, assetNumber, manufacturerId, assetTypeId, image, personId, locationId } =
    req.body ?? {};
  const fields = {};

  if (name !== undefined) {
    if (!String(name).trim()) {
      return res.status(400).json({ error: "model number is required" });
    }
    fields.name = String(name).trim();
  }

  if (assetNumber !== undefined) {
    if (!String(assetNumber).trim()) {
      return res.status(400).json({ error: "asset number is required" });
    }
    const normalizedNumber = String(assetNumber).trim();
    const duplicate = await findAssetByNumber(
      req.params.companyId,
      normalizedNumber,
      current.id
    );
    if (duplicate) {
      return res.status(409).json({
        error: "An asset with that number already exists for this customer",
      });
    }
    fields.assetNumber = normalizedNumber;
  }

  if (manufacturerId !== undefined) {
    const manufacturer = await findManufacturerById(manufacturerId);
    if (!manufacturer) {
      return res.status(400).json({ error: "Manufacturer not found" });
    }
    fields.manufacturerId = manufacturer.id;
  }

  if (assetTypeId !== undefined) {
    const assetType = await findAssetTypeById(assetTypeId);
    if (!assetType) {
      return res.status(400).json({ error: "Asset type not found" });
    }
    fields.assetTypeId = assetType.id;
  }

  if (image !== undefined) {
    const normalizedImage = normalizePersonImage(image);
    if (normalizedImage === null) {
      return res.status(400).json({
        error: "image must be a jpeg, png, gif, or webp under 1.5MB",
      });
    }
    fields.image = normalizedImage || "";
  }

  if (personId !== undefined) {
    const company = findCompany(await readDb(), req.params.companyId);
    const assigned = assignedPersonIdForCompany(company, personId);
    if (!assigned.ok) {
      return res.status(400).json({
        error: "Assigned person must belong to this customer",
      });
    }
    fields.personId = assigned.personId || "";
  }

  if (locationId !== undefined) {
    const assignedLocation = await assignedLocationIdForCompany(
      req.params.companyId,
      locationId
    );
    if (!assignedLocation.ok) {
      return res.status(400).json({
        error: "Location must belong to this customer",
      });
    }
    fields.locationId = assignedLocation.locationId || "";
  }

  const updated = await updateAssetRecord(
    req.params.companyId,
    req.params.assetId,
    fields
  );
  res.json(updated);
});

app.delete("/api/companies/:companyId/assets/:assetId", requireAgent, async (req, res) => {
  const removed = await removeAsset(req.params.companyId, req.params.assetId);
  if (!removed) {
    return res.status(404).json({ error: "Asset not found" });
  }
  res.json({ ok: true });
});

app.get("/api/companies/:id/locations", requireAgent, async (req, res) => {
  const company = findCompany(await readDb(), req.params.id);
  if (!company) {
    return res.status(404).json({ error: "Company not found" });
  }
  res.json(await listCompanyLocations(req.params.id));
});

app.post("/api/companies/:id/locations", requireAgent, async (req, res) => {
  const company = findCompany(await readDb(), req.params.id);
  if (!company) {
    return res.status(404).json({ error: "Company not found" });
  }

  const { name, address = "", details = "" } = req.body ?? {};
  if (!name?.trim()) {
    return res.status(400).json({ error: "location name is required" });
  }
  if (notesBodyTooLarge(details) || notesBodyTooLarge(address)) {
    return res.status(400).json({ error: "location details are too large" });
  }

  const now = new Date().toISOString();
  const location = await insertLocation({
    id: uuidv4(),
    companyId: company.id,
    name: name.trim(),
    address: String(address ?? "").trim(),
    details: String(details ?? "").trim(),
    createdAt: now,
    updatedAt: now,
  });
  res.status(201).json(location);
});

app.patch("/api/companies/:companyId/locations/:locationId", requireAgent, async (req, res) => {
  const current = await findLocationById(req.params.companyId, req.params.locationId);
  if (!current) {
    return res.status(404).json({ error: "Location not found" });
  }

  const { name, address, details } = req.body ?? {};
  if (name !== undefined && !String(name).trim()) {
    return res.status(400).json({ error: "location name is required" });
  }
  if (notesBodyTooLarge(details) || notesBodyTooLarge(address)) {
    return res.status(400).json({ error: "location details are too large" });
  }

  const updated = await updateLocationRecord(req.params.companyId, req.params.locationId, {
    ...(name !== undefined ? { name: String(name).trim() } : {}),
    ...(address !== undefined ? { address: String(address).trim() } : {}),
    ...(details !== undefined ? { details: String(details).trim() } : {}),
  });
  res.json(updated);
});

app.delete("/api/companies/:companyId/locations/:locationId", requireAgent, async (req, res) => {
  const removed = await removeLocation(req.params.companyId, req.params.locationId);
  if (!removed) {
    return res.status(404).json({ error: "Location not found" });
  }
  res.json({ ok: true });
});

app.delete("/api/companies/:id", requireAgent, async (req, res) => {
  const db = await readDb();
  const index = db.companies.findIndex((c) => c.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: "Company not found" });
  }

  const [removed] = db.companies.splice(index, 1);
  const removedTickets = db.tickets.filter((t) => t.companyId === removed.id);
  db.tickets = db.tickets.filter((t) => t.companyId !== removed.id);
  await removeAssetsForCompany(removed.id);
  await removeLocationsForCompany(removed.id);
  await removeCompany(removed.id);
  await writeDb(db);

  res.json({
    ok: true,
    deletedPeople: removed.people.length,
    deletedTickets: removedTickets.length,
  });
});

app.get("/api/tickets", async (req, res) => {
  const { status, q, companyId, priority, mine } = req.query;
  const db = await readDb();
  let tickets = db.tickets.map((t) => enrichTicket(db, t, req.role));

  if (req.role === "person") {
    if (!req.person?.companyId || !req.person?.id) {
      return res.json([]);
    }
    tickets = tickets.filter((t) => ticketVisibleToPerson(t, req, db));
  } else if (companyId) {
    tickets = tickets.filter((t) => t.companyId === companyId);
  }

  const mineMode = mineFilterMode(mine);
  if (mineMode === "only") {
    tickets = tickets.filter((t) => ticketCreatedByCurrentUser(t, req));
  } else if (mineMode === "exclude" && req.role === "person") {
    tickets = tickets.filter((t) => !ticketCreatedByCurrentUser(t, req));
  }

  if (status) {
    const wanted = (Array.isArray(status) ? status : String(status).split(","))
      .flatMap((value) => String(value).split(","))
      .map((value) => value.trim())
      .filter((value) => STATUSES.includes(value));
    if (wanted.length) {
      tickets = tickets.filter((t) => wanted.includes(t.status));
    }
  }

  if (priority) {
    const wanted = (Array.isArray(priority) ? priority : String(priority).split(","))
      .flatMap((value) => String(value).split(","))
      .map((value) => value.trim())
      .filter((value) => PRIORITIES.includes(value));
    if (wanted.length) {
      tickets = tickets.filter((t) => wanted.includes(t.priority));
    }
  }

  if (q) {
    const needle = String(q).toLowerCase();
    tickets = tickets.filter(
      (t) =>
        t.title.toLowerCase().includes(needle) ||
        t.description.toLowerCase().includes(needle) ||
        t.company.name.toLowerCase().includes(needle) ||
        t.person.name.toLowerCase().includes(needle) ||
        t.person.email.toLowerCase().includes(needle) ||
        (t.person.phone && t.person.phone.toLowerCase().includes(needle))
    );
  }

  tickets = [...tickets].sort(
    (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
  );

  res.json(tickets);
});

app.get("/api/tickets/:id", async (req, res) => {
  const db = await readDb();
  const ticket = db.tickets.find((t) => t.id === req.params.id);
  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found" });
  }
  if (req.role === "person" && !ticketVisibleToPerson(ticket, req, db)) {
    return res.status(404).json({ error: "Ticket not found" });
  }
  res.json(enrichTicket(db, ticket, req.role));
});

app.get("/api/tickets/:id/assets", async (req, res) => {
  const db = await readDb();
  const ticket = db.tickets.find((t) => t.id === req.params.id);
  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found" });
  }
  if (req.role === "person" && !ticketVisibleToPerson(ticket, req, db)) {
    return res.status(404).json({ error: "Ticket not found" });
  }
  res.json(await listCompanyAssets(ticket.companyId));
});

app.post("/api/tickets", async (req, res) => {
  const {
    title,
    description,
    priority = "medium",
  } = req.body ?? {};
  let { companyId, personId } = req.body ?? {};

  if (req.role === "person") {
    companyId = req.person.companyId;
    personId = req.person.id;
  } else if (req.role !== "agent") {
    return res.status(403).json({ error: "Agent access required" });
  }

  if (!title?.trim() || !description?.trim() || !companyId || !personId) {
    return res.status(400).json({
      error: "title, description, companyId, and personId are required",
    });
  }

  if (notesBodyTooLarge(description)) {
    return res.status(400).json({ error: "description is too large" });
  }

  if (!PRIORITIES.includes(priority)) {
    return res
      .status(400)
      .json({ error: `priority must be one of: ${PRIORITIES.join(", ")}` });
  }

  const db = await readDb();
  const company = findCompany(db, companyId);
  if (!company) {
    return res.status(400).json({ error: "companyId must be a registered company" });
  }

  const person = findPerson(company, personId);
  if (!person) {
    return res.status(400).json({
      error: "personId must be a registered customer of the selected company",
    });
  }

  const now = new Date().toISOString();
  const ticket = {
    id: uuidv4(),
    title: title.trim(),
    description: description.trim(),
    companyId: company.id,
    personId: person.id,
    ...(req.role === "agent" ? { creatorAgentId: req.agent.id } : {}),
    ...(req.role === "person" ? { creatorPersonId: req.person.id } : {}),
    priority,
    status: "open",
    createdAt: now,
    updatedAt: now,
    comments: [],
  };

  db.tickets.unshift(ticket);
  await writeDb(db);

  res.status(201).json(enrichTicket(db, ticket, req.role));
});

app.patch("/api/tickets/:id", requireAgent, async (req, res) => {
  const db = await readDb();
  const index = db.tickets.findIndex((t) => t.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  const { status, priority, companyId, personId } = req.body ?? {};
  const ticket = db.tickets[index];
  const changeComments = [];

  if (status !== undefined) {
    if (!STATUSES.includes(status)) {
      return res
        .status(400)
        .json({ error: `status must be one of: ${STATUSES.join(", ")}` });
    }
    if (status !== ticket.status) {
      changeComments.push(
        fieldChangeComment(
          req.agent,
          "status",
          `Changed the status from ${labelTicketStatus(ticket.status)} to ${labelTicketStatus(status)}`,
          true
        )
      );
      ticket.status = status;
    }
  }

  if (priority !== undefined) {
    if (!PRIORITIES.includes(priority)) {
      return res
        .status(400)
        .json({ error: `priority must be one of: ${PRIORITIES.join(", ")}` });
    }
    if (priority !== ticket.priority) {
      changeComments.push(
        fieldChangeComment(
          req.agent,
          "priority",
          `Changed the priority from ${labelTicketPriority(ticket.priority)} to ${labelTicketPriority(priority)}`,
          true
        )
      );
      ticket.priority = priority;
    }
  }

  const nextCompanyId = companyId ?? ticket.companyId;
  const nextPersonId = personId ?? ticket.personId;

  if (companyId !== undefined || personId !== undefined) {
    const company = findCompany(db, nextCompanyId);
    if (!company) {
      return res.status(400).json({ error: "companyId must be a registered company" });
    }
    const person = findPerson(company, nextPersonId);
    if (!person) {
      return res.status(400).json({
        error: "personId must be a registered customer of the selected company",
      });
    }
    ticket.companyId = company.id;
    ticket.personId = person.id;
  }

  if (changeComments.length) {
    ticket.comments = [...(ticket.comments ?? []), ...changeComments];
    ticket.updatedAt = changeComments[changeComments.length - 1].createdAt;
  } else {
    ticket.updatedAt = new Date().toISOString();
  }
  db.tickets[index] = ticket;
  await writeDb(db);

  res.json(enrichTicket(db, ticket, req.role));
});

app.delete("/api/tickets/:id", requireAgent, async (req, res) => {
  const db = await readDb();
  const index = db.tickets.findIndex((t) => t.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  db.tickets.splice(index, 1);
  await writeDb(db);
  res.json({ ok: true });
});

app.post("/api/tickets/:id/comments", async (req, res) => {
  const { body, kind, callParticipants, customerVisible, assetId } = req.body ?? {};

  const normalizedKind = normalizeUpdateKind(kind, req.role);
  if (!normalizedKind) {
    return res.status(400).json({
      error:
        req.role === "person"
          ? "kind must be comment, close, or asset"
          : "kind must be comment, call, close, or asset",
    });
  }

  const trimmedBody = String(body ?? "").trim();
  if (normalizedKind !== "asset" && normalizedKind !== "call" && !trimmedBody) {
    return res.status(400).json({ error: "body is required" });
  }

  if (notesBodyTooLarge(trimmedBody)) {
    return res.status(400).json({ error: "body is too large" });
  }

  const db = await readDb();
  const index = db.tickets.findIndex((t) => t.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  const ticket = db.tickets[index];
  if (req.role === "person" && !ticketVisibleToPerson(ticket, req, db)) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  const company = findCompany(db, ticket.companyId);
  const participants =
    normalizedKind === "call"
      ? callParticipantsForTicket(ticket, company, callParticipants)
      : null;

  let asset = null;
  if (normalizedKind === "asset") {
    const assetRecord = await findAssetById(ticket.companyId, assetId);
    if (!assetRecord) {
      return res.status(400).json({
        error: "Asset must belong to this customer",
      });
    }
    asset = commentAssetSnapshot(assetRecord);
  }

  const visibleToCustomer =
    req.role === "person" ? true : customerVisible !== false;

  const comment =
    req.role === "person"
      ? {
          id: uuidv4(),
          author: req.person.name,
          kind: normalizedKind,
          body: trimmedBody,
          customerVisible: true,
          createdAt: new Date().toISOString(),
          ...(asset ? { asset } : {}),
        }
      : {
          id: uuidv4(),
          author: req.agent.name,
          agentId: req.agent.id,
          kind: normalizedKind,
          body: trimmedBody,
          customerVisible: visibleToCustomer,
          createdAt: new Date().toISOString(),
          ...(participants ? { callParticipants: participants } : {}),
          ...(asset ? { asset } : {}),
        };

  db.tickets[index].comments.push(comment);
  db.tickets[index].updatedAt = comment.createdAt;
  if (normalizedKind === "close") {
    db.tickets[index].status = "closed";
  }
  await writeDb(db);

  res.status(201).json({
    comment,
    ticket: enrichTicket(db, db.tickets[index], req.role),
  });
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) {
    return next();
  }
  res.sendFile(path.join(publicDir, "index.html"), (err) => {
    if (err) next();
  });
});

ensureReady()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Help desk API listening on http://localhost:${PORT}`);
      console.log(
        `Default agent login: ${DEFAULT_AGENT.email} / ${DEFAULT_AGENT.password}`
      );
      if (process.env.DATABASE_URL) {
        console.log("Database: PostgreSQL (DATABASE_URL)");
      } else {
        console.log(`SQLite database: ${SQLITE_PATH}`);
        console.log(`Interactive SQL: sqlite3 "${SQLITE_PATH}"`);
      }
    });
  })
  .catch((err) => {
    console.error("Failed to start database:", err);
    process.exit(1);
  });
