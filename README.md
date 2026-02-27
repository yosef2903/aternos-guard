# Aternos Guard

A web console that keeps a Mineflayer guard bot connected to your Aternos Minecraft server with auto-reconnect, live logs, and role-based access control.

## Features
- Auto-start + auto-reconnect bot lifecycle
- Health monitor for stale connections
- Real-time WebSocket dashboard and terminal logs
- Team access roles:
  - `admin`: full control (bot + config + users)
  - `operator`: start/stop/restart + read status
  - `viewer`: read-only status and logs
- Token-based login for panel access

## Quick Start
```bash
npm install
npm start
```
Then open `http://localhost:3000`.

## First Login
On first run, if no users are in `config.json`, the server creates an initial admin user and prints the admin token in logs.

You can also set your own initial admin token with:
```bash
ADMIN_TOKEN=admin_mysecuretoken npm start
```

## Config File
`config.json` is auto-created and stores bot settings + users.

Example:
```json
{
  "host": "yourserver.aternos.me",
  "port": 25565,
  "username": "AternosGuard",
  "reconnectDelay": 15000,
  "pingInterval": 45000,
  "version": "1.20.1",
  "users": []
}
```

## API (authenticated)
All endpoints below require `Authorization: Bearer <sessionToken>` after login.

Auth:
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`

Bot:
- `GET /api/status`
- `GET /api/logs`
- `POST /api/start`
- `POST /api/stop`
- `POST /api/restart`

Config:
- `GET /api/config`
- `POST /api/config`

Users:
- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/:id`
- `DELETE /api/users/:id`

## Render Notes
Use:
- Build Command: `npm install`
- Start Command: `node server.js` (or `public` if you are using the previous compatibility shim)

For true 24/7 uptime, use a paid instance or a background worker setup.
