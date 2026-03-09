# Safe Minecraft Launcher PRD

## Vision
Build a **safe, transparent, open-source Minecraft launcher** with the convenience of mainstream launchers (such as TLauncher) while enforcing strict security guarantees:

- No malware
- No hidden background processes
- No crypto miners
- No bundled software
- Full visibility of network activity

## Target Platform
- Desktop app: Windows, macOS, Linux
- Suggested stack:
  - UI: React + TypeScript (Electron renderer)
  - Runtime: Electron (or Tauri as an alternative)
  - Launcher core: Node.js service layer
  - Storage: Local JSON/SQLite profile database

## Core Feature Requirements

### 1) Minecraft Version Manager
- Download and launch multiple versions.
- Supported distributions:
  - Vanilla
  - Forge
  - Fabric
  - OptiFine
- Version selector dropdown with account + profile pairing.
- Local cache and checksum verification for downloaded artifacts.

#### Functional details
- Pull official metadata from Mojang version manifest.
- Maintain installation graph:
  - Base game
  - Loader
  - Libraries
  - Assets
- Per-profile `gameDir` with optional shared assets/libraries.

### 2) Mod Support
- Built-in mod browser and installer.
- Search + install from:
  - Modrinth API
  - CurseForge API (subject to API terms)
- Auto-resolve installation path by game profile and loader compatibility.

#### Functional details
- Display compatibility badges (MC version, loader, dependencies).
- Download mods with hash validation.
- Support enable/disable and remove actions.

### 3) Account System
- Offline account support (username only).
- Microsoft account support (official OAuth/device flow).
- Quick account switcher.

#### Security constraints
- Store tokens in OS credential vault (Keychain, Credential Manager, Secret Service).
- Never store refresh/access tokens in plain text files.

### 4) Server Integration
- Save favorite servers with labels.
- One-click quick connect:
  - Launch selected profile
  - Pass server host:port as launch target
- Optional import/export of favorites.

### 5) Modpacks
- Install modpacks in one click.
- Sources:
  - Modrinth packs (`.mrpack`)
  - CurseForge packs (`.zip`, manifest-based)
- Auto-install dependencies and lock versions.

### 6) Performance Settings
- RAM allocation presets and custom values.
- Java runtime selector (detected + custom path).
- JVM argument editor with sane defaults.
- Presets:
  - Low-end
  - Balanced
  - High-performance

### 7) Automatic Updates
- Self-updater for launcher builds.
- Signed releases only.
- Changelog viewer before/after update.
- Option for manual update channel (Stable/Beta).

## UI/UX Requirements
- Modern dark theme by default.
- Primary navigation:
  - Home
  - Versions
  - Mods
  - Modpacks
  - Settings
  - Accounts
- Built-in utilities:
  - Open screenshots folder
  - Log viewer with filtering/search
  - Backups manager (worlds + settings)

## Security & Transparency Requirements

### Mandatory controls
1. **Open-source codebase** with reproducible builds.
2. **Least privilege model**:
   - No auto-start background daemon unless user explicitly enables it.
   - No hidden child processes.
3. **Signed binary releases** and checksum publication.
4. **Network transparency**:
   - Built-in network monitor panel listing outbound domains/endpoints.
   - Documentation for each external service and reason.
5. **No bundled software** of any kind.
6. **No telemetry by default**; opt-in diagnostics only.
7. **Deterministic dependency policy**:
   - Lockfile committed.
   - Software bill of materials (SBOM) published.

### Threat model baseline
- Defend against:
  - Malicious mod JAR download tampering
  - Token leakage from local storage
  - Supply-chain package compromise
  - MITM on metadata endpoints
- Mitigations:
  - HTTPS + host allowlist
  - Hash/signature verification
  - Strict CSP in renderer
  - Context isolation and disabled `nodeIntegration` in UI

## Proposed Architecture

### Process model
- **Renderer process**: UI only.
- **Main process**: orchestration + update workflow.
- **Launcher core module**:
  - Version install manager
  - Mod/modpack manager
  - Account/auth manager
  - Java discovery + launch command builder

### Data layout
- `profiles/` per installation profile
- `instances/<profile-id>/` for saves, mods, configs
- `cache/` for downloaded artifacts
- `logs/` for launcher + game logs
- `backups/` timestamped archives

### API adapters
- Mojang metadata adapter
- Fabric/Forge metadata adapters
- Modrinth adapter
- CurseForge adapter

## Milestones

### Milestone 1 — Foundation
- App shell, navigation, dark theme
- Secure config store
- Basic Vanilla install + launch
- Offline accounts

### Milestone 2 — Loader support
- Forge + Fabric + OptiFine profile creation
- Java manager + RAM/JVM settings
- Log viewer

### Milestone 3 — Mods and modpacks
- Mod search/install from Modrinth
- CurseForge integration
- Modpacks install pipeline

### Milestone 4 — Accounts and servers
- Microsoft login
- Favorites + quick connect
- Backup/restore flows

### Milestone 5 — Security hardening
- Updater signing
- Network activity panel
- SBOM + reproducible build documentation
- External audit checklist

## Definition of Done
A release is "done" only if:
- All core features above are available.
- Security requirements are enforced and documented.
- Source code is public and build instructions reproduce distributed binaries.
- Release artifacts are signed and checksums are published.
