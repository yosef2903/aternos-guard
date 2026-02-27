# 🛡 Aternos Guard — 24/7 Minecraft Uptime Bot

A full web application that keeps your Aternos Minecraft server awake 24/7 using a Mineflayer bot with auto-reconnect, live dashboard, and WebSocket real-time updates.

---

## ✨ Features
- **Modern dark dashboard** with live stats
- **Mineflayer bot** joins and stays in your server
- **Auto-reconnect** — reconnects every 10s if kicked
- **Keep-alive pings** every 60s to prevent idle kick
- **Live terminal** with real-time logs via WebSocket
- **Settings panel** — change host, port, username, intervals
- **Health monitor** — uptime, stability score, connection bars
- **REST API** — `/api/start`, `/api/stop`, `/api/restart`, etc.

---

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start
npm start

# 3. Open browser
# http://localhost:3000
```

---

## ⚙️ Configuration

Edit `config.json` (auto-created on first run) or use the Settings panel:

```json
{
  "host": "yosef2903.aternos.me",
  "port": 39695,
  "username": "AternosGuard",
  "reconnectDelay": 10000,
  "pingInterval": 60000,
  "version": "1.20.1"
}
```

---

## 🌐 Deploy on Render (Free)

1. Push to GitHub
2. Go to [render.com](https://render.com) → New Web Service
3. Connect repo, set:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
4. Deploy — it will auto-restart if it crashes

---

## 🚂 Deploy on Railway

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

---

## 🔁 Deploy on Replit

1. Upload all files to a new Replit Node.js project
2. Click **Run**
3. Enable **"Always On"** in Replit settings

---

## 📡 API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | /api/status | Bot & server status |
| GET | /api/logs | Recent logs |
| POST | /api/start | Start the bot |
| POST | /api/stop | Stop the bot |
| POST | /api/restart | Restart the bot |
| GET | /api/config | Get config |
| POST | /api/config | Update config |

---

## 🎮 Aternos Tips

- Start your Aternos server **before** starting the bot
- Your server must allow **offline mode** (cracked)
- Add the bot username to your **whitelist** if enabled
- Set reconnect delay to `15000`+ ms for Aternos stability

---

## 📦 Stack
- **Backend:** Node.js, Express, Mineflayer, ws
- **Frontend:** HTML/CSS/JS with WebSockets
- **Bot:** Mineflayer (offline auth)
