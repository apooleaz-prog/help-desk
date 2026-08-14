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
  publicAgent,
  publicCompany,
  publicPerson,
  ensureReady,
  readDb,
  writeDb,
} from "./db.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "3mb" }));

const PERSON_IMAGE_MAX = 2_000_000;
const PERSON_IMAGE_RE = /^data:image\/(jpeg|jpg|png|gif|webp);base64,/i;

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

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email?.trim() || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const db = await readDb();
  const agent = db.agents.find(
    (a) => a.email.toLowerCase() === email.trim().toLowerCase()
  );
  if (!agent || !verifyPassword(password, agent.passwordHash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = await createSession(agent.id);
  res.json({ token, agent: publicAgent(agent) });
});

app.post("/api/auth/logout", async (req, res) => {
  const token = getBearerToken(req);
  if (token) {
    await destroySession(token);
  }
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  res.json({ agent: req.agent });
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

app.get("/api/agents", async (_req, res) => {
  const { agents } = await readDb();
  const sorted = [...agents]
    .map(publicAgent)
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json(sorted);
});

app.post("/api/agents", async (req, res) => {
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

app.patch("/api/agents/:id", async (req, res) => {
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

app.delete("/api/agents/:id", async (req, res) => {
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

app.get("/api/companies", async (_req, res) => {
  const { companies } = await readDb();
  const sorted = [...companies]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(publicCompany);
  res.json(sorted);
});

app.get("/api/companies/:id", async (req, res) => {
  const company = findCompany(await readDb(), req.params.id);
  if (!company) {
    return res.status(404).json({ error: "Company not found" });
  }
  res.json(publicCompany(company));
});

app.post("/api/companies", async (req, res) => {
  const { name, details = "", people = [], image } = req.body ?? {};

  if (!name?.trim()) {
    return res.status(400).json({ error: "name is required" });
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

app.patch("/api/companies/:id", async (req, res) => {
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

app.post("/api/companies/:id/people", async (req, res) => {
  const { name, email, phone, image, password } = req.body ?? {};

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

  const person = {
    id: uuidv4(),
    name: name.trim(),
    email: normalizedEmail,
    passwordHash: hashPassword(password),
    ...(normalizedPhone ? { phone: normalizedPhone } : {}),
    ...(normalizedImage ? { image: normalizedImage } : {}),
  };

  db.companies[index].people.push(person);
  await writeDb(db);

  res.status(201).json(publicPerson(person));
});

app.patch("/api/companies/:companyId/people/:personId", async (req, res) => {
  const { name, email, phone, image, password } = req.body ?? {};
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

  people[personIndex] = person;
  db.companies[companyIndex].people = people;
  await writeDb(db);

  res.json(publicPerson(person));
});

app.delete("/api/companies/:id", async (req, res) => {
  const db = await readDb();
  const index = db.companies.findIndex((c) => c.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: "Company not found" });
  }

  const [removed] = db.companies.splice(index, 1);
  const removedTickets = db.tickets.filter((t) => t.companyId === removed.id);
  db.tickets = db.tickets.filter((t) => t.companyId !== removed.id);
  await writeDb(db);

  res.json({
    ok: true,
    deletedPeople: removed.people.length,
    deletedTickets: removedTickets.length,
  });
});

app.get("/api/tickets", async (req, res) => {
  const { status, q, companyId, priority } = req.query;
  const db = await readDb();
  let tickets = db.tickets.map((t) => enrichTicket(db, t));

  if (status && status !== "all") {
    tickets = tickets.filter((t) => t.status === status);
  }

  if (priority && priority !== "all") {
    tickets = tickets.filter((t) => t.priority === priority);
  }

  if (companyId) {
    tickets = tickets.filter((t) => t.companyId === companyId);
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
  res.json(enrichTicket(db, ticket));
});

app.post("/api/tickets", async (req, res) => {
  const {
    title,
    description,
    companyId,
    personId,
    priority = "medium",
  } = req.body ?? {};

  if (!title?.trim() || !description?.trim() || !companyId || !personId) {
    return res.status(400).json({
      error: "title, description, companyId, and personId are required",
    });
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
    priority,
    status: "open",
    createdAt: now,
    updatedAt: now,
    comments: [],
  };

  db.tickets.unshift(ticket);
  await writeDb(db);

  res.status(201).json(enrichTicket(db, ticket));
});

app.patch("/api/tickets/:id", async (req, res) => {
  const db = await readDb();
  const index = db.tickets.findIndex((t) => t.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  const { status, priority, companyId, personId } = req.body ?? {};
  const ticket = db.tickets[index];

  if (status !== undefined) {
    if (!STATUSES.includes(status)) {
      return res
        .status(400)
        .json({ error: `status must be one of: ${STATUSES.join(", ")}` });
    }
    ticket.status = status;
  }

  if (priority !== undefined) {
    if (!PRIORITIES.includes(priority)) {
      return res
        .status(400)
        .json({ error: `priority must be one of: ${PRIORITIES.join(", ")}` });
    }
    ticket.priority = priority;
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

  ticket.updatedAt = new Date().toISOString();
  db.tickets[index] = ticket;
  await writeDb(db);

  res.json(enrichTicket(db, ticket));
});

app.post("/api/tickets/:id/comments", async (req, res) => {
  const { body } = req.body ?? {};
  if (!body?.trim()) {
    return res.status(400).json({ error: "body is required" });
  }

  const db = await readDb();
  const index = db.tickets.findIndex((t) => t.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  const comment = {
    id: uuidv4(),
    author: req.agent.name,
    agentId: req.agent.id,
    body: body.trim(),
    createdAt: new Date().toISOString(),
  };

  db.tickets[index].comments.push(comment);
  db.tickets[index].updatedAt = comment.createdAt;
  await writeDb(db);

  res.status(201).json(comment);
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
