# YourOmaLauncher — Migration Plan (Windows "Your Launcher" → Omarchy shell plugin)

Source: `~/Downloads/WinLauncher 2` (C# / .NET 10 / WPF, ~22k lines, Phases 1–6 done, submitted to MS Store).
Target: an Omarchy **Quattro** (4.0.x) shell plugin, published on **plugins.omarchy.org**.

---

## 1. What we found

### The Windows app
- A global-hotkey popup panel with a user-built tree (folders, `app`, `path`, `command`, `url`, `separator`).
- Features: whole-tree fuzzy search with Turkish text normalization and match highlighting; usage-based ranking;
  in-panel editing (type picker, editor, icon picker, settings page); cut/paste/duplicate/reorder;
  per-item "ask before launching"; importing Chrome and Netscape bookmarks; config import/export; drag & drop;
  tray icon, single instance, start with Windows, Mica, MSIX packaging.
- `Launcher.Core` (no UI) holds the logic: Model, Config (serializer, TreeOps, import), Search (normalizer,
  fuzzy scorer, engine), Usage, Bookmarks, Launch (command-line builder). It has good xUnit coverage.
- About 40% of the code is Windows-only (Win32 interop, WPF views, tray, MSIX) and **can't be ported**, only rewritten.

### How Omarchy plugins work (verified on this machine: omarchy 4.0.4)
- Plugins are **QML + JS** loaded into the long-running `omarchy-shell` (Quickshell) process. Other languages don't run in the shell.
- A plugin is a git repo with a `manifest.json` at its root. Users install it with `omarchy plugin add <git-url>`,
  which puts it in `~/.config/omarchy/plugins/<id>/`.
- Kinds: `overlay`, `panel`, `menu`, `service`, `bar-widget`, `bar`. The closest built-in examples are
  `omarchy.clipboard` and `omarchy.emojis` (a centered `PanelWindow` with a search field and a list,
  `keepLoaded: true`, themed through `qs.Commons` `Style`/`Color` and built from `qs.Ui` components).
- A plugin is opened with `omarchy-shell shell toggle <id> '{}'`, and that command is bound to a key in Hyprland.
  This replaces `RegisterHotKey`.
- Settings stored in `shell.json` are flat values on the plugin's entry. They suit a few scalar settings,
  not a launcher tree.

### Marketplace requirements (plugins.omarchy.org / omacom/omarchy-plugin-marketplace)
- One **public GitHub repo** with `manifest.json`, `README` (install and **removal** steps) and `LICENSE` at the root. `preview.png` is optional.
- A globally unique id outside `omarchy.*`, lowercase and namespaced (e.g. `io.github.<user>.youromalauncher`). Ids are permanent.
- It must pass `omarchy plugin validate <folder>`.
- Submission is a GitHub issue form titled `[Plugin]: <name>`, with 1 category and 1–3 tags and a checklist.
  An automated check runs on the exact commit, then a maintainer marks it `approved-and-verified`.
- Security baseline: no `curl | sh`, no unpinned git or cargo installs, no broad NOPASSWD sudoers.
  **Must disclose**: bundled binaries, installer scripts, sudo/pkexec, systemd services, package managers.
  → A plugin written only in QML/JS avoids all of these, which makes review simple.

---

## 2. Key decisions (proposed)

| # | Decision | Why |
|---|---|---|
| M1 | **Pure QML + JS rewrite.** Port `Launcher.Core` logic to `.pragma library` JS modules and rewrite the UI in QML. Don't ship a .NET helper binary. | The shell only runs QML/JS. A bundled binary means disclosure, per-architecture builds and a runtime dependency. The Core logic is small and algorithmic, so it ports cleanly. |
| M2 | Kind `overlay`, `keepLoaded: true`, entry `Launcher.qml` | Same model as clipboard/emojis, so opening it is instant (the Windows spec's < 100 ms goal comes for free). |
| M3 | Tree config lives in `~/.config/youromalauncher/config.json` (XDG), same JSON schema `version: 1` → `version: 2` with a migrator. `shell.json` only holds small settings. | The tree is too big for inline plugin settings. The file stays hand-editable and easy to back up (keeps the original goal). |
| M4 | Opened by a Hyprland binding, `SUPER + D` → `omarchy-shell shell toggle io.github.xmsadik.youromalauncher '{}'`. Documented in the README; the plugin never edits user binds itself. | The installer never runs plugin code or hooks. `SUPER+SPACE` is already Omarchy's app launcher. |
| M5 | Dropped: tray, single instance, start with Windows, Mica, MSIX, runAsAdmin, the hotkey-capture box, Explorer drag & drop | The shell already handles these, or they don't apply on Linux. Dropping sudo/pkexec also keeps the plugin out of the disclosure category. |
| M6 | New git repo. The Windows repo stays as it is. | Different stack. Otherwise the 870 MB of `dist/` MSIX/layout history would come along. |

### Node-type mapping

| Windows | Omarchy | Launch |
|---|---|---|
| `app` (.exe/.lnk) | `app` = a `.desktop` id **or** an executable + args | `uwsm app -- <cmd>` / `gtk-launch <id>` via `Quickshell.execDetached` |
| `path` | `path` | `xdg-open <path>` (folders open in the default file manager) |
| `command` (pwsh/cmd, visible/hidden, keepOpen) | `command` with `shell: bash|zsh|fish`, `window: terminal|hidden`, `keepOpen` | terminal: `xdg-terminal-exec <shell> -lc '…; exec $SHELL'`; hidden: `execDetached([shell,'-lc',cmd])` |
| `url` | `url` | `xdg-open` / Omarchy's browser launcher |
| `separator` | `separator` | — |
| `runAsAdmin` | removed (the field is ignored when importing) | — |

Verify the exact Omarchy launch helpers (`omarchy launch …`, `uwsm-app`) during Phase 1 and use them, so launched apps behave like native Omarchy launches.

### Icon mapping
`file` (png/svg) stays. `exe` → `icon` (a freedesktop theme icon name resolved with `Quickshell.iconPath`). `glyph` → a Nerd Font glyph (Omarchy ships Nerd Fonts). `emoji` stays.
Automatic icons: a `.desktop` file's `Icon=` and the MIME type icon for paths.

---

## 3. Work plan

### Phase 0 — Scaffold (½ day)
- [x] Settle the plugin id, display name, GitHub repo name and license (see §5).
- [x] `git init`, `manifest.json` (overlay, keepLoaded, `Launcher.qml`), a blank overlay that opens and closes, README stub, LICENSE.
- [x] Symlink or clone into `~/.config/omarchy/plugins/<id>/`. Check that `omarchy plugin validate`, `enable` and `omarchy-shell shell toggle` work. Add a dev Hyprland bind.

### Phase 1 — Core port to JS (1–2 days)
Port these as `.pragma library` modules and port the matching xUnit tests to `node --test`, so the logic is tested outside the shell:
- [ ] `Model.js`: node types, defaults, id generation
- [ ] `ConfigSerializer.js`: JSONC-tolerant parsing (comments and trailing commas), key order that doesn't depend on property order, `version` migrator (v1 Windows → v2)
- [ ] `TreeOps.js`: add, delete, move up/down, cut/paste (block pasting into its own subtree), deep duplicate with new ids
- [ ] `TextNormalizer.js`, `FuzzyScorer.js`, `SearchEngine.js`: flat index, the tier × field-weight scorer, highlight positions, TR normalization, perf test (5,000 nodes < 16 ms)
- [ ] `UsageScorer.js` + `usage.json` (debounced writes)
- [ ] `LaunchPlan.js`: builds the argv for each node type (replaces `CommandLineBuilder`; quoting tests are rewritten for POSIX shells)
- [ ] `EnvExpander.js`: `$VAR`, `${VAR}`, `~`

### Phase 2 — Panel and navigation (1–2 days)
- [ ] `Launcher.qml`: centered card built from `Style`/`Color`/`Border` like Clipboard. Search row, breadcrumb, list, hint bar. Themes follow Omarchy automatically.
- [ ] Load and save config with `FileView` (`watchChanges` = reload when the file changes outside the plugin). Atomic save (write a temp file, then `mv`) plus `config.backup.json`. If the JSON is corrupt: show an error row and offer to restore the backup.
- [ ] Keyboard behavior from spec §6.1/§6.2: ↑↓ wrap, Enter/→/Tab, ←/Backspace, Esc hides, Home/End/PgUp/PgDn, typing switches to search, Ctrl+Enter
- [ ] Launching, `closeAfterLaunch`, the "ask before launching" confirmation, and an error row that keeps the panel open
- [ ] Mouse: click, double-click, right-click context menu

### Phase 3 — Editing UI (2–3 days)
- [ ] Type picker (F/A/P/C/U/S) and editor form with per-type fields and an "Advanced" section
- [ ] Browse… through `omarchy file select` (`--directory` for folders)
- [ ] Pick an app from installed `.desktop` entries (optional: a small JS scan of `$XDG_DATA_DIRS/applications`)
- [ ] Icon picker (theme icon name / file / glyph / emoji). Custom icons are copied to `~/.config/youromalauncher/icons/`
- [ ] Shortcuts: Ctrl+N, Ctrl+Shift+N, F2, Delete (with confirmation), Ctrl+↑/↓, Ctrl+X/V, Ctrl+D, Ctrl+I, Ctrl+,
- [ ] Settings page: `closeAfterLaunch`, `maxVisibleItems`, `defaultShell`, `rememberLastLocation`, `showHintBar`

### Phase 4 — Import and migration (1 day)
- [ ] **Windows config import**: keep folders, URLs and the tree. Flag nodes with Windows paths (`C:\`, `%APPDATA%`) as "needs attention" instead of dropping them. Drop `runAsAdmin`. Map `pwsh`/`cmd` commands to the default shell, flagged for review.
- [ ] Chromium/Chrome/Brave bookmark import (`~/.config/chromium/Default/Bookmarks`, including AccountBookmarks) and Netscape HTML import
- [ ] Export

### Phase 5 — Polish and publish prep (1 day)
- [ ] README: what it is, screenshots, **install** (`omarchy plugin add <url> --enable`), **Hyprland bind snippet**, config format, keyboard reference, **removal** (`omarchy plugin remove <id>` plus deleting `~/.config/youromalauncher`)
- [ ] LICENSE (MIT suggested). Say "no external dependencies, no binaries, no sudo" in the README.
- [ ] `preview.png` (a screenshot of the panel on a stock Omarchy theme)
- [ ] `config.example.json` for Linux
- [ ] `omarchy plugin validate .`. Test a clean install from the public URL on a fresh user or VM. Test theme switching and multiple monitors.
- [ ] Carry over `tasks/lessons.md` rules (e.g. keep real user data out of the repo)

### Phase 6 — Publish
- [ ] Push to a public GitHub repo and tag `v1.0.0` (the manifest `version` must match)
- [ ] Search plugins.omarchy.org to make sure the id and name are unused
- [ ] Submit through the form: https://github.com/omacom/omarchy-plugin-marketplace/issues/new?template=submit-plugin.yml
  - Title `[Plugin]: YourOmaLauncher`, category **Productivity**, tags **launcher, quickshell, hyprland**
- [ ] Respond to automated check and maintainer feedback. Future updates reach users through `omarchy plugin update` (a fast-forward pull), so keep `main` releasable.

**Rough total: 7–10 working days.**

---

## 4. Risks
- **The Quickshell/QML API isn't a public, stable contract.** Third-party plugins get limited interfaces to the shell, and `qs.Ui`/`qs.Commons` can change between Omarchy releases. Mitigation: depend on as little as possible and pin the tested Omarchy version in the README.
- **Plugin code runs in the shell process.** A JS exception or a slow loop affects the whole desktop. Keep search synchronous but bounded, and do file I/O asynchronously through `FileView`/`Process`.
- **Overlap with the built-in app launcher** (`SUPER+SPACE`). Position the plugin as a *hand-curated* launcher, which is its main difference.
- **Turkish text normalization** in JS: `toLocaleLowerCase('tr-TR')` in QML's V4 engine needs testing. Use an explicit character map, as the C# version did.

## 5. Settled (2026-09-28)
- Plugin id: **`io.github.xmsadik.youromalauncher`** (permanent). GitHub repo: `github.com/xmsadik/YourOmaLauncher`
- Display name: **YourOmaLauncher**
- License: **MIT**
- Suggested keybinding: **`SUPER + D`** (checked: plain SUPER+D is unbound on Omarchy 4.0.4; SHIFT/CTRL variants are taken). README snippet for `~/.config/hypr/bindings.lua`:
  `o.bind("SUPER + D", "YourOmaLauncher", "omarchy-shell shell toggle io.github.xmsadik.youromalauncher '{}'")`
- Config dir: `~/.config/youromalauncher/`
