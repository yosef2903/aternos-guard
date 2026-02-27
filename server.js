const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const mineflayer = require("mineflayer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const CONFIG_FILE = path.join(__dirname, "config.json");
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const ROLE_PERMISSIONS = {
  admin: [
    "status:read",
    "logs:read",
    "bot:control",
    "config:read",
    "config:write",
    "users:read",
    "users:write"
  ],
  operator: ["status:read", "logs:read", "bot:control", "config:read"],
  viewer: ["status:read", "logs:read", "config:read"]
};

const VALID_ROLES = Object.keys(ROLE_PERMISSIONS);

const DEFAULT_CONFIG = {
  host: "yosef2903.aternos.me",
  port: 39695,
  username: "AternosGuard",
  reconnectDelay: 15000,
  pingInterval: 45000,
  version: "1.20.1",
  users: []
};

function toPositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function makeUserToken(prefix = "usr") {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

function normalizeUser(rawUser) {
  if (!rawUser || typeof rawUser !== "object") return null;

  const name = String(rawUser.name || "").trim();
  const token = String(rawUser.token || "").trim();
  const role = VALID_ROLES.includes(rawUser.role) ? rawUser.role : "viewer";

  if (!name || !token) return null;

  return {
    id: String(rawUser.id || crypto.randomUUID()),
    name,
    role,
    token,
    createdAt: rawUser.createdAt || new Date().toISOString(),
    lastLoginAt: rawUser.lastLoginAt || null
  };
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function loadConfig() {
  let raw = {};

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    } catch (err) {
      console.error("[CONFIG] Failed to parse config.json, using defaults:", err.message);
    }
  }

  const cfg = {
    ...DEFAULT_CONFIG,
    ...raw
  };

  cfg.host = String(cfg.host || DEFAULT_CONFIG.host).trim();
  cfg.port = toPositiveInt(cfg.port, DEFAULT_CONFIG.port);
  cfg.username = String(cfg.username || DEFAULT_CONFIG.username).trim();
  cfg.reconnectDelay = toPositiveInt(cfg.reconnectDelay, DEFAULT_CONFIG.reconnectDelay);
  cfg.pingInterval = toPositiveInt(cfg.pingInterval, DEFAULT_CONFIG.pingInterval);
  cfg.version = String(cfg.version || DEFAULT_CONFIG.version).trim();
  cfg.users = Array.isArray(raw.users) ? raw.users.map(normalizeUser).filter(Boolean) : [];

  if (cfg.users.length === 0) {
    const initialToken = process.env.ADMIN_TOKEN || makeUserToken("admin");
    cfg.users.push({
      id: crypto.randomUUID(),
      name: "Owner",
      role: "admin",
      token: initialToken,
      createdAt: new Date().toISOString(),
      lastLoginAt: null
    });
    console.log(`[AUTH] Initial admin token: ${initialToken}`);
  }

  return cfg;
}

let config = loadConfig();
saveConfig(config);

const sessions = new Map();

function maskToken(token) {
  if (!token) return "unset";
  if (token.length <= 8) return `${token[0]}***`;
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function getPermissions(role) {
  return ROLE_PERMISSIONS[role] || [];
}

function sanitizeUser(user, includeToken = false) {
  const base = {
    id: user.id,
    name: user.name,
    role: user.role,
    tokenPreview: maskToken(user.token),
    createdAt: user.createdAt || null,
    lastLoginAt: user.lastLoginAt || null
  };

  if (includeToken) base.token = user.token;
  return base;
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [sessionToken, session] of sessions.entries()) {
    if (session.expiresAt <= now) sessions.delete(sessionToken);
  }
}

const sessionSweepTimer = setInterval(pruneExpiredSessions, 60_000);
if (typeof sessionSweepTimer.unref === "function") sessionSweepTimer.unref();

function revokeSessionsForUser(userId) {
  for (const [sessionToken, session] of sessions.entries()) {
    if (session.userId === userId) sessions.delete(sessionToken);
  }
}

function findUserByToken(token) {
  return config.users.find((user) => user.token === token) || null;
}

function createSession(user) {
  const sessionToken = crypto.randomBytes(24).toString("hex");
  sessions.set(sessionToken, {
    userId: user.id,
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  return sessionToken;
}

function resolveAuthFromToken(sessionToken) {
  if (!sessionToken) return null;
  const session = sessions.get(sessionToken);
  if (!session) return null;

  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionToken);
    return null;
  }

  const user = config.users.find((candidate) => candidate.id === session.userId);
  if (!user) {
    sessions.delete(sessionToken);
    return null;
  }

  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return { user, session };
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return null;
}

function requireAuth(req, res, next) {
  const sessionToken = getBearerToken(req);
  const resolved = resolveAuthFromToken(sessionToken);

  if (!resolved) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  req.sessionToken = sessionToken;
  req.user = resolved.user;
  req.permissions = getPermissions(resolved.user.role);
  next();
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (req.permissions.includes(permission)) return next();
    return res.status(403).json({ success: false, message: `Missing permission: ${permission}` });
  };
}

