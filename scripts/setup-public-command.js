const fs = require("fs");
const path = require("path");

const binDir = path.join(__dirname, "..", "node_modules", ".bin");

if (!fs.existsSync(binDir)) {
  console.log("[postinstall] node_modules/.bin not found; skipping public command setup.");
  process.exit(0);
}

const publicBinPath = path.join(binDir, "public");
const publicCmdPath = path.join(binDir, "public.cmd");

const publicBinContent = `#!/usr/bin/env node
require(require("path").join(__dirname, "..", "..", "server.js"));
`;

const publicCmdContent = `@echo off\r\nnode "%~dp0\\..\\..\\server.js" %*\r\n`;

fs.writeFileSync(publicBinPath, publicBinContent, "utf8");

try {
  fs.chmodSync(publicBinPath, 0o755);
} catch {
  // chmod can fail on Windows; not fatal.
}

fs.writeFileSync(publicCmdPath, publicCmdContent, "utf8");
console.log("[postinstall] Installed 'public' command shim in node_modules/.bin.");
