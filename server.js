const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const mineflayer = require("mineflayer");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────
const CONFIG_FILE = path.join(__dirname, "config.json");

function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch {}
  }
  return {
    host: "yosef2903.aternos.me",
    port: 39695,
    username: "AternosGuard",
    reconnectDelay: 10000,
    pingInterval: 60000,
    version: "1.20.1"
  };
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

let config = loadConfig();

// ──────────────────────────────────────────────
// State
// ──────────────────────────────────────────────
let bot = null;
let botStatus = "stopped";   // stopped | connecting | online | error
let serverStatus = "unknown"; // unknown | online | offline
let reconnectAttempts = 0;
let lastPing = null;
let pingTimer = null;
let reconnectTimer = null;
let botStartTime = null;
let isRunning = false;
const logs = [];
const MAX_LOGS = 500;

// ──────────────────────────────────────────────
// Logging
// ──────────────────────────────────────────────
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

// ──────────────────────────────────────────────
// WebSocket broadcast
// ──────────────────────────────────────────────
function broadcast(msg) {
  const str = JSON.stringify(msg);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(str); });
}

function broadcastStatus() {
  broadcast({
    type: "status",
    data: {
      botStatus,
      serverStatus,
      reconnectAttempts,
      lastPing,
      uptime: botStartTime ? Date.now() - botStartTime : 0,
      isRunning,
      config: { host: config.host, port: config.port, username: config.username }
    }
  });
}

// ──────────────────────────────────────────────
// Bot logic
// ──────────────────────────────────────────────
function createBot() {
  if (!isRunning) return;

  botStatus = "connecting";
  broadcastStatus();
  addLog("INFO", `Connecting to ${config.host}:${config.port} as ${config.username}...`);

  try {
    bot = mineflayer.createBot({
      host: config.host,
      port: parseInt(config.port),
      username: config.username,
      version: config.version || false,
      auth: "offline",
      checkTimeoutInterval: 30000,
      keepAlive: true
    });
  } catch (err) {
    addLog("ERROR", `Failed to create bot: ${err.message}`);
    scheduleReconnect();
    return;
  }

  bot.on("login", () => {
    botStatus = "online";
    serverStatus = "online";
    reconnectAttempts = 0;
    botStartTime = botStartTime || Date.now();
    lastPing = new Date().toISOString();
    addLog("SUCCESS", `✓ Joined server successfully as ${bot.username}`);
    broadcastStatus();
    startPingTimer();
  });

  bot.on("spawn", () => {
    addLog("INFO", `Bot spawned in world`);
  });

  bot.on("kicked", (reason) => {
    addLog("WARNING", `Kicked from server: ${reason}`);
    stopPingTimer();
    serverStatus = "offline";
    botStatus = "error";
    broadcastStatus();
    scheduleReconnect();
  });

  bot.on("error", (err) => {
    addLog("ERROR", `Bot error: ${err.message}`);
    stopPingTimer();
    if (err.code === "ECONNREFUSED") {
      serverStatus = "offline";
      addLog("WARNING", "Server appears to be offline (connection refused)");
    }
    botStatus = "error";
    broadcastStatus();
  });

  bot.on("end", (reason) => {
    addLog("WARNING", `Connection ended: ${reason || "unknown reason"}`);
    stopPingTimer();
    botStatus = isRunning ? "connecting" : "stopped";
    broadcastStatus();
    if (isRunning) scheduleReconnect();
  });

  bot.on("_message", () => {
    lastPing = new Date().toISOString();
  });
}

function scheduleReconnect() {
  if (!isRunning) return;
  clearTimeout(reconnectTimer);
  reconnectAttempts++;
  addLog("INFO", `Reconnecting in ${config.reconnectDelay / 1000}s (attempt #${reconnectAttempts})...`);
  reconnectTimer = setTimeout(() => {
    if (isRunning) createBot();
  }, config.reconnectDelay);
}

function startPingTimer() {
  stopPingTimer();
  pingTimer = setInterval(() => {
    if (bot && bot.entity) {
      try {
        // Keep-alive: look around slightly to prevent idle kick
        bot.look(bot.entity.yaw + 0.01, bot.entity.pitch, false);
        lastPing = new Date().toISOString();
        addLog("PING", "Keep-alive sent");
        broadcastStatus();
      } catch {}
    }
  }, config.pingInterval);
}

function stopPingTimer() {
  clearInterval(pingTimer);
  pingTimer = null;
}

function startBot() {
  if (isRunning) return { success: false, message: "Bot already running" };
  isRunning = true;
  botStartTime = null;
  reconnectAttempts = 0;
  addLog("INFO", "Bot started by user");
  createBot();
  return { success: true };
}

function stopBot() {
  if (!isRunning) return { success: false, message: "Bot not running" };
  isRunning = false;
  clearTimeout(reconnectTimer);
  stopPingTimer();
  if (bot) {
    try { bot.quit("Stopped by user"); } catch {}
    bot = null;
  }
  botStatus = "stopped";
  serverStatus = "unknown";
  addLog("INFO", "Bot stopped by user");
  broadcastStatus();
  return { success: true };
}

function restartBot() {
  addLog("INFO", "Restarting bot...");
  stopBot();
  setTimeout(() => startBot(), 2000);
  return { success: true };
}

// ──────────────────────────────────────────────
// API Routes
// ──────────────────────────────────────────────
app.get("/api/status", (req, res) => {
  res.json({
    botStatus, serverStatus, reconnectAttempts, lastPing,
    uptime: botStartTime ? Date.now() - botStartTime : 0,
    isRunning,
    config: { host: config.host, port: config.port, username: config.username, reconnectDelay: config.reconnectDelay, pingInterval: config.pingInterval }
  });
});

app.get("/api/logs", (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json(logs.slice(-limit));
});

app.post("/api/start", (req, res) => res.json(startBot()));
app.post("/api/stop", (req, res) => res.json(stopBot()));
app.post("/api/restart", (req, res) => res.json(restartBot()));

app.get("/api/config", (req, res) => res.json(config));

app.post("/api/config", (req, res) => {
  const { host, port, username, reconnectDelay, pingInterval, version } = req.body;
  if (host) config.host = host;
  if (port) config.port = parseInt(port);
  if (username) config.username = username;
  if (reconnectDelay) config.reconnectDelay = parseInt(reconnectDelay);
  if (pingInterval) config.pingInterval = parseInt(pingInterval);
  if (version) config.version = version;
  saveConfig(config);
  addLog("INFO", "Configuration updated");
  res.json({ success: true, config });
});

// ──────────────────────────────────────────────
// WebSocket
// ──────────────────────────────────────────────
wss.on("connection", (ws) => {
  // Send current state to new client
  ws.send(JSON.stringify({ type: "init", data: { logs: logs.slice(-100), botStatus, serverStatus, reconnectAttempts, lastPing, uptime: botStartTime ? Date.now() - botStartTime : 0, isRunning } }));

  ws.on("message", (msg) => {
    try {
      const { action } = JSON.parse(msg);
      if (action === "start") startBot();
      if (action === "stop") stopBot();
      if (action === "restart") restartBot();
    } catch {}
  });
});

// ──────────────────────────────────────────────
// Start server
// ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🛡  Aternos Guard running on http://localhost:${PORT}\n`);
  addLog("INFO", `Aternos Guard server started on port ${PORT}`);
});

// Auto-start bot on launch
setTimeout(() => startBot(), 1500);
