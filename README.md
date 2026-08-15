# Help Desk

Simple help desk built with **Express** (Node.js) and **React** (Vite).

## Features

- Support **agent login** (session token)
- Manage **agents** (add / edit / remove)
- Registered **companies** with **people** (customers)
- Create tickets assigned to a company contact
- Filter/search by status, company, person
- Update status and priority
- Add comments on tickets (authored by signed-in agent)
- Seeded demo data on first run (**SQLite** database)

## Default login

```
agent@deskline.local
deskline123
```

## Setup

Requires Node.js 22+ (uses built-in `node:sqlite`).

```bash
export PATH="$HOME/.local/node/bin:$PATH"   # if you installed Node locally
cd server && npm install
cd ../client && npm install
```

## Run

In two terminals:

```bash
# API — http://localhost:3001
cd server && npm run dev

# UI — http://localhost:5173
cd client && npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The Vite dev server proxies `/api` to the Express backend.

## Interactive SQL (sqlite3)

Database file: `server/data/helpdesk.db`

```bash
cd server
npm run db:shell
# or:
sqlite3 data/helpdesk.db
```

Useful commands inside the shell:

```sql
.tables
.schema tickets
SELECT id, title, status, priority FROM tickets;
SELECT c.name, p.name, p.email FROM companies c JOIN people p ON p.company_id = c.id;
.quit
```

Tables: `agents`, `sessions`, `companies`, `people`, `tickets`, `comments`.

## API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/login` | Sign in (`email`, `password`) |
| `POST` | `/api/auth/logout` | Sign out |
| `GET` | `/api/auth/me` | Current agent |
| `GET` | `/api/agents` | List agents |
| `POST` | `/api/agents` | Create agent |
| `PATCH` | `/api/agents/:id` | Update agent |
| `DELETE` | `/api/agents/:id` | Remove agent |
| `GET` | `/api/companies` | List companies and their people |
| `GET` | `/api/companies/:id` | Get one company |
| `POST` | `/api/companies` | Create company (optional `people`) |
| `POST` | `/api/companies/:id/people` | Add a person to a company |
| `GET` | `/api/tickets` | List tickets (`?status=&q=&companyId=`) |
| `GET` | `/api/tickets/:id` | Get one ticket |
| `POST` | `/api/tickets` | Create ticket (`companyId`, `personId`) |
| `PATCH` | `/api/tickets/:id` | Update status/priority/company/person |
| `POST` | `/api/tickets/:id/comments` | Add comment |