let bot = null;
let botStatus = "stopped";
let serverStatus = "unknown";
let reconnectAttempts = 0;
let lastPing = null;
let lastBotEventAt = Date.now();
let botStartTime = null;
let isRunning = false;
let pingTimer = null;
let reconnectTimer = null;
let healthTimer = null;
let keepAlivePulseCount = 0;

const logs = [];
const MAX_LOGS = 500;

function addLog(level, message) {
  const entry = {
    id: Date.now() + Math.random(),
    time: new Date().toISOString(),
    level,
    message
  };

  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();

  broadcast({ type: "log", data: entry });
  console.log(`[${level}] ${message}`);
}

function actorLabel(actor) {
  if (!actor) return "system";
  return `${actor.name} (${actor.role})`;
}

function markBotActivity() {
  lastBotEventAt = Date.now();
}

function buildStatusPayload() {
  return {
    botStatus,
    serverStatus,
    reconnectAttempts,
    lastPing,
    lastEventAt: new Date(lastBotEventAt).toISOString(),
    uptime: botStartTime ? Date.now() - botStartTime : 0,
    isRunning,
    config: {
      host: config.host,
      port: config.port,
      username: config.username,
      reconnectDelay: config.reconnectDelay,
      pingInterval: config.pingInterval,
      version: config.version
    }
  };
}

function broadcast(message) {
  const payload = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function broadcastStatus() {
  broadcast({ type: "status", data: buildStatusPayload() });
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function stopPingTimer() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function stopHealthTimer() {
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
}

function quitBot(reason) {
  if (!bot) return;
  try {
    bot.quit(reason || "restarting");
  } catch {
    // noop
  }
  try {
    bot.removeAllListeners();
  } catch {
    // noop
  }
  bot = null;
}

function queueReconnect(reason) {
  if (!isRunning) return;
  if (reconnectTimer) return;

  reconnectAttempts += 1;
  botStatus = "connecting";
  broadcastStatus();

  const delay = config.reconnectDelay;
  addLog("INFO", `Reconnect in ${Math.round(delay / 1000)}s (attempt #${reconnectAttempts}, reason: ${reason})`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!isRunning) return;
    createBot();
  }, delay);
}

function startPingTimer() {
  stopPingTimer();

  pingTimer = setInterval(() => {
    if (!isRunning || !bot || !bot.entity) return;

    try {
      const yawOffset = (Math.random() * 0.18) - 0.09;
      bot.look(bot.entity.yaw + yawOffset, bot.entity.pitch, true);
      if (Math.random() > 0.65) bot.swingArm("right", true);

      keepAlivePulseCount += 1;
      markBotActivity();
      lastPing = new Date().toISOString();

      if (keepAlivePulseCount % 5 === 0) {
        addLog("PING", "Keep-alive pulse sent");
      }

      broadcastStatus();
    } catch (err) {
      addLog("WARNING", `Keep-alive pulse failed: ${err.message}`);
    }
  }, config.pingInterval);
}

