import bcrypt from "bcryptjs";
import crypto from "crypto";
import {
  findAgent,
  findPersonById,
  publicAgent,
  publicPortalPerson,
  readDb,
  writeDb,
} from "./db.js";

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, passwordHash) {
  if (!passwordHash) return false;
  return bcrypt.compareSync(password, passwordHash);
}

function getBearerToken(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
}

async function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const db = await readDb();
    const session = db.sessions.find((s) => s.token === token);
    if (!session) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }

    if (session.agentId) {
      const agent = findAgent(db, session.agentId);
      if (!agent) {
        db.sessions = db.sessions.filter((s) => s.token !== token);
        await writeDb(db);
        return res.status(401).json({ error: "Invalid or expired session" });
      }
      req.token = token;
      req.role = "agent";
      req.agent = publicAgent(agent);
      req.person = null;
      return next();
    }

    if (session.personId) {
      const match = findPersonById(db, session.personId);
      if (!match) {
        db.sessions = db.sessions.filter((s) => s.token !== token);
        await writeDb(db);
        return res.status(401).json({ error: "Invalid or expired session" });
      }
      req.token = token;
      req.role = "person";
      req.agent = null;
      req.person = publicPortalPerson(match.person, match.company);
      return next();
    }

    db.sessions = db.sessions.filter((s) => s.token !== token);
    await writeDb(db);
    return res.status(401).json({ error: "Invalid or expired session" });
  } catch (err) {
    next(err);
  }
}

function requireAgent(req, res, next) {
  if (req.role !== "agent" || !req.agent) {
    return res.status(403).json({ error: "Agent access required" });
  }
  next();
}

async function createSession({ agentId, personId } = {}) {
  if ((!agentId && !personId) || (agentId && personId)) {
    throw new Error("Session requires exactly one of agentId or personId");
  }
  const db = await readDb();
  const token = createToken();
  db.sessions.push({
    token,
    createdAt: new Date().toISOString(),
    ...(agentId ? { agentId } : {}),
    ...(personId ? { personId } : {}),
  });
  await writeDb(db);
  return token;
}

async function destroySession(token) {
  const db = await readDb();
  db.sessions = db.sessions.filter((s) => s.token !== token);
  await writeDb(db);
}

async function destroySessionsForAgent(agentId) {
  const db = await readDb();
  db.sessions = db.sessions.filter((s) => s.agentId !== agentId);
  await writeDb(db);
}

async function destroySessionsForPerson(personId) {
  const db = await readDb();
  db.sessions = db.sessions.filter((s) => s.personId !== personId);
  await writeDb(db);
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export {
  hashPassword,
  verifyPassword,
  requireAuth,
  requireAgent,
  createSession,
  destroySession,
  destroySessionsForAgent,
  destroySessionsForPerson,
  createToken,
  hashResetToken,
  getBearerToken,
};
