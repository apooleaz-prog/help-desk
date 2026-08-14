import bcrypt from "bcryptjs";
import crypto from "crypto";
import { findAgent, publicAgent, readDb, writeDb } from "./db.js";

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, passwordHash) {
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

    const agent = findAgent(db, session.agentId);
    if (!agent) {
      db.sessions = db.sessions.filter((s) => s.token !== token);
      await writeDb(db);
      return res.status(401).json({ error: "Invalid or expired session" });
    }

    req.token = token;
    req.agent = publicAgent(agent);
    next();
  } catch (err) {
    next(err);
  }
}

async function createSession(agentId) {
  const db = await readDb();
  const token = createToken();
  db.sessions.push({
    token,
    agentId,
    createdAt: new Date().toISOString(),
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

export {
  hashPassword,
  verifyPassword,
  requireAuth,
  createSession,
  destroySession,
  destroySessionsForAgent,
  getBearerToken,
};