function startHealthTimer() {
  stopHealthTimer();

  healthTimer = setInterval(() => {
    if (!isRunning) return;

    const staleThreshold = Math.max(config.pingInterval * 2, 90_000);
    const staleFor = Date.now() - lastBotEventAt;

    if (botStatus === "online" && staleFor > staleThreshold) {
      addLog("WARNING", `No bot activity for ${Math.round(staleFor / 1000)}s, recycling connection`);
      stopPingTimer();
      quitBot("stale connection");
      botStatus = "error";
      serverStatus = "unknown";
      broadcastStatus();
      queueReconnect("stale heartbeat");
      return;
    }

    if ((botStatus === "error" || botStatus === "connecting") && !reconnectTimer) {
      queueReconnect("health monitor");
    }
  }, 15_000);
}

function createBot() {
  if (!isRunning) return;

  clearReconnectTimer();
  stopPingTimer();
  quitBot("refresh instance");

  botStatus = "connecting";
  serverStatus = "unknown";
  markBotActivity();
  broadcastStatus();

  addLog("INFO", `Connecting to ${config.host}:${config.port} as ${config.username}`);

  try {
    bot = mineflayer.createBot({
      host: config.host,
      port: toPositiveInt(config.port, DEFAULT_CONFIG.port),
      username: config.username,
      version: config.version || false,
      auth: "offline",
      keepAlive: true,
      checkTimeoutInterval: 120_000
    });
  } catch (err) {
    addLog("ERROR", `Failed to create bot: ${err.message}`);
    queueReconnect("create bot failure");
    return;
  }

  bot.once("login", () => {
    botStatus = "online";
    serverStatus = "online";
    reconnectAttempts = 0;
    botStartTime = botStartTime || Date.now();
    lastPing = new Date().toISOString();
    markBotActivity();
    addLog("SUCCESS", `Joined server as ${bot.username}`);
    broadcastStatus();
    startPingTimer();
  });

  bot.on("spawn", () => {
    markBotActivity();
    addLog("INFO", "Bot spawned in world");
  });

  bot.on("kicked", (reason) => {
    markBotActivity();
    stopPingTimer();
    botStatus = "error";
    serverStatus = "offline";
    addLog("WARNING", `Kicked from server: ${String(reason || "unknown")}`);
    broadcastStatus();
    queueReconnect("kicked");
  });

  bot.on("error", (err) => {
    markBotActivity();
    stopPingTimer();
    botStatus = "error";

    if (err && err.code === "ECONNREFUSED") {
      serverStatus = "offline";
      addLog("WARNING", "Server appears offline (connection refused)");
    }

    addLog("ERROR", `Bot error: ${err.message}`);
    broadcastStatus();
    queueReconnect(err.code || "bot error");
  });

  bot.on("end", (reason) => {
    markBotActivity();
    stopPingTimer();
    botStatus = isRunning ? "connecting" : "stopped";
    serverStatus = "unknown";
    addLog("WARNING", `Connection ended: ${reason || "unknown"}`);
    broadcastStatus();
    if (isRunning) queueReconnect("connection ended");
  });

  bot.on("messagestr", () => {
    markBotActivity();
    lastPing = new Date().toISOString();
  });

  if (bot._client && typeof bot._client.on === "function") {
    bot._client.on("keep_alive", () => {
      markBotActivity();
      lastPing = new Date().toISOString();
    });
  }
}

function startBot(actor) {
  if (isRunning) return { success: false, message: "Bot already running" };

  isRunning = true;
  botStartTime = null;
  reconnectAttempts = 0;
  keepAlivePulseCount = 0;
  markBotActivity();

  addLog("INFO", `Bot start requested by ${actorLabel(actor)}`);
  startHealthTimer();
  createBot();

  return { success: true };
}

function stopBot(actor) {
  if (!isRunning) return { success: false, message: "Bot not running" };

  isRunning = false;
  clearReconnectTimer();
  stopPingTimer();
  stopHealthTimer();
  quitBot("stopped by user");

  botStatus = "stopped";
  serverStatus = "unknown";
  markBotActivity();
  addLog("INFO", `Bot stop requested by ${actorLabel(actor)}`);
  broadcastStatus();

  return { success: true };
}

function restartBot(actor) {
  addLog("INFO", `Bot restart requested by ${actorLabel(actor)}`);
  stopBot(actor);
  setTimeout(() => {
    startBot(actor);
  }, 2000);
  return { success: true };
}

