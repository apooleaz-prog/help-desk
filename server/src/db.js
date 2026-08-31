import bcrypt from "bcryptjs";
import fs from "fs";
import { randomUUID } from "node:crypto";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const SQLITE_PATH = path.join(DATA_DIR, "helpdesk.db");
const LEGACY_JSON_PATH = path.join(DATA_DIR, "tickets.json");
const DATABASE_URL = process.env.DATABASE_URL || "";

const STATUSES = ["open", "in_progress", "on_hold", "closed"];
const PRIORITIES = ["low", "medium", "high", "urgent"];

export const DEFAULT_AGENT = {
  id: "agent-demo",
  name: "Demo Agent",
  email: "agent@deskline.local",
  password: "deskline123",
};

export const AGENT_COLORS = [
  "#e11d48",
  "#ea580c",
  "#d97706",
  "#16a34a",
  "#0d9488",
  "#2563eb",
  "#4f46e5",
  "#9333ea",
  "#db2777",
  "#64748b",
];
export const DEFAULT_AGENT_COLOR = "#0d9488";

export function normalizeAgentColor(value) {
  const hex = String(value ?? "").trim().toLowerCase();
  return AGENT_COLORS.includes(hex) ? hex : null;
}

let sqliteDb = null;
let pgPool = null;
let readyPromise = null;

