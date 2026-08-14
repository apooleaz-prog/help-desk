#!/usr/bin/env bash
# Migrate local SQLite data into Postgres (DATABASE_URL required).
set -euo pipefail
export PATH="${HOME}/.local/node/bin:${HOME}/.local/bin:${PATH}"
cd "$(dirname "$0")/../server"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Set DATABASE_URL first, e.g.:"
  echo '  export DATABASE_URL="postgres://deskline:PASS@HOST:5432/helpdesk"'
  exit 1
fi

node --input-type=module <<'EOF'
import { DatabaseSync } from "node:sqlite";
import path from "path";
import { fileURLToPath } from "url";
import { readDb as readTarget, writeDb as writeTarget, ensureReady } from "./src/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlitePath = path.join(__dirname, "data", "helpdesk.db");
const sqlite = new DatabaseSync(sqlitePath);

function readSqlite() {
  const agents = sqlite.prepare(
    `SELECT id, name, email, phone, password_hash AS passwordHash, created_at AS createdAt, updated_at AS updatedAt FROM agents`
  ).all().map((a) => ({
    ...a,
    phone: a.phone || undefined,
  }));
  const sessions = sqlite.prepare(
    `SELECT token, agent_id AS agentId, created_at AS createdAt FROM sessions`
  ).all();
  const companies = sqlite.prepare(`SELECT id, name, details, image FROM companies`).all().map((c) => ({
    ...c,
    image: c.image || undefined,
    people: sqlite.prepare(
      `SELECT id, name, email, phone, image, password_hash AS passwordHash FROM people WHERE company_id = ?`
    ).all(c.id)
      .map((p) => ({
        ...p,
        phone: p.phone || undefined,
        image: p.image || undefined,
        passwordHash: p.passwordHash || undefined,
      })),
  }));
  const tickets = sqlite.prepare(
    `SELECT id, title, description, company_id AS companyId, person_id AS personId, priority, status, created_at AS createdAt, updated_at AS updatedAt FROM tickets`
  ).all().map((t) => ({
    ...t,
    comments: sqlite.prepare(
      `SELECT id, author, agent_id AS agentId, body, created_at AS createdAt FROM comments WHERE ticket_id = ?`
    ).all(t.id),
  }));
  return { agents, sessions, companies, tickets };
}

await ensureReady();
const data = readSqlite();
// clear sessions for clean prod login
data.sessions = [];
await writeTarget(data);
const check = await readTarget();
console.log(`Migrated agents=${check.agents.length} companies=${check.companies.length} tickets=${check.tickets.length}`);
EOF