app.post("/api/auth/login", (req, res) => {
  const token = String(req.body?.token || "").trim();

  if (!token) {
    return res.status(400).json({ success: false, message: "Token is required" });
  }

  const user = findUserByToken(token);
  if (!user) {
    return res.status(401).json({ success: false, message: "Invalid token" });
  }

  user.lastLoginAt = new Date().toISOString();
  saveConfig(config);

  const sessionToken = createSession(user);
  addLog("SECURITY", `User signed in: ${user.name} (${user.role})`);

  return res.json({
    success: true,
    sessionToken,
    user: sanitizeUser(user),
    permissions: getPermissions(user.role)
  });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  sessions.delete(req.sessionToken);
  return res.json({ success: true });
});

app.get("/api/me", requireAuth, (req, res) => {
  return res.json({
    success: true,
    user: sanitizeUser(req.user),
    permissions: req.permissions
  });
});

app.get("/api/status", requireAuth, requirePermission("status:read"), (req, res) => {
  res.json(buildStatusPayload());
});

app.get("/api/logs", requireAuth, requirePermission("logs:read"), (req, res) => {
  const limit = toPositiveInt(req.query.limit, 100);
  res.json(logs.slice(-Math.min(limit, MAX_LOGS)));
});

app.post("/api/start", requireAuth, requirePermission("bot:control"), (req, res) => {
  res.json(startBot(req.user));
});

app.post("/api/stop", requireAuth, requirePermission("bot:control"), (req, res) => {
  res.json(stopBot(req.user));
});

app.post("/api/restart", requireAuth, requirePermission("bot:control"), (req, res) => {
  res.json(restartBot(req.user));
});

app.get("/api/config", requireAuth, requirePermission("config:read"), (req, res) => {
  res.json({
    host: config.host,
    port: config.port,
    username: config.username,
    reconnectDelay: config.reconnectDelay,
    pingInterval: config.pingInterval,
    version: config.version
  });
});

app.post("/api/config", requireAuth, requirePermission("config:write"), (req, res) => {
  const { host, port, username, reconnectDelay, pingInterval, version } = req.body || {};

  if (typeof host === "string" && host.trim()) config.host = host.trim();
  if (typeof username === "string" && username.trim()) config.username = username.trim();
  if (typeof version === "string" && version.trim()) config.version = version.trim();

  if (port !== undefined) config.port = toPositiveInt(port, config.port);
  if (reconnectDelay !== undefined) config.reconnectDelay = toPositiveInt(reconnectDelay, config.reconnectDelay);
  if (pingInterval !== undefined) config.pingInterval = toPositiveInt(pingInterval, config.pingInterval);

  saveConfig(config);
  addLog("INFO", `Configuration updated by ${req.user.name}`);
  broadcastStatus();

  return res.json({ success: true, config: buildStatusPayload().config });
});

app.get("/api/users", requireAuth, requirePermission("users:read"), (req, res) => {
  return res.json({
    success: true,
    users: config.users.map((user) => sanitizeUser(user))
  });
});

app.post("/api/users", requireAuth, requirePermission("users:write"), (req, res) => {
  const name = String(req.body?.name || "").trim();
  const role = VALID_ROLES.includes(req.body?.role) ? req.body.role : "operator";
  const requestedToken = String(req.body?.token || "").trim();
  const token = requestedToken || makeUserToken();

  if (!name) {
    return res.status(400).json({ success: false, message: "Name is required" });
  }

  if (config.users.some((user) => user.token === token)) {
    return res.status(409).json({ success: false, message: "Token already in use" });
  }

  const newUser = {
    id: crypto.randomUUID(),
    name,
    role,
    token,
    createdAt: new Date().toISOString(),
    lastLoginAt: null
  };

  config.users.push(newUser);
  saveConfig(config);
  addLog("SECURITY", `User created by ${req.user.name}: ${newUser.name} (${newUser.role})`);

  return res.json({
    success: true,
    user: sanitizeUser(newUser, true)
  });
});

