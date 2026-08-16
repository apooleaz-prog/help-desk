import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const SQLITE_PATH = path.join(DATA_DIR, "helpdesk.db");
const LEGACY_JSON_PATH = path.join(DATA_DIR, "tickets.json");
const DATABASE_URL = process.env.DATABASE_URL || "";

const STATUSES = ["open", "in_progress", "resolved", "closed"];
const PRIORITIES = ["low", "medium", "high", "urgent"];

export const DEFAULT_AGENT = {
  id: "agent-demo",
  name: "Demo Agent",
  email: "agent@deskline.local",
  password: "deskline123",
};

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
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS manufacturers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    details TEXT NOT NULL DEFAULT '',
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

const ASSET_SNAPSHOT_SQL = `id, company_id, manufacturer_id, asset_type_id, name, asset_number, image, person_id, created_at, updated_at`;

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

function writeSqliteSnapshot(database, data) {
  database.exec("PRAGMA foreign_keys = OFF;");
  database.exec("BEGIN IMMEDIATE");
  try {
    const savedAssets = database
      .prepare(`SELECT ${ASSET_SNAPSHOT_SQL} FROM assets`)
      .all();
    const savedCompanies = database
      .prepare(`SELECT id, name, details, image FROM companies`)
      .all();
    database.exec(`
      DELETE FROM comments; DELETE FROM tickets; DELETE FROM people;
      DELETE FROM sessions; DELETE FROM agents;
      DELETE FROM assets;
    `);
    const insertAgent = database.prepare(
      `INSERT INTO agents (id, name, email, phone, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const agent of data.agents ?? []) {
      insertAgent.run(
        agent.id,
        agent.name,
        agent.email,
        agent.phone ?? "",
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
    const insertPerson = database.prepare(
      `INSERT INTO people (id, company_id, name, email, phone, image, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)`
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
    for (const company of incomingCompanies) {
      for (const person of company.people ?? []) {
        insertPerson.run(
          person.id,
          company.id,
          person.name,
          person.email,
          person.phone ?? "",
          person.image ?? "",
          person.passwordHash ?? ""
        );
      }
    }
    const insertTicket = database.prepare(
      `INSERT INTO tickets (id, title, description, company_id, person_id, priority, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertComment = database.prepare(
      `INSERT INTO comments (id, ticket_id, author, agent_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const ticket of data.tickets ?? []) {
      insertTicket.run(
        ticket.id, ticket.title, ticket.description, ticket.companyId, ticket.personId,
        ticket.priority, ticket.status, ticket.createdAt, ticket.updatedAt
      );
      for (const comment of ticket.comments ?? []) {
        insertComment.run(comment.id, ticket.id, comment.author, comment.agentId ?? null, comment.body, comment.createdAt);
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
    const companyIds = incomingCompanyIds;
    const insertAsset = database.prepare(
      `INSERT INTO assets (${ASSET_SNAPSHOT_SQL}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const asset of savedAssets) {
      if (!companyIds.has(asset.company_id)) continue;
      insertAsset.run(...assetSnapshotValues(asset));
    }
    database.exec(
      `DELETE FROM assets WHERE company_id NOT IN (SELECT id FROM companies)`
    );
    database.exec(
      `UPDATE assets SET person_id = NULL
       WHERE person_id IS NOT NULL AND person_id != ''
         AND NOT EXISTS (
           SELECT 1 FROM people p
           WHERE p.id = assets.person_id AND p.company_id = assets.company_id
         )`
    );
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
      `SELECT id, name, email, phone, password_hash AS passwordHash, created_at AS createdAt, updated_at AS updatedAt
       FROM agents ORDER BY name`
    )
    .all()
    .map((a) => ({
      ...a,
      phone: a.phone || undefined,
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
          `SELECT id, name, email, phone, image, password_hash AS passwordHash
           FROM people WHERE company_id = ? ORDER BY name`
        )
        .all(company.id)
        .map((p) => ({
          ...p,
          phone: p.phone || undefined,
          image: p.image || undefined,
          passwordHash: p.passwordHash || undefined,
        })),
    }));
  const tickets = database
    .prepare(
      `SELECT id, title, description, company_id AS companyId, person_id AS personId,
              priority, status, created_at AS createdAt, updated_at AS updatedAt
       FROM tickets ORDER BY updated_at DESC`
    )
    .all()
    .map((ticket) => ({
      ...ticket,
      comments: database
        .prepare(
          `SELECT id, author, agent_id AS agentId, body, created_at AS createdAt
           FROM comments WHERE ticket_id = ? ORDER BY created_at DESC`
        )
        .all(ticket.id)
        .map((c) => ({ ...c, agentId: c.agentId ?? undefined })),
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
    const { rows: savedCompanies } = await client.query(
      `SELECT id, name, details, image FROM companies`
    );
    await client.query(`
      DELETE FROM comments; DELETE FROM tickets; DELETE FROM people;
      DELETE FROM sessions; DELETE FROM agents;
      DELETE FROM assets;
    `);
    for (const agent of data.agents ?? []) {
      await client.query(
        `INSERT INTO agents (id, name, email, phone, password_hash, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          agent.id,
          agent.name,
          agent.email,
          agent.phone ?? "",
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
    for (const company of incomingCompanies) {
      for (const person of company.people ?? []) {
        await client.query(
          `INSERT INTO people (id, company_id, name, email, phone, image, password_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            person.id,
            company.id,
            person.name,
            person.email,
            person.phone ?? "",
            person.image ?? "",
            person.passwordHash ?? "",
          ]
        );
      }
    }
    for (const ticket of data.tickets ?? []) {
      await client.query(
        `INSERT INTO tickets (id, title, description, company_id, person_id, priority, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          ticket.id, ticket.title, ticket.description, ticket.companyId, ticket.personId,
          ticket.priority, ticket.status, ticket.createdAt, ticket.updatedAt,
        ]
      );
      for (const comment of ticket.comments ?? []) {
        await client.query(
          `INSERT INTO comments (id, ticket_id, author, agent_id, body, created_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [comment.id, ticket.id, comment.author, comment.agentId ?? null, comment.body, comment.createdAt]
        );
      }
    }
    for (const session of data.sessions ?? []) {
      await client.query(
        `INSERT INTO sessions (token, agent_id, person_id, created_at) VALUES ($1,$2,$3,$4)`,
        [session.token, session.agentId ?? null, session.personId ?? null, session.createdAt]
      );
    }
    const companyIds = incomingCompanyIds;
    for (const asset of savedAssets) {
      if (!companyIds.has(asset.company_id)) continue;
      await client.query(
        `INSERT INTO assets (${ASSET_SNAPSHOT_SQL})
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        assetSnapshotValues(asset)
      );
    }
    await client.query(
      `DELETE FROM assets WHERE company_id NOT IN (SELECT id FROM companies)`
    );
    await client.query(
      `UPDATE assets SET person_id = NULL
       WHERE person_id IS NOT NULL AND person_id != ''
         AND NOT EXISTS (
           SELECT 1 FROM people p
           WHERE p.id = assets.person_id AND p.company_id = assets.company_id
         )`
    );
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
      `SELECT id, name, email, phone, password_hash AS "passwordHash", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM agents ORDER BY name`
    )
  ).rows.map((a) => ({
    ...a,
    phone: a.phone || undefined,
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
        `SELECT id, name, email, phone, image, password_hash AS "passwordHash"
         FROM people WHERE company_id = $1 ORDER BY name`,
        [company.id]
      )
    ).rows.map((p) => ({
      ...p,
      phone: p.phone || undefined,
      image: p.image || undefined,
      passwordHash: p.passwordHash || undefined,
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
              priority, status, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM tickets ORDER BY updated_at DESC`
    )
  ).rows;
  const tickets = [];
  for (const ticket of ticketRows) {
    const comments = (
      await pool.query(
        `SELECT id, author, agent_id AS "agentId", body, created_at AS "createdAt"
         FROM comments WHERE ticket_id = $1 ORDER BY created_at DESC`,
        [ticket.id]
      )
    ).rows.map((c) => ({ ...c, agentId: c.agentId ?? undefined }));
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
  const agentCols = sqliteDb.prepare(`PRAGMA table_info(agents)`).all();
  if (!agentCols.some((col) => col.name === "phone")) {
    sqliteDb.exec(`ALTER TABLE agents ADD COLUMN phone TEXT NOT NULL DEFAULT ''`);
  }
  const assetTypeCols = sqliteDb.prepare(`PRAGMA table_info(asset_types)`).all();
  if (assetTypeCols.length && !assetTypeCols.some((col) => col.name === "image")) {
    sqliteDb.exec(`ALTER TABLE asset_types ADD COLUMN image TEXT NOT NULL DEFAULT ''`);
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
  migrateSessionsTable(sqliteDb);
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
    `ALTER TABLE agents ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT ''`
  );
  await pgPool.query(
    `ALTER TABLE asset_types ADD COLUMN IF NOT EXISTS image TEXT NOT NULL DEFAULT ''`
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
    `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS person_id TEXT REFERENCES people(id) ON DELETE CASCADE`
  );
  await pgPool.query(`ALTER TABLE sessions ALTER COLUMN agent_id DROP NOT NULL`);
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

const manufacturerCatalog = createNamedCatalog("manufacturers");
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
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name || "",
    assetNumber: row.assetNumber || "",
    image: row.image || "",
    personId,
    manufacturerId: row.manufacturerId,
    assetTypeId: row.assetTypeId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    manufacturer: {
      id: row.manufacturerId,
      name: row.manufacturerName || "Unknown manufacturer",
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
  };
}

const ASSET_SELECT_SQLITE = `
  SELECT a.id, a.company_id AS companyId, a.name, a.asset_number AS assetNumber, a.image,
         a.person_id AS personId, a.manufacturer_id AS manufacturerId, a.asset_type_id AS assetTypeId,
         a.created_at AS createdAt, a.updated_at AS updatedAt,
         m.name AS manufacturerName, t.name AS assetTypeName, t.image AS assetTypeImage,
         p.name AS personName, p.image AS personImage
  FROM assets a
  LEFT JOIN manufacturers m ON m.id = a.manufacturer_id
  LEFT JOIN asset_types t ON t.id = a.asset_type_id
  LEFT JOIN people p ON p.id = a.person_id
`;

const ASSET_SELECT_PG = `
  SELECT a.id, a.company_id AS "companyId", a.name, a.asset_number AS "assetNumber", a.image,
         a.person_id AS "personId", a.manufacturer_id AS "manufacturerId", a.asset_type_id AS "assetTypeId",
         a.created_at AS "createdAt", a.updated_at AS "updatedAt",
         m.name AS "manufacturerName", t.name AS "assetTypeName", t.image AS "assetTypeImage",
         p.name AS "personName", p.image AS "personImage"
  FROM assets a
  LEFT JOIN manufacturers m ON m.id = a.manufacturer_id
  LEFT JOIN asset_types t ON t.id = a.asset_type_id
  LEFT JOIN people p ON p.id = a.person_id
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
      `INSERT INTO assets (id, company_id, manufacturer_id, asset_type_id, name, asset_number, image, person_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        asset.id,
        asset.companyId,
        asset.manufacturerId,
        asset.assetTypeId,
        asset.name ?? "",
        asset.assetNumber ?? "",
        asset.image ?? "",
        asset.personId || null,
        asset.createdAt,
        asset.updatedAt,
      ]
    );
    return findAssetById(asset.companyId, asset.id);
  }
  getSqlite()
    .prepare(
      `INSERT INTO assets (id, company_id, manufacturer_id, asset_type_id, name, asset_number, image, person_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    manufacturerId: fields.manufacturerId ?? current.manufacturerId,
    assetTypeId: fields.assetTypeId ?? current.assetTypeId,
    updatedAt: new Date().toISOString(),
  };
  await ensureReady();
  if (usePostgres()) {
    await (
      await getPg()
    ).query(
      `UPDATE assets SET name = $1, asset_number = $2, image = $3, person_id = $4, manufacturer_id = $5, asset_type_id = $6, updated_at = $7
       WHERE company_id = $8 AND id = $9`,
      [
        next.name ?? "",
        next.assetNumber ?? "",
        next.image ?? "",
        next.personId || null,
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
      `UPDATE assets SET name = ?, asset_number = ?, image = ?, person_id = ?, manufacturer_id = ?, asset_type_id = ?, updated_at = ?
       WHERE company_id = ? AND id = ?`
    )
    .run(
      next.name ?? "",
      next.assetNumber ?? "",
      next.image ?? "",
      next.personId || null,
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
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

function enrichTicket(db, ticket) {
  const company = findCompany(db, ticket.companyId);
  const person = findPerson(company, ticket.personId);
  return {
    ...ticket,
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

export {
  STATUSES,
  PRIORITIES,
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
  findAssetByNumber,
  insertAsset,
  updateAssetRecord,
  removeAsset,
  removeAssetsForCompany,
  removeCompany,
};