function seedAgents() {
  const now = new Date().toISOString();
  return [
    {
      id: DEFAULT_AGENT.id,
      name: DEFAULT_AGENT.name,
      email: DEFAULT_AGENT.email,
      passwordHash: bcrypt.hashSync(DEFAULT_AGENT.password, 10),
      color: DEFAULT_AGENT_COLOR,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function seedData() {
  return {
    agents: seedAgents(),
    sessions: [],
    companies: [
      {
        id: "co-northwind",
        name: "Northwind Traders",
        details: "Wholesale trading account. Prefers email updates.",
        people: [
          { id: "p-alex", name: "Alex Rivera", email: "alex.rivera@northwind.example" },
          { id: "p-sam", name: "Sam Chen", email: "sam.chen@northwind.example" },
        ],
      },
      {
        id: "co-contoso",
        name: "Contoso Labs",
        details: "R&D lab. Billing issues escalate to finance.",
        people: [
          { id: "p-jordan", name: "Jordan Lee", email: "jordan.lee@contoso.example" },
          { id: "p-morgan", name: "Morgan Patel", email: "morgan.patel@contoso.example" },
          { id: "p-riley", name: "Riley Brooks", email: "riley.brooks@contoso.example" },
        ],
      },
      {
        id: "co-fabrikam",
        name: "Fabrikam Systems",
        details: "Enterprise systems integrator.",
        people: [
          { id: "p-casey", name: "Casey Nguyen", email: "casey.nguyen@fabrikam.example" },
        ],
      },
    ],
    tickets: [
      {
        id: "demo-1",
        title: "Cannot reset password",
        description:
          "Clicking 'Forgot password' sends me to a blank page. Happens in Chrome on macOS.",
        companyId: "co-northwind",
        personId: "p-alex",
        priority: "high",
        status: "open",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
        comments: [
          {
            id: "c-1",
            author: "Support Bot",
            kind: "comment",
            body: "Thanks for reporting — looking into the reset flow.",
            createdAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
          },
        ],
      },
      {
        id: "demo-2",
        title: "Invoice PDF won't download",
        description:
          "Billing → Invoices → Download returns a 500 error for invoice #4821.",
        companyId: "co-contoso",
        personId: "p-jordan",
        priority: "medium",
        status: "in_progress",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
        comments: [],
      },
    ],
  };
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#0d9488',
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
    person_id TEXT REFERENCES people(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    details TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL DEFAULT '',
    UNIQUE (company_id, email)
  );
  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    person_id TEXT NOT NULL REFERENCES people(id),
    creator_agent_id TEXT REFERENCES agents(id),
    creator_person_id TEXT REFERENCES people(id),
    priority TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    agent_id TEXT,
    kind TEXT NOT NULL DEFAULT 'comment',
    call_participants TEXT NOT NULL DEFAULT '',
    customer_visible INTEGER NOT NULL DEFAULT 1,
    asset_json TEXT NOT NULL DEFAULT '',
    duration_minutes INTEGER NOT NULL DEFAULT 0,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS manufacturers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    details TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS asset_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    details TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    manufacturer_id TEXT NOT NULL REFERENCES manufacturers(id),
    asset_type_id TEXT NOT NULL REFERENCES asset_types(id),
    name TEXT NOT NULL DEFAULT '',
    asset_number TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '',
    person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
    person_id TEXT REFERENCES people(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    actor_role TEXT NOT NULL DEFAULT '',
    actor_id TEXT NOT NULL DEFAULT '',
    actor_name TEXT NOT NULL DEFAULT '',
    actor_email TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL DEFAULT '',
    resource_id TEXT NOT NULL DEFAULT '',
    resource_name TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS activity_log_created_idx
    ON activity_log (created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS activity_log_actor_idx
    ON activity_log (actor_id, created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS activity_log_action_idx
    ON activity_log (action, created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS activity_log_role_idx
    ON activity_log (actor_role, created_at DESC, id DESC);
  CREATE TABLE IF NOT EXISTS calendar_slots (
    date TEXT NOT NULL,
    session TEXT NOT NULL,
    agent_id TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (date, session)
  );
  CREATE INDEX IF NOT EXISTS calendar_slots_date_idx
    ON calendar_slots (date, session);
  CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    ticket_id TEXT NOT NULL DEFAULT '',
    ticket_title TEXT NOT NULL DEFAULT '',
    comment_id TEXT NOT NULL DEFAULT '',
    company_id TEXT NOT NULL DEFAULT '',
    actor_role TEXT NOT NULL DEFAULT '',
    actor_id TEXT NOT NULL DEFAULT '',
    actor_name TEXT NOT NULL DEFAULT '',
    dismissed_at TEXT NOT NULL DEFAULT '',
    dismissed_by TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS alerts_open_idx
    ON alerts (dismissed_at, created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS alerts_ticket_idx
    ON alerts (ticket_id, created_at DESC);
`;

function loadLegacyJson() {
  if (!fs.existsSync(LEGACY_JSON_PATH)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(LEGACY_JSON_PATH, "utf8"));
    if (!Array.isArray(raw.companies)) return null;
    if (!Array.isArray(raw.agents) || raw.agents.length === 0) raw.agents = seedAgents();
    if (!Array.isArray(raw.sessions)) raw.sessions = [];
    if (!Array.isArray(raw.tickets)) raw.tickets = [];
    for (const company of raw.companies) {
      if (typeof company.details !== "string") company.details = "";
    }
    return raw;
  } catch {
    return null;
  }
}

function usePostgres() {
  return Boolean(DATABASE_URL);
}

const ASSET_SNAPSHOT_SQL = `id, company_id, manufacturer_id, asset_type_id, name, asset_number, image, person_id, location_id, created_at, updated_at`;
const LOCATION_SNAPSHOT_SQL = `id, company_id, name, address, details, created_at, updated_at`;

function locationSnapshotValues(location) {
  return [
    location.id,
    location.company_id,
    location.name ?? "",
    location.address ?? "",
    location.details ?? "",
    location.created_at,
    location.updated_at,
  ];
}

function assetSnapshotValues(asset) {
  return [
    asset.id,
    asset.company_id,
    asset.manufacturer_id,
    asset.asset_type_id,
    asset.name ?? "",
    asset.asset_number ?? "",
    asset.image ?? "",
    asset.person_id || null,
    asset.location_id || null,
    asset.created_at,
    asset.updated_at,
  ];
}

function companySnapshotValues(company) {
  return [
    company.id,
    company.name,
    company.details ?? "",
    company.image ?? "",
  ];
}

function snapshotCompanyIds(data) {
  return [...new Set((data.companies ?? []).map((company) => company.id).filter(Boolean))];
}

function parseCallParticipants(raw) {
  if (!raw) return { personIds: [], externalNames: [], people: [] };
  if (typeof raw === "object") {
    const personIds = Array.isArray(raw.personIds)
      ? raw.personIds.map(String).filter(Boolean)
      : [];
    const people = Array.isArray(raw.people)
      ? raw.people
          .map((person) => ({
            id: String(person?.id ?? ""),
            name: String(person?.name ?? "").trim(),
          }))
          .filter((person) => person.id && person.name)
      : [];
    return {
      personIds: personIds.length ? personIds : people.map((person) => person.id),
      externalNames: Array.isArray(raw.externalNames)
        ? raw.externalNames.map((name) => String(name).trim()).filter(Boolean)
        : [],
      people,
    };
  }
  if (typeof raw !== "string" || !raw.trim()) {
    return { personIds: [], externalNames: [], people: [] };
  }
  try {
    return parseCallParticipants(JSON.parse(raw));
  } catch {
    return { personIds: [], externalNames: [], people: [] };
  }
}

function serializeCallParticipants(value) {
  const parsed = parseCallParticipants(value);
  if (!parsed.personIds.length && !parsed.externalNames.length) return "";
  return JSON.stringify(parsed);
}

function parseCommentAsset(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const id = String(value.id ?? "").trim();
    if (!id) return null;
    return {
      id,
      name: String(value.name ?? "").trim() || "Asset",
      assetNumber: String(value.assetNumber ?? value.asset_number ?? "").trim(),
      image: String(value.image ?? "").trim(),
      manufacturerName: String(value.manufacturerName ?? "").trim(),
      manufacturerImage: String(
        value.manufacturerImage ?? value.manufacturerLogo ?? value.manufacturer?.image ?? ""
      ).trim(),
      assetTypeName: String(value.assetTypeName ?? "").trim(),
      locationName: String(value.locationName ?? "").trim(),
      personName: String(value.personName ?? "").trim(),
    };
  }
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return parseCommentAsset(JSON.parse(value));
  } catch {
    return null;
  }
}

function serializeCommentAsset(value) {
  const parsed = parseCommentAsset(value);
  return parsed ? JSON.stringify(parsed) : "";
}

function commentAssetSnapshot(asset) {
  if (!asset?.id) return null;
  return parseCommentAsset({
    id: asset.id,
    name: asset.name || asset.assetType?.name || "Asset",
    assetNumber: asset.assetNumber || "",
    image: asset.image || asset.assetType?.image || "",
    manufacturerName: asset.manufacturer?.name || "",
    manufacturerImage: asset.manufacturer?.image || asset.manufacturer?.logo || "",
    assetTypeName: asset.assetType?.name || "",
    locationName: asset.location?.name || "",
    personName: asset.person?.name || "",
  });
}

function persistCommentKind(kind) {
  if (
    kind === "call" ||
    kind === "callback" ||
    kind === "close" ||
    kind === "status" ||
    kind === "priority" ||
    kind === "asset"
  ) {
    return kind;
  }
  return "comment";
}

function persistCustomerVisible(value) {
  if (value === false || value === 0 || value === "0") return 0;
  return 1;
}

function persistDurationMinutes(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  const allowed = [15, 30, 45, 60, 75, 90, 105, 120, 135, 150];
  return allowed.includes(minutes) ? minutes : 0;
}

function mapComment(row) {
  const kind = persistCommentKind(row.kind);
  const callParticipants = parseCallParticipants(
    row.callParticipants ?? row.call_participants
  );
  const asset = parseCommentAsset(row.assetJson ?? row.asset_json ?? row.asset);
  return {
    id: row.id,
    author: row.author,
    body: row.body,
    kind,
    customerVisible: persistCustomerVisible(
      row.customerVisible ?? row.customer_visible
    ) === 1,
    durationMinutes: persistDurationMinutes(
      row.durationMinutes ?? row.duration_minutes
    ),
    createdAt: row.createdAt,
    ...(row.agentId ? { agentId: row.agentId } : {}),
    ...(kind === "call" ? { callParticipants } : {}),
    ...(kind === "asset" && asset ? { asset } : {}),
  };
}

function writeSqliteSnapshot(database, data) {
  database.exec("PRAGMA foreign_keys = OFF;");
  database.exec("BEGIN IMMEDIATE");
  try {
    const savedAssets = database
      .prepare(`SELECT ${ASSET_SNAPSHOT_SQL} FROM assets`)
      .all();
    let savedLocations = [];
    try {
      savedLocations = database
        .prepare(`SELECT ${LOCATION_SNAPSHOT_SQL} FROM locations`)
        .all();
    } catch {
      savedLocations = [];
    }
    const savedCompanies = database
      .prepare(`SELECT id, name, details, image FROM companies`)
      .all();
    let savedResets = [];
    try {
      savedResets = database
        .prepare(
          `SELECT token_hash AS tokenHash, agent_id AS agentId, person_id AS personId,
                  expires_at AS expiresAt, created_at AS createdAt
           FROM password_resets`
        )
        .all();
    } catch {
      savedResets = [];
    }
    database.exec(`
      DELETE FROM comments; DELETE FROM tickets; DELETE FROM people;
      DELETE FROM password_resets; DELETE FROM sessions; DELETE FROM agents;
      DELETE FROM assets; DELETE FROM locations;
    `);
    const insertAgent = database.prepare(
      `INSERT INTO agents (id, name, email, phone, color, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const agent of data.agents ?? []) {
      insertAgent.run(
        agent.id,
        agent.name,
        agent.email,
        agent.phone ?? "",
        agent.color || DEFAULT_AGENT_COLOR,
        agent.passwordHash,
        agent.createdAt,
        agent.updatedAt
      );
    }
    const upsertCompany = database.prepare(
      `INSERT INTO companies (id, name, details, image) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         details = excluded.details,
         image = excluded.image`
    );
    const incomingCompanies = data.companies ?? [];
    const incomingCompanyIds = new Set(snapshotCompanyIds(data));
    for (const company of incomingCompanies) {
      upsertCompany.run(...companySnapshotValues(company));
    }
    for (const company of savedCompanies) {
      if (incomingCompanyIds.has(company.id)) continue;
      upsertCompany.run(...companySnapshotValues(company));
      incomingCompanyIds.add(company.id);
    }
    const insertLocation = database.prepare(
      `INSERT INTO locations (${LOCATION_SNAPSHOT_SQL}) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const location of savedLocations) {
      if (!incomingCompanyIds.has(location.company_id)) continue;
      insertLocation.run(...locationSnapshotValues(location));
    }
    const insertPerson = database.prepare(
      `INSERT INTO people (id, company_id, name, email, phone, image, password_hash, location_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const company of incomingCompanies) {
      for (const person of company.people ?? []) {
        insertPerson.run(
          person.id,
          company.id,
          person.name,
          person.email,
          person.phone ?? "",
          person.image ?? "",
          person.passwordHash ?? "",
          person.locationId || person.location_id || null
        );
      }
    }
    const insertTicket = database.prepare(
      `INSERT INTO tickets (id, title, description, company_id, person_id, creator_agent_id, creator_person_id, priority, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertComment = database.prepare(
      `INSERT INTO comments (id, ticket_id, author, agent_id, kind, call_participants, asset_json, customer_visible, duration_minutes, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const ticket of data.tickets ?? []) {
      insertTicket.run(
        ticket.id, ticket.title, ticket.description, ticket.companyId, ticket.personId,
        ticket.creatorAgentId ?? null, ticket.creatorPersonId ?? null,
        ticket.priority, ticket.status, ticket.createdAt, ticket.updatedAt
      );
      for (const comment of ticket.comments ?? []) {
        insertComment.run(
          comment.id,
          ticket.id,
          comment.author,
          comment.agentId ?? null,
          persistCommentKind(comment.kind),
          serializeCallParticipants(comment.callParticipants),
          serializeCommentAsset(comment.asset),
          persistCustomerVisible(comment.customerVisible),
          persistDurationMinutes(comment.durationMinutes),
          comment.body,
          comment.createdAt
        );
      }
    }
    const insertSession = database.prepare(
      `INSERT INTO sessions (token, agent_id, person_id, created_at) VALUES (?, ?, ?, ?)`
    );
    for (const session of data.sessions ?? []) {
      insertSession.run(
        session.token,
        session.agentId ?? null,
        session.personId ?? null,
        session.createdAt
      );
    }
    const agentIds = new Set((data.agents ?? []).map((agent) => agent.id));
    const personIds = new Set();
    for (const company of incomingCompanies) {
      for (const person of company.people ?? []) {
        if (person?.id) personIds.add(person.id);
      }
    }
    const nowIso = new Date().toISOString();
    const insertReset = database.prepare(
      `INSERT INTO password_resets (token_hash, agent_id, person_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const row of savedResets) {
      if (row.expiresAt && row.expiresAt < nowIso) continue;
      if (row.agentId && !agentIds.has(row.agentId)) continue;
      if (row.personId && !personIds.has(row.personId)) continue;
      insertReset.run(
        row.tokenHash,
        row.agentId ?? null,
        row.personId ?? null,
        row.expiresAt,
        row.createdAt
      );
    }
    const companyIds = incomingCompanyIds;
    const insertAsset = database.prepare(
      `INSERT INTO assets (${ASSET_SNAPSHOT_SQL}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const asset of savedAssets) {
      if (!companyIds.has(asset.company_id)) continue;
      insertAsset.run(...assetSnapshotValues(asset));
    }
    database.exec(
      `DELETE FROM assets WHERE company_id NOT IN (SELECT id FROM companies)`
    );
    database.exec(
      `DELETE FROM locations WHERE company_id NOT IN (SELECT id FROM companies)`
    );
    database.exec(
      `UPDATE assets SET person_id = NULL
       WHERE person_id IS NOT NULL AND person_id != ''
         AND NOT EXISTS (
           SELECT 1 FROM people p
           WHERE p.id = assets.person_id AND p.company_id = assets.company_id
         )`
    );
    try {
      database.exec(
        `UPDATE assets SET location_id = NULL
         WHERE location_id IS NOT NULL AND location_id != ''
           AND NOT EXISTS (
             SELECT 1 FROM locations l
             WHERE l.id = assets.location_id AND l.company_id = assets.company_id
           )`
      );
      database.exec(
        `UPDATE people SET location_id = NULL
         WHERE location_id IS NOT NULL AND location_id != ''
           AND NOT EXISTS (
             SELECT 1 FROM locations l
             WHERE l.id = people.location_id AND l.company_id = people.company_id
           )`
      );
    } catch {
      // location_id may not exist yet
    }
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  } finally {
    database.exec("PRAGMA foreign_keys = ON;");
  }
}

function readSqliteSnapshot(database) {
  const agents = database
    .prepare(
      `SELECT id, name, email, phone, color, password_hash AS passwordHash, created_at AS createdAt, updated_at AS updatedAt
       FROM agents ORDER BY name`
    )
    .all()
    .map((a) => ({
      ...a,
      phone: a.phone || undefined,
      color: a.color || DEFAULT_AGENT_COLOR,
    }));
  const sessions = database
    .prepare(
      `SELECT token, agent_id AS agentId, person_id AS personId, created_at AS createdAt
       FROM sessions`
    )
    .all()
    .map((s) => ({
      token: s.token,
      createdAt: s.createdAt,
      ...(s.agentId ? { agentId: s.agentId } : {}),
      ...(s.personId ? { personId: s.personId } : {}),
    }));
  const companies = database
    .prepare(`SELECT id, name, details, image FROM companies ORDER BY name`)
    .all()
    .map((company) => ({
      ...company,
      image: company.image || undefined,
      people: database
        .prepare(
        `SELECT id, name, email, phone, image, password_hash AS passwordHash,
                location_id AS locationId
           FROM people WHERE company_id = ? ORDER BY name`
        )
        .all(company.id)
        .map((p) => ({
          ...p,
          phone: p.phone || undefined,
          image: p.image || undefined,
          passwordHash: p.passwordHash || undefined,
          locationId: p.locationId || undefined,
        })),
    }));
  const tickets = database
    .prepare(
      `SELECT id, title, description, company_id AS companyId, person_id AS personId,
              creator_agent_id AS creatorAgentId, creator_person_id AS creatorPersonId,
              priority, status, created_at AS createdAt, updated_at AS updatedAt
       FROM tickets ORDER BY updated_at DESC`
    )
    .all()
    .map((ticket) => ({
      ...ticket,
      comments: database
        .prepare(
          `SELECT id, author, agent_id AS agentId, kind, call_participants AS callParticipants, asset_json AS assetJson, customer_visible AS customerVisible, duration_minutes AS durationMinutes, body, created_at AS createdAt
           FROM comments WHERE ticket_id = ? ORDER BY created_at DESC`
        )
        .all(ticket.id)
        .map(mapComment),
    }));
  return { agents, sessions, companies, tickets };
}

async function writePgSnapshot(pool, data) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: savedAssets } = await client.query(
      `SELECT ${ASSET_SNAPSHOT_SQL} FROM assets`
    );
    let savedLocations = [];
    try {
      savedLocations = (
        await client.query(`SELECT ${LOCATION_SNAPSHOT_SQL} FROM locations`)
      ).rows;
    } catch {
      savedLocations = [];
    }
    const { rows: savedCompanies } = await client.query(
      `SELECT id, name, details, image FROM companies`
    );
    let savedResets = [];
    try {
      savedResets = (
        await client.query(
          `SELECT token_hash AS "tokenHash", agent_id AS "agentId", person_id AS "personId",
                  expires_at AS "expiresAt", created_at AS "createdAt"
           FROM password_resets`
        )
      ).rows;
    } catch {
      savedResets = [];
    }
    await client.query(`
      DELETE FROM comments; DELETE FROM tickets; DELETE FROM people;
      DELETE FROM password_resets; DELETE FROM sessions; DELETE FROM agents;
      DELETE FROM assets; DELETE FROM locations;
    `);
    for (const agent of data.agents ?? []) {
      await client.query(
        `INSERT INTO agents (id, name, email, phone, color, password_hash, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          agent.id,
          agent.name,
          agent.email,
          agent.phone ?? "",
          agent.color || DEFAULT_AGENT_COLOR,
          agent.passwordHash,
          agent.createdAt,
          agent.updatedAt,
        ]
      );
    }
    const incomingCompanies = data.companies ?? [];
    const incomingCompanyIds = new Set(snapshotCompanyIds(data));
    for (const company of incomingCompanies) {
      await client.query(
        `INSERT INTO companies (id, name, details, image) VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           details = EXCLUDED.details,
           image = EXCLUDED.image`,
        companySnapshotValues(company)
      );
    }
    for (const company of savedCompanies) {
      if (incomingCompanyIds.has(company.id)) continue;
      await client.query(
        `INSERT INTO companies (id, name, details, image) VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           details = EXCLUDED.details,
           image = EXCLUDED.image`,
        companySnapshotValues(company)
      );
      incomingCompanyIds.add(company.id);
    }
    for (const location of savedLocations) {
      if (!incomingCompanyIds.has(location.company_id)) continue;
      await client.query(
        `INSERT INTO locations (${LOCATION_SNAPSHOT_SQL})
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        locationSnapshotValues(location)
      );
    }
    for (const company of incomingCompanies) {
      for (const person of company.people ?? []) {
        await client.query(
          `INSERT INTO people (id, company_id, name, email, phone, image, password_hash, location_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            person.id,
            company.id,
            person.name,
            person.email,
            person.phone ?? "",
            person.image ?? "",
            person.passwordHash ?? "",
            person.locationId || person.location_id || null,
          ]
        );
      }
    }
    for (const ticket of data.tickets ?? []) {
      await client.query(
        `INSERT INTO tickets (id, title, description, company_id, person_id, creator_agent_id, creator_person_id, priority, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          ticket.id, ticket.title, ticket.description, ticket.companyId, ticket.personId,
          ticket.creatorAgentId ?? null, ticket.creatorPersonId ?? null,
          ticket.priority, ticket.status, ticket.createdAt, ticket.updatedAt,
        ]
      );
      for (const comment of ticket.comments ?? []) {
        await client.query(
          `INSERT INTO comments (id, ticket_id, author, agent_id, kind, call_participants, asset_json, customer_visible, duration_minutes, body, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            comment.id,
            ticket.id,
            comment.author,
            comment.agentId ?? null,
            persistCommentKind(comment.kind),
            serializeCallParticipants(comment.callParticipants),
            serializeCommentAsset(comment.asset),
            persistCustomerVisible(comment.customerVisible),
            persistDurationMinutes(comment.durationMinutes),
            comment.body,
            comment.createdAt,
          ]
        );
      }
    }
    for (const session of data.sessions ?? []) {
      await client.query(
        `INSERT INTO sessions (token, agent_id, person_id, created_at) VALUES ($1,$2,$3,$4)`,
        [session.token, session.agentId ?? null, session.personId ?? null, session.createdAt]
      );
    }
    const agentIds = new Set((data.agents ?? []).map((agent) => agent.id));
    const personIds = new Set();
    for (const company of incomingCompanies) {
      for (const person of company.people ?? []) {
        if (person?.id) personIds.add(person.id);
      }
    }
    const nowIso = new Date().toISOString();
    for (const row of savedResets) {
      if (row.expiresAt && row.expiresAt < nowIso) continue;
      if (row.agentId && !agentIds.has(row.agentId)) continue;
      if (row.personId && !personIds.has(row.personId)) continue;
      await client.query(
        `INSERT INTO password_resets (token_hash, agent_id, person_id, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          row.tokenHash,
          row.agentId ?? null,
          row.personId ?? null,
          row.expiresAt,
          row.createdAt,
        ]
      );
    }
    const companyIds = incomingCompanyIds;
    for (const asset of savedAssets) {
      if (!companyIds.has(asset.company_id)) continue;
      await client.query(
        `INSERT INTO assets (${ASSET_SNAPSHOT_SQL})
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        assetSnapshotValues(asset)
      );
    }
    await client.query(
      `DELETE FROM assets WHERE company_id NOT IN (SELECT id FROM companies)`
    );
    await client.query(
      `DELETE FROM locations WHERE company_id NOT IN (SELECT id FROM companies)`
    );
    await client.query(
      `UPDATE assets SET person_id = NULL
       WHERE person_id IS NOT NULL AND person_id != ''
         AND NOT EXISTS (
           SELECT 1 FROM people p
           WHERE p.id = assets.person_id AND p.company_id = assets.company_id
         )`
    );
    try {
      await client.query(
        `UPDATE assets SET location_id = NULL
         WHERE location_id IS NOT NULL AND location_id != ''
           AND NOT EXISTS (
             SELECT 1 FROM locations l
             WHERE l.id = assets.location_id AND l.company_id = assets.company_id
           )`
      );
      await client.query(
        `UPDATE people SET location_id = NULL
         WHERE location_id IS NOT NULL AND location_id != ''
           AND NOT EXISTS (
             SELECT 1 FROM locations l
             WHERE l.id = people.location_id AND l.company_id = people.company_id
           )`
      );
    } catch {
      // location_id may not exist yet
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function readPgSnapshot(pool) {
  const agents = (
    await pool.query(
      `SELECT id, name, email, phone, color, password_hash AS "passwordHash", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM agents ORDER BY name`
    )
  ).rows.map((a) => ({
    ...a,
    phone: a.phone || undefined,
    color: a.color || DEFAULT_AGENT_COLOR,
  }));
  const sessions = (
    await pool.query(
      `SELECT token, agent_id AS "agentId", person_id AS "personId", created_at AS "createdAt"
       FROM sessions`
    )
  ).rows.map((s) => ({
    token: s.token,
    createdAt: s.createdAt,
    ...(s.agentId ? { agentId: s.agentId } : {}),
    ...(s.personId ? { personId: s.personId } : {}),
  }));
  const companyRows = (
    await pool.query(`SELECT id, name, details, image FROM companies ORDER BY name`)
  ).rows;
  const companies = [];
  for (const company of companyRows) {
    const people = (
      await pool.query(
        `SELECT id, name, email, phone, image, password_hash AS "passwordHash",
                location_id AS "locationId"
         FROM people WHERE company_id = $1 ORDER BY name`,
        [company.id]
      )
    ).rows.map((p) => ({
      ...p,
      phone: p.phone || undefined,
      image: p.image || undefined,
      passwordHash: p.passwordHash || undefined,
      locationId: p.locationId || undefined,
    }));
    companies.push({
      ...company,
      image: company.image || undefined,
      people,
    });
  }
  const ticketRows = (
    await pool.query(
      `SELECT id, title, description, company_id AS "companyId", person_id AS "personId",
              creator_agent_id AS "creatorAgentId", creator_person_id AS "creatorPersonId",
              priority, status, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM tickets ORDER BY updated_at DESC`
    )
  ).rows;
  const tickets = [];
  for (const ticket of ticketRows) {
    const comments = (
      await pool.query(
        `SELECT id, author, agent_id AS "agentId", kind, call_participants AS "callParticipants", asset_json AS "assetJson", customer_visible AS "customerVisible", duration_minutes AS "durationMinutes", body, created_at AS "createdAt"
         FROM comments WHERE ticket_id = $1 ORDER BY created_at DESC`,
        [ticket.id]
      )
    ).rows.map(mapComment);
    tickets.push({ ...ticket, comments });
  }
  return { agents, sessions, companies, tickets };
}

function getSqlite() {
  if (sqliteDb) return sqliteDb;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const isNew = !fs.existsSync(SQLITE_PATH);
  sqliteDb = new DatabaseSync(SQLITE_PATH);
  sqliteDb.exec("PRAGMA foreign_keys = ON;");
  sqliteDb.exec(SCHEMA_SQL);
  const companyCols = sqliteDb.prepare(`PRAGMA table_info(companies)`).all();
  if (!companyCols.some((col) => col.name === "image")) {
    sqliteDb.exec(`ALTER TABLE companies ADD COLUMN image TEXT NOT NULL DEFAULT ''`);
  }
  const peopleCols = sqliteDb.prepare(`PRAGMA table_info(people)`).all();
  if (!peopleCols.some((col) => col.name === "phone")) {
    sqliteDb.exec(`ALTER TABLE people ADD COLUMN phone TEXT NOT NULL DEFAULT ''`);
  }
  if (!peopleCols.some((col) => col.name === "image")) {
    sqliteDb.exec(`ALTER TABLE people ADD COLUMN image TEXT NOT NULL DEFAULT ''`);
  }
  if (!peopleCols.some((col) => col.name === "password_hash")) {
    sqliteDb.exec(`ALTER TABLE people ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''`);
  }
  if (!peopleCols.some((col) => col.name === "location_id")) {
    sqliteDb.exec(`ALTER TABLE people ADD COLUMN location_id TEXT REFERENCES locations(id)`);
  }
  const agentCols = sqliteDb.prepare(`PRAGMA table_info(agents)`).all();
  if (!agentCols.some((col) => col.name === "phone")) {
    sqliteDb.exec(`ALTER TABLE agents ADD COLUMN phone TEXT NOT NULL DEFAULT ''`);
  }
  if (!agentCols.some((col) => col.name === "color")) {
    sqliteDb.exec(
      `ALTER TABLE agents ADD COLUMN color TEXT NOT NULL DEFAULT '${DEFAULT_AGENT_COLOR}'`
    );
  }
  const assetTypeCols = sqliteDb.prepare(`PRAGMA table_info(asset_types)`).all();
  if (assetTypeCols.length && !assetTypeCols.some((col) => col.name === "image")) {
    sqliteDb.exec(`ALTER TABLE asset_types ADD COLUMN image TEXT NOT NULL DEFAULT ''`);
  }
  const manufacturerCols = sqliteDb.prepare(`PRAGMA table_info(manufacturers)`).all();
  if (manufacturerCols.length && !manufacturerCols.some((col) => col.name === "image")) {
    sqliteDb.exec(`ALTER TABLE manufacturers ADD COLUMN image TEXT NOT NULL DEFAULT ''`);
  }
  const assetCols = sqliteDb.prepare(`PRAGMA table_info(assets)`).all();
  if (assetCols.length && !assetCols.some((col) => col.name === "name")) {
    sqliteDb.exec(`ALTER TABLE assets ADD COLUMN name TEXT NOT NULL DEFAULT ''`);
  }
  if (assetCols.length && !assetCols.some((col) => col.name === "asset_number")) {
    sqliteDb.exec(`ALTER TABLE assets ADD COLUMN asset_number TEXT NOT NULL DEFAULT ''`);
  }
  if (assetCols.length && !assetCols.some((col) => col.name === "image")) {
    sqliteDb.exec(`ALTER TABLE assets ADD COLUMN image TEXT NOT NULL DEFAULT ''`);
  }
  if (assetCols.length && !assetCols.some((col) => col.name === "person_id")) {
    sqliteDb.exec(`ALTER TABLE assets ADD COLUMN person_id TEXT REFERENCES people(id)`);
  }
  if (assetCols.length && !assetCols.some((col) => col.name === "location_id")) {
    sqliteDb.exec(`ALTER TABLE assets ADD COLUMN location_id TEXT REFERENCES locations(id)`);
  }
  const ticketCols = sqliteDb.prepare(`PRAGMA table_info(tickets)`).all();
  if (ticketCols.length && !ticketCols.some((col) => col.name === "creator_agent_id")) {
    sqliteDb.exec(`ALTER TABLE tickets ADD COLUMN creator_agent_id TEXT REFERENCES agents(id)`);
  }
  if (ticketCols.length && !ticketCols.some((col) => col.name === "creator_person_id")) {
    sqliteDb.exec(`ALTER TABLE tickets ADD COLUMN creator_person_id TEXT REFERENCES people(id)`);
  }
  const commentCols = sqliteDb.prepare(`PRAGMA table_info(comments)`).all();
  if (commentCols.length && !commentCols.some((col) => col.name === "kind")) {
    sqliteDb.exec(`ALTER TABLE comments ADD COLUMN kind TEXT NOT NULL DEFAULT 'comment'`);
  }
  if (commentCols.length && !commentCols.some((col) => col.name === "call_participants")) {
    sqliteDb.exec(`ALTER TABLE comments ADD COLUMN call_participants TEXT NOT NULL DEFAULT ''`);
  }
  if (commentCols.length && !commentCols.some((col) => col.name === "customer_visible")) {
    sqliteDb.exec(`ALTER TABLE comments ADD COLUMN customer_visible INTEGER NOT NULL DEFAULT 1`);
  }
  if (commentCols.length && !commentCols.some((col) => col.name === "asset_json")) {
    sqliteDb.exec(`ALTER TABLE comments ADD COLUMN asset_json TEXT NOT NULL DEFAULT ''`);
  }
  if (commentCols.length && !commentCols.some((col) => col.name === "duration_minutes")) {
    sqliteDb.exec(`ALTER TABLE comments ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 0`);
  }
  migrateSessionsTable(sqliteDb);
  sqliteDb.exec(`UPDATE tickets SET status = 'on_hold' WHERE status = 'resolved'`);
  const agentCount = sqliteDb.prepare(`SELECT COUNT(*) AS c FROM agents`).get().c;
  if (isNew || agentCount === 0) {
    writeSqliteSnapshot(sqliteDb, loadLegacyJson() ?? seedData());
  }
  return sqliteDb;
}

function migrateSessionsTable(database) {
  const cols = database.prepare(`PRAGMA table_info(sessions)`).all();
  const hasPersonId = cols.some((col) => col.name === "person_id");
  const agentCol = cols.find((col) => col.name === "agent_id");
  const agentNotNull = Boolean(agentCol?.notnull);
  if (hasPersonId && !agentNotNull) return;

  database.exec("PRAGMA foreign_keys = OFF;");
  database.exec(`
    CREATE TABLE sessions_new (
      token TEXT PRIMARY KEY,
      agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
      person_id TEXT REFERENCES people(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
    INSERT INTO sessions_new (token, agent_id, person_id, created_at)
    SELECT token, agent_id, NULL, created_at FROM sessions;
    DROP TABLE sessions;
    ALTER TABLE sessions_new RENAME TO sessions;
  `);
  database.exec("PRAGMA foreign_keys = ON;");
}

async function getPg() {
  if (pgPool) return pgPool;
  pgPool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false },
  });
  await pgPool.query(SCHEMA_SQL);
  await pgPool.query(
    `ALTER TABLE companies ADD COLUMN IF NOT EXISTS image TEXT NOT NULL DEFAULT ''`
  );
  await pgPool.query(
    `ALTER TABLE people ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT ''`
  );
  await pgPool.query(
    `ALTER TABLE people ADD COLUMN IF NOT EXISTS image TEXT NOT NULL DEFAULT ''`
  );
  await pgPool.query(
    `ALTER TABLE people ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT ''`
  );
  await pgPool.query(
    `ALTER TABLE people ADD COLUMN IF NOT EXISTS location_id TEXT REFERENCES locations(id) ON DELETE SET NULL`
  );
  await pgPool.query(
    `ALTER TABLE agents ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT ''`
  );
  await pgPool.query(
    `ALTER TABLE agents ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '${DEFAULT_AGENT_COLOR}'`
  );
  await pgPool.query(
    `ALTER TABLE asset_types ADD COLUMN IF NOT EXISTS image TEXT NOT NULL DEFAULT ''`
  );
  await pgPool.query(
    `ALTER TABLE manufacturers ADD COLUMN IF NOT EXISTS image TEXT NOT NULL DEFAULT ''`
  );
  await pgPool.query(
    `ALTER TABLE assets ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''`
  );
  await pgPool.query(
    `ALTER TABLE assets ADD COLUMN IF NOT EXISTS asset_number TEXT NOT NULL DEFAULT ''`
  );
  await pgPool.query(
    `ALTER TABLE assets ADD COLUMN IF NOT EXISTS image TEXT NOT NULL DEFAULT ''`
  );
  await pgPool.query(
    `ALTER TABLE assets ADD COLUMN IF NOT EXISTS person_id TEXT REFERENCES people(id) ON DELETE SET NULL`
  );
  await pgPool.query(
    `ALTER TABLE assets ADD COLUMN IF NOT EXISTS location_id TEXT REFERENCES locations(id) ON DELETE SET NULL`
  );
  await pgPool.query(
    `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS creator_agent_id TEXT REFERENCES agents(id)`
  );
  await pgPool.query(
    `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS creator_person_id TEXT REFERENCES people(id)`
  );
  await pgPool.query(
    `ALTER TABLE comments ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'comment'`
  );
  await pgPool.query(
    `ALTER TABLE comments ADD COLUMN IF NOT EXISTS call_participants TEXT NOT NULL DEFAULT ''`
  );
  await pgPool.query(
    `ALTER TABLE comments ADD COLUMN IF NOT EXISTS customer_visible INTEGER NOT NULL DEFAULT 1`
  );
  await pgPool.query(
    `ALTER TABLE comments ADD COLUMN IF NOT EXISTS asset_json TEXT NOT NULL DEFAULT ''`
  );
  await pgPool.query(
    `ALTER TABLE comments ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NOT NULL DEFAULT 0`
  );
  await pgPool.query(
    `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS person_id TEXT REFERENCES people(id) ON DELETE CASCADE`
  );
  await pgPool.query(`ALTER TABLE sessions ALTER COLUMN agent_id DROP NOT NULL`);
  await pgPool.query(`UPDATE tickets SET status = 'on_hold' WHERE status = 'resolved'`);
  const { rows } = await pgPool.query(`SELECT COUNT(*)::int AS c FROM agents`);
  if (rows[0].c === 0) {
    await writePgSnapshot(pgPool, seedData());
  }
  return pgPool;
}

async function ensureReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      if (usePostgres()) await getPg();
      else getSqlite();
    })();
  }
  return readyPromise;
}

async function readDb() {
  await ensureReady();
  if (usePostgres()) return readPgSnapshot(await getPg());
  return readSqliteSnapshot(getSqlite());
}

async function writeDb(data) {
  await ensureReady();
  if (usePostgres()) return writePgSnapshot(await getPg(), data);
  writeSqliteSnapshot(getSqlite(), data);
}

function mapNamedRecord(row) {
  return {
    id: row.id,
    name: row.name,
    details: row.details || "",
    ...(row.image !== undefined ? { image: row.image || "" } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function createNamedCatalog(table, { hasImage = false } = {}) {
  const selectSqlite = hasImage
    ? `SELECT id, name, details, image, created_at AS createdAt, updated_at AS updatedAt FROM ${table}`
    : `SELECT id, name, details, created_at AS createdAt, updated_at AS updatedAt FROM ${table}`;
  const selectPg = hasImage
    ? `SELECT id, name, details, image, created_at AS "createdAt", updated_at AS "updatedAt" FROM ${table}`
    : `SELECT id, name, details, created_at AS "createdAt", updated_at AS "updatedAt" FROM ${table}`;

  return {
    async list() {
      await ensureReady();
      if (usePostgres()) {
        const { rows } = await (await getPg()).query(`${selectPg} ORDER BY name`);
        return rows.map(mapNamedRecord);
      }
      return getSqlite()
        .prepare(`${selectSqlite} ORDER BY name`)
        .all()
        .map(mapNamedRecord);
    },
    async findById(id) {
      await ensureReady();
      if (usePostgres()) {
        const { rows } = await (
          await getPg()
        ).query(`${selectPg} WHERE id = $1`, [id]);
        return rows[0] ? mapNamedRecord(rows[0]) : null;
      }
      const row = getSqlite()
        .prepare(`${selectSqlite} WHERE id = ?`)
        .get(id);
      return row ? mapNamedRecord(row) : null;
    },
    async findByName(name) {
      await ensureReady();
      const normalized = name.trim().toLowerCase();
      if (usePostgres()) {
        const { rows } = await (
          await getPg()
        ).query(`${selectPg} WHERE lower(name) = $1`, [normalized]);
        return rows[0] ? mapNamedRecord(rows[0]) : null;
      }
      const row = getSqlite()
        .prepare(`${selectSqlite} WHERE lower(name) = ?`)
        .get(normalized);
      return row ? mapNamedRecord(row) : null;
    },
    async insert(record) {
      await ensureReady();
      if (usePostgres()) {
        if (hasImage) {
          await (
            await getPg()
          ).query(
            `INSERT INTO ${table} (id, name, details, image, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              record.id,
              record.name,
              record.details ?? "",
              record.image ?? "",
              record.createdAt,
              record.updatedAt,
            ]
          );
        } else {
          await (
            await getPg()
          ).query(
            `INSERT INTO ${table} (id, name, details, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5)`,
            [
              record.id,
              record.name,
              record.details ?? "",
              record.createdAt,
              record.updatedAt,
            ]
          );
        }
        return record;
      }
      if (hasImage) {
        getSqlite()
          .prepare(
            `INSERT INTO ${table} (id, name, details, image, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(
            record.id,
            record.name,
            record.details ?? "",
            record.image ?? "",
            record.createdAt,
            record.updatedAt
          );
      } else {
        getSqlite()
          .prepare(
            `INSERT INTO ${table} (id, name, details, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`
          )
          .run(
            record.id,
            record.name,
            record.details ?? "",
            record.createdAt,
            record.updatedAt
          );
      }
      return record;
    },
    async update(id, fields) {
      const current = await this.findById(id);
      if (!current) return null;
      const next = {
        ...current,
        ...fields,
        updatedAt: new Date().toISOString(),
      };
      await ensureReady();
      if (usePostgres()) {
        if (hasImage) {
          await (
            await getPg()
          ).query(
            `UPDATE ${table} SET name = $1, details = $2, image = $3, updated_at = $4 WHERE id = $5`,
            [next.name, next.details ?? "", next.image ?? "", next.updatedAt, id]
          );
        } else {
          await (
            await getPg()
          ).query(
            `UPDATE ${table} SET name = $1, details = $2, updated_at = $3 WHERE id = $4`,
            [next.name, next.details ?? "", next.updatedAt, id]
          );
        }
        return next;
      }
      if (hasImage) {
        getSqlite()
          .prepare(
            `UPDATE ${table} SET name = ?, details = ?, image = ?, updated_at = ? WHERE id = ?`
          )
          .run(next.name, next.details ?? "", next.image ?? "", next.updatedAt, id);
      } else {
        getSqlite()
          .prepare(
            `UPDATE ${table} SET name = ?, details = ?, updated_at = ? WHERE id = ?`
          )
          .run(next.name, next.details ?? "", next.updatedAt, id);
      }
      return next;
    },
    async remove(id) {
      await ensureReady();
      if (usePostgres()) {
        const result = await (
          await getPg()
        ).query(`DELETE FROM ${table} WHERE id = $1`, [id]);
        return result.rowCount > 0;
      }
      const result = getSqlite()
        .prepare(`DELETE FROM ${table} WHERE id = ?`)
        .run(id);
      return result.changes > 0;
    },
  };
}

const manufacturerCatalog = createNamedCatalog("manufacturers", { hasImage: true });
const assetTypeCatalog = createNamedCatalog("asset_types", { hasImage: true });

const listManufacturers = () => manufacturerCatalog.list();
const findManufacturerById = (id) => manufacturerCatalog.findById(id);
const findManufacturerByName = (name) => manufacturerCatalog.findByName(name);
const insertManufacturer = (record) => manufacturerCatalog.insert(record);
const updateManufacturerRecord = (id, fields) =>
  manufacturerCatalog.update(id, fields);
const removeManufacturer = (id) => manufacturerCatalog.remove(id);

const listAssetTypes = () => assetTypeCatalog.list();
const findAssetTypeById = (id) => assetTypeCatalog.findById(id);
const findAssetTypeByName = (name) => assetTypeCatalog.findByName(name);
const insertAssetType = (record) => assetTypeCatalog.insert(record);
const updateAssetTypeRecord = (id, fields) => assetTypeCatalog.update(id, fields);
const removeAssetType = (id) => assetTypeCatalog.remove(id);

function mapAsset(row) {
  const personId = row.personId || "";
  const locationId = row.locationId || "";
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name || "",
    assetNumber: row.assetNumber || "",
    image: row.image || "",
    personId,
    locationId,
    manufacturerId: row.manufacturerId,
    assetTypeId: row.assetTypeId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    manufacturer: {
      id: row.manufacturerId,
      name: row.manufacturerName || "Unknown manufacturer",
      ...(row.manufacturerImage
        ? { image: row.manufacturerImage, logo: row.manufacturerImage }
        : {}),
    },
    assetType: {
      id: row.assetTypeId,
      name: row.assetTypeName || "Unknown type",
      ...(row.assetTypeImage ? { image: row.assetTypeImage } : {}),
    },
    person: personId
      ? {
          id: personId,
          name: row.personName || "Unknown person",
          ...(row.personImage ? { image: row.personImage } : {}),
        }
      : null,
    location: locationId
      ? {
          id: locationId,
          name: row.locationName || "Unknown location",
          ...(row.locationAddress ? { address: row.locationAddress } : {}),
        }
      : null,
  };
}

const ASSET_SELECT_SQLITE = `
  SELECT a.id, a.company_id AS companyId, a.name, a.asset_number AS assetNumber, a.image,
         a.person_id AS personId, a.location_id AS locationId,
         a.manufacturer_id AS manufacturerId, a.asset_type_id AS assetTypeId,
         a.created_at AS createdAt, a.updated_at AS updatedAt,
         m.name AS manufacturerName, m.image AS manufacturerImage,
         t.name AS assetTypeName, t.image AS assetTypeImage,
         p.name AS personName, p.image AS personImage,
         l.name AS locationName, l.address AS locationAddress
  FROM assets a
  LEFT JOIN manufacturers m ON m.id = a.manufacturer_id
  LEFT JOIN asset_types t ON t.id = a.asset_type_id
  LEFT JOIN people p ON p.id = a.person_id
  LEFT JOIN locations l ON l.id = a.location_id
`;

const ASSET_SELECT_PG = `
  SELECT a.id, a.company_id AS "companyId", a.name, a.asset_number AS "assetNumber", a.image,
         a.person_id AS "personId", a.location_id AS "locationId",
         a.manufacturer_id AS "manufacturerId", a.asset_type_id AS "assetTypeId",
         a.created_at AS "createdAt", a.updated_at AS "updatedAt",
         m.name AS "manufacturerName", m.image AS "manufacturerImage",
         t.name AS "assetTypeName", t.image AS "assetTypeImage",
         p.name AS "personName", p.image AS "personImage",
         l.name AS "locationName", l.address AS "locationAddress"
  FROM assets a
  LEFT JOIN manufacturers m ON m.id = a.manufacturer_id
  LEFT JOIN asset_types t ON t.id = a.asset_type_id
  LEFT JOIN people p ON p.id = a.person_id
  LEFT JOIN locations l ON l.id = a.location_id
`;

async function listCompanyAssets(companyId) {
  await ensureReady();
  if (usePostgres()) {
    const { rows } = await (
      await getPg()
    ).query(`${ASSET_SELECT_PG} WHERE a.company_id = $1 ORDER BY a.name, a.asset_number`, [
      companyId,
    ]);
    return rows.map(mapAsset);
  }
  return getSqlite()
    .prepare(`${ASSET_SELECT_SQLITE} WHERE a.company_id = ? ORDER BY a.name, a.asset_number`)
    .all(companyId)
    .map(mapAsset);
}

async function findAssetById(companyId, assetId) {
  await ensureReady();
  if (usePostgres()) {
    const { rows } = await (
      await getPg()
    ).query(`${ASSET_SELECT_PG} WHERE a.company_id = $1 AND a.id = $2`, [
      companyId,
      assetId,
    ]);
    return rows[0] ? mapAsset(rows[0]) : null;
  }
  const row = getSqlite()
    .prepare(`${ASSET_SELECT_SQLITE} WHERE a.company_id = ? AND a.id = ?`)
    .get(companyId, assetId);
  return row ? mapAsset(row) : null;
}

async function findAssetByNumber(companyId, assetNumber, exceptId = "") {
  const needle = String(assetNumber ?? "").trim().toLowerCase();
  if (!needle) return null;
  await ensureReady();
  if (usePostgres()) {
    const { rows } = await (
      await getPg()
    ).query(
      `${ASSET_SELECT_PG} WHERE a.company_id = $1 AND lower(a.asset_number) = $2 AND a.id <> $3`,
      [companyId, needle, exceptId]
    );
    return rows[0] ? mapAsset(rows[0]) : null;
  }
  const row = getSqlite()
    .prepare(
      `${ASSET_SELECT_SQLITE} WHERE a.company_id = ? AND lower(a.asset_number) = ? AND a.id <> ?`
    )
    .get(companyId, needle, exceptId);
  return row ? mapAsset(row) : null;
}

async function insertAsset(asset) {
  await ensureReady();
  if (usePostgres()) {
    await (
      await getPg()
    ).query(
      `INSERT INTO assets (id, company_id, manufacturer_id, asset_type_id, name, asset_number, image, person_id, location_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        asset.id,
        asset.companyId,
        asset.manufacturerId,
        asset.assetTypeId,
        asset.name ?? "",
        asset.assetNumber ?? "",
        asset.image ?? "",
        asset.personId || null,
        asset.locationId || null,
        asset.createdAt,
        asset.updatedAt,
      ]
    );
    return findAssetById(asset.companyId, asset.id);
  }
  getSqlite()
    .prepare(
      `INSERT INTO assets (id, company_id, manufacturer_id, asset_type_id, name, asset_number, image, person_id, location_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      asset.id,
      asset.companyId,
      asset.manufacturerId,
      asset.assetTypeId,
      asset.name ?? "",
      asset.assetNumber ?? "",
      asset.image ?? "",
      asset.personId || null,
      asset.locationId || null,
      asset.createdAt,
      asset.updatedAt
    );
  return findAssetById(asset.companyId, asset.id);
}

async function updateAssetRecord(companyId, assetId, fields) {
  const current = await findAssetById(companyId, assetId);
  if (!current) return null;
  const next = {
    name: fields.name ?? current.name,
    assetNumber: fields.assetNumber ?? current.assetNumber,
    image: fields.image !== undefined ? fields.image : current.image,
    personId:
      fields.personId !== undefined ? fields.personId || "" : current.personId || "",
    locationId:
      fields.locationId !== undefined ? fields.locationId || "" : current.locationId || "",
    manufacturerId: fields.manufacturerId ?? current.manufacturerId,
    assetTypeId: fields.assetTypeId ?? current.assetTypeId,
    updatedAt: new Date().toISOString(),
  };
  await ensureReady();
  if (usePostgres()) {
    await (
      await getPg()
    ).query(
      `UPDATE assets SET name = $1, asset_number = $2, image = $3, person_id = $4, location_id = $5, manufacturer_id = $6, asset_type_id = $7, updated_at = $8
       WHERE company_id = $9 AND id = $10`,
      [
        next.name ?? "",
        next.assetNumber ?? "",
        next.image ?? "",
        next.personId || null,
        next.locationId || null,
        next.manufacturerId,
        next.assetTypeId,
        next.updatedAt,
        companyId,
        assetId,
      ]
    );
    return findAssetById(companyId, assetId);
  }
  getSqlite()
    .prepare(
      `UPDATE assets SET name = ?, asset_number = ?, image = ?, person_id = ?, location_id = ?, manufacturer_id = ?, asset_type_id = ?, updated_at = ?
       WHERE company_id = ? AND id = ?`
    )
    .run(
      next.name ?? "",
      next.assetNumber ?? "",
      next.image ?? "",
      next.personId || null,
      next.locationId || null,
      next.manufacturerId,
      next.assetTypeId,
      next.updatedAt,
      companyId,
      assetId
    );
  return findAssetById(companyId, assetId);
}

async function removeAsset(companyId, assetId) {
  await ensureReady();
  if (usePostgres()) {
    const result = await (
      await getPg()
    ).query(`DELETE FROM assets WHERE company_id = $1 AND id = $2`, [
      companyId,
      assetId,
    ]);
    return result.rowCount > 0;
  }
  const result = getSqlite()
    .prepare(`DELETE FROM assets WHERE company_id = ? AND id = ?`)
    .run(companyId, assetId);
  return result.changes > 0;
}

async function removeAssetsForCompany(companyId) {
  await ensureReady();
  if (usePostgres()) {
    await (await getPg()).query(`DELETE FROM assets WHERE company_id = $1`, [
      companyId,
    ]);
    return;
  }
  getSqlite().prepare(`DELETE FROM assets WHERE company_id = ?`).run(companyId);
}

function mapLocation(row) {
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name || "",
    address: row.address || "",
    details: row.details || "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const LOCATION_SELECT_SQLITE = `
  SELECT id, company_id AS companyId, name, address, details,
         created_at AS createdAt, updated_at AS updatedAt
  FROM locations
`;

const LOCATION_SELECT_PG = `
  SELECT id, company_id AS "companyId", name, address, details,
         created_at AS "createdAt", updated_at AS "updatedAt"
  FROM locations
`;

async function listCompanyLocations(companyId) {
  await ensureReady();
  if (usePostgres()) {
    const { rows } = await (
      await getPg()
    ).query(`${LOCATION_SELECT_PG} WHERE company_id = $1 ORDER BY name`, [companyId]);
    return rows.map(mapLocation);
  }
  return getSqlite()
    .prepare(`${LOCATION_SELECT_SQLITE} WHERE company_id = ? ORDER BY name`)
    .all(companyId)
    .map(mapLocation);
}

async function findLocationById(companyId, locationId) {
  await ensureReady();
  if (usePostgres()) {
    const { rows } = await (
      await getPg()
    ).query(`${LOCATION_SELECT_PG} WHERE company_id = $1 AND id = $2`, [
      companyId,
      locationId,
    ]);
    return rows[0] ? mapLocation(rows[0]) : null;
  }
  const row = getSqlite()
    .prepare(`${LOCATION_SELECT_SQLITE} WHERE company_id = ? AND id = ?`)
    .get(companyId, locationId);
  return row ? mapLocation(row) : null;
}

async function insertLocation(location) {
  await ensureReady();
  if (usePostgres()) {
    await (
      await getPg()
    ).query(
      `INSERT INTO locations (id, company_id, name, address, details, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        location.id,
        location.companyId,
        location.name ?? "",
        location.address ?? "",
        location.details ?? "",
        location.createdAt,
        location.updatedAt,
      ]
    );
    return findLocationById(location.companyId, location.id);
  }
  getSqlite()
    .prepare(
      `INSERT INTO locations (id, company_id, name, address, details, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      location.id,
      location.companyId,
      location.name ?? "",
      location.address ?? "",
      location.details ?? "",
      location.createdAt,
      location.updatedAt
    );
  return findLocationById(location.companyId, location.id);
}

async function updateLocationRecord(companyId, locationId, fields) {
  const current = await findLocationById(companyId, locationId);
  if (!current) return null;
  const next = {
    name: fields.name ?? current.name,
    address: fields.address !== undefined ? fields.address : current.address,
    details: fields.details !== undefined ? fields.details : current.details,
    updatedAt: new Date().toISOString(),
  };
  await ensureReady();
  if (usePostgres()) {
    await (
      await getPg()
    ).query(
      `UPDATE locations SET name = $1, address = $2, details = $3, updated_at = $4
       WHERE company_id = $5 AND id = $6`,
      [next.name ?? "", next.address ?? "", next.details ?? "", next.updatedAt, companyId, locationId]
    );
    return findLocationById(companyId, locationId);
  }
  getSqlite()
    .prepare(
      `UPDATE locations SET name = ?, address = ?, details = ?, updated_at = ?
       WHERE company_id = ? AND id = ?`
    )
    .run(
      next.name ?? "",
      next.address ?? "",
      next.details ?? "",
      next.updatedAt,
      companyId,
      locationId
    );
  return findLocationById(companyId, locationId);
}

async function removeLocation(companyId, locationId) {
  await ensureReady();
  if (usePostgres()) {
    const pg = await getPg();
    await pg.query(
      `UPDATE people SET location_id = NULL WHERE company_id = $1 AND location_id = $2`,
      [companyId, locationId]
    );
    await pg.query(
      `UPDATE assets SET location_id = NULL WHERE company_id = $1 AND location_id = $2`,
      [companyId, locationId]
    );
    const result = await pg.query(
      `DELETE FROM locations WHERE company_id = $1 AND id = $2`,
      [companyId, locationId]
    );
    return result.rowCount > 0;
  }
  const sqlite = getSqlite();
  sqlite
    .prepare(`UPDATE people SET location_id = NULL WHERE company_id = ? AND location_id = ?`)
    .run(companyId, locationId);
  sqlite
    .prepare(`UPDATE assets SET location_id = NULL WHERE company_id = ? AND location_id = ?`)
    .run(companyId, locationId);
  const result = sqlite
    .prepare(`DELETE FROM locations WHERE company_id = ? AND id = ?`)
    .run(companyId, locationId);
  return result.changes > 0;
}

async function countRowsByCompany(table) {
  await ensureReady();
  if (usePostgres()) {
    const { rows } = await (
      await getPg()
    ).query(`SELECT company_id AS "companyId", COUNT(*)::int AS count FROM ${table} GROUP BY company_id`);
    return Object.fromEntries(rows.map((row) => [row.companyId, row.count]));
  }
  const rows = getSqlite()
    .prepare(`SELECT company_id AS companyId, COUNT(*) AS count FROM ${table} GROUP BY company_id`)
    .all();
  return Object.fromEntries(rows.map((row) => [row.companyId, row.count]));
}

async function countAssetsByCompany() {
  return countRowsByCompany("assets");
}

async function countLocationsByCompany() {
  try {
    return await countRowsByCompany("locations");
  } catch {
    return {};
  }
}

async function removeLocationsForCompany(companyId) {
  await ensureReady();
  if (usePostgres()) {
    await (await getPg()).query(`DELETE FROM locations WHERE company_id = $1`, [
      companyId,
    ]);
    return;
  }
  getSqlite().prepare(`DELETE FROM locations WHERE company_id = ?`).run(companyId);
}

async function removeCompany(companyId) {
  await ensureReady();
  if (usePostgres()) {
    const result = await (
      await getPg()
    ).query(`DELETE FROM companies WHERE id = $1`, [companyId]);
    return result.rowCount > 0;
  }
  const result = getSqlite()
    .prepare(`DELETE FROM companies WHERE id = ?`)
    .run(companyId);
  return result.changes > 0;
}

function findCompany(db, companyId) {
  return db.companies.find((c) => c.id === companyId) ?? null;
}

function findPerson(company, personId) {
  return company?.people.find((p) => p.id === personId) ?? null;
}

function findPersonByEmail(db, email) {
  const needle = String(email ?? "")
    .trim()
    .toLowerCase();
  if (!needle) return null;
  for (const company of db.companies ?? []) {
    const person = (company.people ?? []).find(
      (p) => p.email.toLowerCase() === needle
    );
    if (person) {
      return { person, company };
    }
  }
  return null;
}

function findPersonById(db, personId) {
  for (const company of db.companies ?? []) {
    const person = findPerson(company, personId);
    if (person) {
      return { person, company };
    }
  }
  return null;
}

function findAgent(db, agentId) {
  return db.agents.find((a) => a.id === agentId) ?? null;
}

function publicPerson(person) {
  if (!person) return null;
  return {
    id: person.id,
    name: person.name,
    email: person.email,
    ...(person.phone ? { phone: person.phone } : {}),
    ...(person.image ? { image: person.image } : {}),
    ...(person.locationId ? { locationId: person.locationId } : {}),
  };
}

function publicPortalPerson(person, company) {
  return {
    ...publicPerson(person),
    companyId: company.id,
    companyName: company.name,
    ...(company.image ? { companyImage: company.image } : {}),
  };
}

function publicCompany(company) {
  if (!company) return null;
  return {
    id: company.id,
    name: company.name,
    details: company.details ?? "",
    ...(company.image ? { image: company.image } : {}),
    people: (company.people ?? []).map(publicPerson),
  };
}

function publicAgent(agent) {
  return {
    id: agent.id,
    name: agent.name,
    email: agent.email,
    ...(agent.phone ? { phone: agent.phone } : {}),
    color: agent.color || DEFAULT_AGENT_COLOR,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

function presentCustomerStatusComment(comment) {
  const match = String(comment.body || "").match(
    /^Changed the status from (.+) to (.+)$/i
  );
  if (!match) return comment;
  const fromLabel = customerFacingStatusLabel(match[1]);
  const toLabel = customerFacingStatusLabel(match[2]);
  if (fromLabel === toLabel) return null;
  return {
    ...comment,
    body: `Changed the status from ${fromLabel} to ${toLabel}`,
  };
}

function customerFacingStatusLabel(label) {
  const normalized = String(label)
    .trim()
    .toLowerCase()
    .replaceAll("_", " ");
  if (normalized === "closed") return "Closed";
  if (
    normalized === "open" ||
    normalized === "in progress" ||
    normalized === "on hold"
  ) {
    return "Open";
  }
  return String(label).trim();
}

function enrichTicket(db, ticket, role) {
  const company = findCompany(db, ticket.companyId);
  const person = findPerson(company, ticket.personId);
  const comments =
    role === "person"
      ? (ticket.comments ?? []).flatMap((comment) => {
          if (comment.customerVisible === false) return [];
          if (comment.kind === "status") {
            const presented = presentCustomerStatusComment(comment);
            if (!presented) return [];
            const { durationMinutes, ...rest } = presented;
            return [rest];
          }
          const { durationMinutes, ...rest } = comment;
          return [rest];
        })
      : ticket.comments;
  return {
    ...ticket,
    status:
      role === "person" && ticket.status !== "closed" ? "open" : ticket.status,
    comments,
    company: company
      ? {
          id: company.id,
          name: company.name,
          ...(company.image ? { image: company.image } : {}),
        }
      : { id: ticket.companyId, name: "Unknown company" },
    person: person
      ? publicPerson(person)
      : { id: ticket.personId, name: "Unknown person", email: "" },
  };
}

function mapPasswordReset(row) {
  if (!row) return null;
  return {
    tokenHash: row.tokenHash,
    agentId: row.agentId || null,
    personId: row.personId || null,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

async function replacePasswordReset({
  tokenHash,
  agentId,
  personId,
  expiresAt,
  createdAt,
}) {
  await ensureReady();
  if (usePostgres()) {
    const pool = await getPg();
    if (agentId) {
      await pool.query(`DELETE FROM password_resets WHERE agent_id = $1`, [agentId]);
    }
    if (personId) {
      await pool.query(`DELETE FROM password_resets WHERE person_id = $1`, [personId]);
    }
    await pool.query(
      `INSERT INTO password_resets (token_hash, agent_id, person_id, expires_at, created_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [tokenHash, agentId ?? null, personId ?? null, expiresAt, createdAt]
    );
    return;
  }
  const database = getSqlite();
  if (agentId) {
    database.prepare(`DELETE FROM password_resets WHERE agent_id = ?`).run(agentId);
  }
  if (personId) {
    database.prepare(`DELETE FROM password_resets WHERE person_id = ?`).run(personId);
  }
  database
    .prepare(
      `INSERT INTO password_resets (token_hash, agent_id, person_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(tokenHash, agentId ?? null, personId ?? null, expiresAt, createdAt);
}

async function findPasswordReset(tokenHash) {
  await ensureReady();
  if (usePostgres()) {
    const { rows } = await (
      await getPg()
    ).query(
      `SELECT token_hash AS "tokenHash", agent_id AS "agentId", person_id AS "personId",
              expires_at AS "expiresAt", created_at AS "createdAt"
       FROM password_resets WHERE token_hash = $1`,
      [tokenHash]
    );
    return rows[0] ? mapPasswordReset(rows[0]) : null;
  }
  const row = getSqlite()
    .prepare(
      `SELECT token_hash AS tokenHash, agent_id AS agentId, person_id AS personId,
              expires_at AS expiresAt, created_at AS createdAt
       FROM password_resets WHERE token_hash = ?`
    )
    .get(tokenHash);
  return row ? mapPasswordReset(row) : null;
}

async function deletePasswordReset(tokenHash) {
  await ensureReady();
  if (usePostgres()) {
    await (await getPg()).query(`DELETE FROM password_resets WHERE token_hash = $1`, [
      tokenHash,
    ]);
    return;
  }
  getSqlite().prepare(`DELETE FROM password_resets WHERE token_hash = ?`).run(tokenHash);
}

const ACTIVITY_LOG_SELECT_SQLITE = `
  SELECT id, created_at AS createdAt,
         actor_role AS actorRole, actor_id AS actorId,
         actor_name AS actorName, actor_email AS actorEmail,
         action, resource_type AS resourceType, resource_id AS resourceId,
         resource_name AS resourceName
  FROM activity_log
`;

const ACTIVITY_LOG_SELECT_PG = `
  SELECT id, created_at AS "createdAt",
         actor_role AS "actorRole", actor_id AS "actorId",
         actor_name AS "actorName", actor_email AS "actorEmail",
         action, resource_type AS "resourceType", resource_id AS "resourceId",
         resource_name AS "resourceName"
  FROM activity_log
`;

function mapActivityLog(row) {
  return {
    id: row.id,
    createdAt: row.createdAt,
    actorRole: row.actorRole || "",
    actorId: row.actorId || "",
    actorName: row.actorName || "",
    actorEmail: row.actorEmail || "",
    action: row.action,
    resourceType: row.resourceType || "",
    resourceId: row.resourceId || "",
    resourceName: row.resourceName || "",
  };
}

function clipLogText(value, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

async function insertActivityLog(entry) {
  await ensureReady();
  const row = {
    id: entry.id || randomUUID(),
    createdAt: entry.createdAt || new Date().toISOString(),
    actorRole: clipLogText(entry.actorRole, 32),
    actorId: clipLogText(entry.actorId, 64),
    actorName: clipLogText(entry.actorName),
    actorEmail: clipLogText(entry.actorEmail),
    action: clipLogText(entry.action, 32),
    resourceType: clipLogText(entry.resourceType, 32),
    resourceId: clipLogText(entry.resourceId, 64),
    resourceName: clipLogText(entry.resourceName),
  };
  if (!row.action) return null;
  const values = [
    row.id,
    row.createdAt,
    row.actorRole,
    row.actorId,
    row.actorName,
    row.actorEmail,
    row.action,
    row.resourceType,
    row.resourceId,
    row.resourceName,
  ];
  if (usePostgres()) {
    await (
      await getPg()
    ).query(
      `INSERT INTO activity_log (
         id, created_at, actor_role, actor_id, actor_name, actor_email,
         action, resource_type, resource_id, resource_name
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      values
    );
  } else {
    getSqlite()
      .prepare(
        `INSERT INTO activity_log (
           id, created_at, actor_role, actor_id, actor_name, actor_email,
           action, resource_type, resource_id, resource_name
         ) VALUES (?,?,?,?,?,?,?,?,?,?)`
      )
      .run(...values);
  }
  return mapActivityLog(row);
}

function activityLogWhere({ actorId, actorRole, action, beforeCreatedAt, beforeId }, placeholder) {
  const where = [];
  const params = [];
  const next = () => placeholder(params.length + 1);
  if (actorId) {
    where.push(`actor_id = ${next()}`);
    params.push(actorId);
  }
  if (actorRole) {
    where.push(`actor_role = ${next()}`);
    params.push(actorRole);
  }
  if (action) {
    where.push(`action = ${next()}`);
    params.push(action);
  }
  if (beforeCreatedAt && beforeId) {
    where.push(`(created_at, id) < (${next()}, ${next()})`);
    params.push(beforeCreatedAt, beforeId);
  } else if (beforeCreatedAt) {
    where.push(`created_at < ${next()}`);
    params.push(beforeCreatedAt);
  }
  return {
    sql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

async function listActivityLogs({
  actorId = "",
  actorRole = "",
  action = "",
  limit = 200,
  beforeCreatedAt = "",
  beforeId = "",
} = {}) {
  await ensureReady();
  const take = Math.min(Math.max(Number(limit) || 200, 1), 500);
  if (usePostgres()) {
    const { sql, params } = activityLogWhere(
      { actorId, actorRole, action, beforeCreatedAt, beforeId },
      (index) => `$${index}`
    );
    const { rows } = await (
      await getPg()
    ).query(
      `${ACTIVITY_LOG_SELECT_PG} ${sql} ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1}`,
      [...params, take]
    );
    return rows.map(mapActivityLog);
  }
  const { sql, params } = activityLogWhere(
    { actorId, actorRole, action, beforeCreatedAt, beforeId },
    () => "?"
  );
  return getSqlite()
    .prepare(`${ACTIVITY_LOG_SELECT_SQLITE} ${sql} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(...params, take)
    .map(mapActivityLog);
}

async function listActivityLogActors() {
  await ensureReady();
  if (usePostgres()) {
    const { rows } = await (
      await getPg()
    ).query(
      `SELECT DISTINCT ON (actor_id)
         actor_id AS "id", actor_name AS "name", actor_email AS "email",
         actor_role AS "role"
       FROM activity_log
       WHERE actor_id <> ''
       ORDER BY actor_id, created_at DESC`
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name || "",
      email: row.email || "",
      role: row.role === "person" ? "person" : "agent",
    }));
  }
  return getSqlite()
    .prepare(
      `SELECT actor_id AS id,
              MAX(actor_name) AS name,
              MAX(actor_email) AS email,
              MAX(actor_role) AS role
       FROM activity_log
       WHERE actor_id <> ''
       GROUP BY actor_id
       ORDER BY MAX(created_at) DESC`
    )
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name || "",
      email: row.email || "",
      role: row.role === "person" ? "person" : "agent",
    }));
}

async function clearActivityLog() {
  await ensureReady();
  if (usePostgres()) {
    await (await getPg()).query(`DELETE FROM activity_log`);
    return;
  }
  getSqlite().prepare(`DELETE FROM activity_log`).run();
}

const ALERT_SELECT_SQLITE = `
  SELECT id, created_at AS createdAt, kind, message,
         ticket_id AS ticketId, ticket_title AS ticketTitle,
         comment_id AS commentId, company_id AS companyId,
         actor_role AS actorRole, actor_id AS actorId, actor_name AS actorName,
         dismissed_at AS dismissedAt, dismissed_by AS dismissedBy
  FROM alerts
`;

const ALERT_SELECT_PG = `
  SELECT id, created_at AS "createdAt", kind, message,
         ticket_id AS "ticketId", ticket_title AS "ticketTitle",
         comment_id AS "commentId", company_id AS "companyId",
         actor_role AS "actorRole", actor_id AS "actorId", actor_name AS "actorName",
         dismissed_at AS "dismissedAt", dismissed_by AS "dismissedBy"
  FROM alerts
`;

function mapAlert(row) {
  return {
    id: row.id,
    createdAt: row.createdAt,
    kind: row.kind,
    message: row.message || "",
    ticketId: row.ticketId || "",
    ticketTitle: row.ticketTitle || "",
    commentId: row.commentId || "",
    companyId: row.companyId || "",
    actorRole: row.actorRole || "",
    actorId: row.actorId || "",
    actorName: row.actorName || "",
  };
}

async function insertAlert(entry) {
  await ensureReady();
  const row = {
    id: entry.id || randomUUID(),
    createdAt: entry.createdAt || new Date().toISOString(),
    kind: clipLogText(entry.kind, 32),
    message: clipLogText(entry.message, 280),
    ticketId: clipLogText(entry.ticketId, 64),
    ticketTitle: clipLogText(entry.ticketTitle),
    commentId: clipLogText(entry.commentId, 64),
    companyId: clipLogText(entry.companyId, 64),
    actorRole: clipLogText(entry.actorRole, 32),
    actorId: clipLogText(entry.actorId, 64),
    actorName: clipLogText(entry.actorName),
    dismissedAt: "",
    dismissedBy: "",
  };
  if (!row.kind || !row.ticketId) return null;
  const values = [
    row.id,
    row.createdAt,
    row.kind,
    row.message,
    row.ticketId,
    row.ticketTitle,
    row.commentId,
    row.companyId,
    row.actorRole,
    row.actorId,
    row.actorName,
    row.dismissedAt,
    row.dismissedBy,
  ];
  if (usePostgres()) {
    await (
      await getPg()
    ).query(
      `INSERT INTO alerts (
         id, created_at, kind, message, ticket_id, ticket_title, comment_id,
         company_id, actor_role, actor_id, actor_name, dismissed_at, dismissed_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      values
    );
  } else {
    getSqlite()
      .prepare(
        `INSERT INTO alerts (
           id, created_at, kind, message, ticket_id, ticket_title, comment_id,
           company_id, actor_role, actor_id, actor_name, dismissed_at, dismissed_by
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(...values);
  }
  return mapAlert(row);
}

async function listOpenAlerts({ limit = 100 } = {}) {
  await ensureReady();
  const take = Math.min(Math.max(Number(limit) || 100, 1), 200);
  if (usePostgres()) {
    const { rows } = await (
      await getPg()
    ).query(
      `${ALERT_SELECT_PG} WHERE dismissed_at = '' ORDER BY created_at DESC, id DESC LIMIT $1`,
      [take]
    );
    return rows.map(mapAlert);
  }
  return getSqlite()
    .prepare(
      `${ALERT_SELECT_SQLITE} WHERE dismissed_at = '' ORDER BY created_at DESC, id DESC LIMIT ?`
    )
    .all(take)
    .map(mapAlert);
}

async function dismissAlert(id, agentId = "") {
  await ensureReady();
  const alertId = String(id || "").trim();
  if (!alertId) return null;
  const dismissedAt = new Date().toISOString();
  const dismissedBy = clipLogText(agentId, 64);
  if (usePostgres()) {
    const { rows } = await (
      await getPg()
    ).query(
      `${ALERT_SELECT_PG} WHERE id = $1`,
      [alertId]
    );
    if (!rows[0]) return null;
    if (rows[0].dismissedAt) return mapAlert(rows[0]);
    await (
      await getPg()
    ).query(
      `UPDATE alerts SET dismissed_at = $1, dismissed_by = $2 WHERE id = $3 AND dismissed_at = ''`,
      [dismissedAt, dismissedBy, alertId]
    );
    return mapAlert({ ...rows[0], dismissedAt, dismissedBy });
  }
  const existing = getSqlite()
    .prepare(`${ALERT_SELECT_SQLITE} WHERE id = ?`)
    .get(alertId);
  if (!existing) return null;
  if (existing.dismissedAt) return mapAlert(existing);
  getSqlite()
    .prepare(
      `UPDATE alerts SET dismissed_at = ?, dismissed_by = ? WHERE id = ? AND dismissed_at = ''`
    )
    .run(dismissedAt, dismissedBy, alertId);
  return mapAlert({ ...existing, dismissedAt, dismissedBy });
}

async function removeAlertsForTicket(ticketId) {
  await ensureReady();
  const id = String(ticketId || "").trim();
  if (!id) return;
  if (usePostgres()) {
    await (await getPg()).query(`DELETE FROM alerts WHERE ticket_id = $1`, [id]);
    return;
  }
  getSqlite().prepare(`DELETE FROM alerts WHERE ticket_id = ?`).run(id);
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDateKey(value) {
  if (!DATE_KEY_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function mapCalendarSlot(row) {
  return {
    date: row.date,
    session: row.session,
    agentId: row.agentId || "",
    updatedAt: row.updatedAt,
  };
}

async function listCalendarSlots(from, to) {
  await ensureReady();
  if (usePostgres()) {
    const { rows } = await (
      await getPg()
    ).query(
      `SELECT date, session, agent_id AS "agentId", updated_at AS "updatedAt"
       FROM calendar_slots
       WHERE date >= $1 AND date <= $2
       ORDER BY date, session`,
      [from, to]
    );
    return rows.map(mapCalendarSlot);
  }
  return getSqlite()
    .prepare(
      `SELECT date, session, agent_id AS agentId, updated_at AS updatedAt
       FROM calendar_slots
       WHERE date >= ? AND date <= ?
       ORDER BY date, session`
    )
    .all(from, to)
    .map(mapCalendarSlot);
}

async function upsertCalendarSlot({ date, session, agentId }) {
  await ensureReady();
  const now = new Date().toISOString();
  const assigned = String(agentId ?? "").trim();
  if (!assigned) {
    if (usePostgres()) {
      await (
        await getPg()
      ).query(`DELETE FROM calendar_slots WHERE date = $1 AND session = $2`, [
        date,
        session,
      ]);
    } else {
      getSqlite()
        .prepare(`DELETE FROM calendar_slots WHERE date = ? AND session = ?`)
        .run(date, session);
    }
    return { date, session, agentId: "", updatedAt: now };
  }
  if (usePostgres()) {
    await (
      await getPg()
    ).query(
      `INSERT INTO calendar_slots (date, session, agent_id, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (date, session)
       DO UPDATE SET agent_id = EXCLUDED.agent_id, updated_at = EXCLUDED.updated_at`,
      [date, session, assigned, now]
    );
  } else {
    getSqlite()
      .prepare(
        `INSERT INTO calendar_slots (date, session, agent_id, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (date, session)
         DO UPDATE SET agent_id = excluded.agent_id, updated_at = excluded.updated_at`
      )
      .run(date, session, assigned, now);
  }
  return { date, session, agentId: assigned, updatedAt: now };
}

export {
  STATUSES,
  PRIORITIES,
  persistDurationMinutes,
  SQLITE_PATH,
  ensureReady,
  readDb,
  writeDb,
  findCompany,
  findPerson,
  findPersonByEmail,
  findPersonById,
  findAgent,
  publicAgent,
  publicPerson,
  publicPortalPerson,
  publicCompany,
  enrichTicket,
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
  replacePasswordReset,
  findPasswordReset,
  deletePasswordReset,
  insertActivityLog,
  listActivityLogs,
  listActivityLogActors,
  clearActivityLog,
  insertAlert,
  listOpenAlerts,
  dismissAlert,
  removeAlertsForTicket,
  isDateKey,
  listCalendarSlots,
  upsertCalendarSlot,
};