app.patch("/api/users/:id", requireAuth, requirePermission("users:write"), (req, res) => {
  const target = config.users.find((user) => user.id === req.params.id);
  if (!target) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const adminCount = config.users.filter((user) => user.role === "admin").length;
  const nextRole = VALID_ROLES.includes(req.body?.role) ? req.body.role : target.role;

  if (target.id === req.user.id && nextRole !== "admin") {
    return res.status(400).json({ success: false, message: "You cannot demote yourself" });
  }

  if (target.role === "admin" && nextRole !== "admin" && adminCount <= 1) {
    return res.status(400).json({ success: false, message: "At least one admin must remain" });
  }

  let includeToken = false;
  let revokeSessions = false;

  const nextName = String(req.body?.name || "").trim();
  if (nextName) target.name = nextName;

  if (nextRole !== target.role) {
    target.role = nextRole;
    revokeSessions = true;
  }

  const providedToken = String(req.body?.token || "").trim();
  if (providedToken) {
    if (config.users.some((user) => user.id !== target.id && user.token === providedToken)) {
      return res.status(409).json({ success: false, message: "Token already in use" });
    }
    target.token = providedToken;
    includeToken = true;
    revokeSessions = true;
  }

  if (req.body?.rotateToken === true) {
    let nextToken = makeUserToken();
    while (config.users.some((user) => user.id !== target.id && user.token === nextToken)) {
      nextToken = makeUserToken();
    }
    target.token = nextToken;
    includeToken = true;
    revokeSessions = true;
  }

  if (revokeSessions) revokeSessionsForUser(target.id);

  saveConfig(config);
  addLog("SECURITY", `User updated by ${req.user.name}: ${target.name} (${target.role})`);

  return res.json({
    success: true,
    user: sanitizeUser(target, includeToken)
  });
});

app.delete("/api/users/:id", requireAuth, requirePermission("users:write"), (req, res) => {
  const target = config.users.find((user) => user.id === req.params.id);
  if (!target) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  if (target.id === req.user.id) {
    return res.status(400).json({ success: false, message: "You cannot delete your own account" });
  }

  const adminCount = config.users.filter((user) => user.role === "admin").length;
  if (target.role === "admin" && adminCount <= 1) {
    return res.status(400).json({ success: false, message: "At least one admin must remain" });
  }

  config.users = config.users.filter((user) => user.id !== target.id);
  revokeSessionsForUser(target.id);
  saveConfig(config);
  addLog("SECURITY", `User deleted by ${req.user.name}: ${target.name}`);

  return res.json({ success: true });
});

wss.on("connection", (ws, req) => {
  let sessionToken = null;

  try {
    const base = `http://${req.headers.host || "localhost"}`;
    const reqUrl = new URL(req.url || "/", base);
    sessionToken = reqUrl.searchParams.get("session");
  } catch {
    // noop
  }

  const resolved = resolveAuthFromToken(sessionToken);
  if (!resolved) {
    ws.send(JSON.stringify({ type: "error", data: { message: "Unauthorized WebSocket" } }));
    ws.close(4001, "unauthorized");
    return;
  }

  const user = resolved.user;
  const permissions = getPermissions(user.role);

  ws.send(
    JSON.stringify({
      type: "init",
      data: {
        ...buildStatusPayload(),
        logs: logs.slice(-120),
        user: sanitizeUser(user),
        permissions
      }
    })
  );

  ws.on("message", (raw) => {
    let payload = null;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }

    if (!payload || !payload.action) return;

    if (!permissions.includes("bot:control")) {
      ws.send(JSON.stringify({ type: "error", data: { message: "Missing permission: bot:control" } }));
      return;
    }

    if (payload.action === "start") ws.send(JSON.stringify({ type: "actionResult", data: startBot(user) }));
    if (payload.action === "stop") ws.send(JSON.stringify({ type: "actionResult", data: stopBot(user) }));
    if (payload.action === "restart") ws.send(JSON.stringify({ type: "actionResult", data: restartBot(user) }));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Aternos Guard running on http://localhost:${PORT}`);
  addLog("INFO", `Server started on port ${PORT}`);
});

setTimeout(() => {
  startBot({ name: "AutoStart", role: "system" });
}, 1500);
