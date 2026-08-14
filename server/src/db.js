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
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
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

function writeSqliteSnapshot(database, data) {
  database.exec("PRAGMA foreign_keys = OFF;");
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      DELETE FROM comments; DELETE FROM tickets; DELETE FROM people;
      DELETE FROM sessions; DELETE FROM companies; DELETE FROM agents;
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
    const insertCompany = database.prepare(
      `INSERT INTO companies (id, name, details, image) VALUES (?, ?, ?, ?)`
    );
    const insertPerson = database.prepare(
      `INSERT INTO people (id, company_id, name, email, phone, image, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const company of data.companies ?? []) {
      insertCompany.run(
        company.id,
        company.name,
        company.details ?? "",
        company.image ?? ""
      );
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
      `INSERT INTO sessions (token, agent_id, created_at) VALUES (?, ?, ?)`
    );
    for (const session of data.sessions ?? []) {
      insertSession.run(session.token, session.agentId, session.createdAt);
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
      `SELECT id, name, email, phone, password_hash AS passwordHash, created_at AS createdAt, updated_at AS updatedAt
       FROM agents ORDER BY name`
    )
    .all()
    .map((a) => ({
      ...a,
      phone: a.phone || undefined,
    }));
  const sessions = database
    .prepare(`SELECT token, agent_id AS agentId, created_at AS createdAt FROM sessions`)
    .all();
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
    await client.query(`
      DELETE FROM comments; DELETE FROM tickets; DELETE FROM people;
      DELETE FROM sessions; DELETE FROM companies; DELETE FROM agents;
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
    for (const company of data.companies ?? []) {
      await client.query(
        `INSERT INTO companies (id, name, details, image) VALUES ($1,$2,$3,$4)`,
        [company.id, company.name, company.details ?? "", company.image ?? ""]
      );
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
      await client.query(`INSERT INTO sessions (token, agent_id, created_at) VALUES ($1,$2,$3)`, [
        session.token,
        session.agentId,
        session.createdAt,
      ]);
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
      `SELECT id, name, email, phone, password_hash AS "passwordHash", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM agents ORDER BY name`
    )
  ).rows.map((a) => ({
    ...a,
    phone: a.phone || undefined,
  }));
  const sessions = (
    await pool.query(
      `SELECT token, agent_id AS "agentId", created_at AS "createdAt" FROM sessions`
    )
  ).rows;
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
  const agentCount = sqliteDb.prepare(`SELECT COUNT(*) AS c FROM agents`).get().c;
  if (isNew || agentCount === 0) {
    writeSqliteSnapshot(sqliteDb, loadLegacyJson() ?? seedData());
  }
  return sqliteDb;
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

function findCompany(db, companyId) {
  return db.companies.find((c) => c.id === companyId) ?? null;
}

function findPerson(company, personId) {
  return company?.people.find((p) => p.id === personId) ?? null;
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
  findAgent,
  publicAgent,
  publicPerson,
  publicCompany,
  enrichTicket,
};
