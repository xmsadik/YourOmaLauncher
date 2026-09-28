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
| M2 | Kind `overlay`, entry `Launcher.qml`, **`keepLoaded: false`** *(revised in Phase 2)* | Measured: opening takes the same time with or without `keepLoaded` (~52 ms from IPC call to visible surface, the same as the built-in clipboard, which is `keepLoaded`). Without it nothing stays in memory while closed, and the config is read fresh on every open. |
| M3 | Tree **and settings** live in `~/.config/youromalauncher/config.json` (XDG), same JSON schema `version: 1` → `version: 2` with a migrator. Nothing goes in `shell.json`. *(Revised in Phase 1: keeping settings next to the tree gives one hand-editable file and one save path.)* | The tree is too big for inline plugin settings. The file stays hand-editable and easy to back up (keeps the original goal). |
| M4 | Opened by a Hyprland binding, `SUPER + D` → `omarchy-shell shell toggle io.github.xmsadik.youromalauncher '{}'`. Documented in the README; the plugin never edits user binds itself. | The installer never runs plugin code or hooks. `SUPER+SPACE` is already Omarchy's app launcher. |
| M5 | Dropped: tray, single instance, start with Windows, Mica, MSIX, runAsAdmin, the hotkey-capture box, Explorer drag & drop | The shell already handles these, or they don't apply on Linux. Dropping sudo/pkexec also keeps the plugin out of the disclosure category. |
| M6 | New git repo. The Windows repo stays as it is. | Different stack. Otherwise the 870 MB of `dist/` MSIX/layout history would come along. |

### Node-type mapping

| Windows | Omarchy | Launch |
|---|---|---|
| `app` (.exe/.lnk) | `app` = `desktopId` (a `.desktop` id) **or** `target` + `arguments` | `uwsm-app -- gtk-launch <id>.desktop` (same as Omarchy's AppLibrary), or `uwsm-app -- <program> <args…>` with args split POSIX-style in JS, never through a shell |
| `path` | `path` | `uwsm-app -- xdg-open <path>` |
| `command` (pwsh/cmd, visible/hidden, keepOpen) | `command` with `shell: bash|zsh|fish|sh|null`, `window: terminal|hidden`, `keepOpen` | terminal: `uwsm-app -- xdg-terminal-exec --title=<name> -e <shell> -l -c '<cmd>\nexec <shell>'`; hidden: `uwsm-app -- <shell> -l -c '<cmd>'`. `shell: null` = settings, then `$SHELL`, then bash |
| `url` | `url` | http(s): `omarchy launch browser <url>` (also focuses the browser); other schemes: `uwsm-app -- xdg-open`. A bare host gets `https://` |
| `separator` | `separator` | — |
| `runAsAdmin` | removed; migrated nodes that had it get a review note | — |

Verified in Phase 1 against Omarchy 4.0.4's own launchers (`omarchy-launch-browser`, `omarchy-launch-tui`, AppLibrary.qml). Working directory defaults to `$HOME`.

Migration marks anything that can't work as-is on Linux (Windows paths, PowerShell/cmd commands, run-as-admin) with a `reviewNote` on the node instead of dropping it; the UI will show those.

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
- [x] `Model.js`: node types, defaults, id generation
- [x] `Jsonc.js` + `ConfigSerializer.js`: comments and trailing commas, property order that doesn't matter on read and is fixed on write, v1 (Windows) → v2 migration with review notes
- [x] `TreeOps.js`: add, delete, move up/down, drag reorder, cut/paste (blocks pasting into its own subtree), deep duplicate with new ids, import merge
- [x] `TextNormalizer.js`, `FuzzyScorer.js`, `SearchEngine.js`, `PathTrimmer.js`: flat index, tier × field-weight scorer, highlight positions, Turkish normalization and collation
- [x] `Usage.js`: record, frecency score, prune, (de)serialize. Reads the Windows `usage.json` unchanged. (Debounced writes are file I/O → Phase 2.)
- [x] `LaunchPlan.js`: argv per node type, POSIX word splitting for app arguments, shell resolution
- [x] `EnvExpander.js`: `$VAR`, `${VAR}`, `~`
- [x] `TargetName.js`: name suggestions from a target (filesystem check injected)
- [x] Tests: 151 in Node (`npm test`), including every ported xUnit case that still applies and a check that the fast search ranks exactly like a full sort; plus `npm run test:qml`, which runs the libraries in Qt's V4 engine.

**Finding:** V4 is 20–50× slower than Node. The straight port took a 54 ms median and 199 ms worst case per keystroke at 5,000 nodes. After precomputing per-node data, cheap rejection and a top-50 selection instead of a full sort, it's a 4 ms median and 9 ms worst case in the V4 smoke run (about 20 ms for a one-letter query on a flat 5,000-item tree). Building the index costs about 280 ms at 5,000 nodes (about 10 ms at 200), so Phase 2 rebuilds it lazily, on the first search after a change, not on every edit.

### Phase 2 — Panel and navigation (1–2 days)
- [x] `Launcher.qml`: card built from `Style`/`Color`/`Border` like Clipboard. Search row, breadcrumb, list (icons, highlighted matches, folder paths trimmed from the start), status line, hint bar. Follows the Omarchy theme.
- [x] `NodeIcon.qml`: the node's own icon (theme name / file / glyph / emoji), else the installed app's icon (`DesktopEntries`), else a type glyph.
- [x] `ConfigStore.qml`: `FileView` load (synchronous, no empty flash), `watchChanges` live reload, atomic saves with `config.backup.json`, damaged file → error + read-only + Ctrl+R / Ctrl+Shift+R, first run creates the folder and an empty config. `usage.json` with debounced writes; `state.json` for `rememberLastLocation`.
- [x] Keyboard behavior from spec §6.1/§6.2 (see README)
- [x] Launching through `bash -l` like Omarchy's `Util.execArgv`, `closeAfterLaunch`, "ask before launching" confirmation, errors in the status line; a missing program or path gives a desktop notification (a detached launch can't report back)
- [x] Mouse: click selects, double-click opens. *(Not verified live: there's no pointer automation on this machine. Keyboard paths were all tested with `wtype`.)*
- [x] → Phase 3: right-click context menu (its items are editing actions)

Verified live in omarchy-shell 4.0.4: first run, live reload of an edited config, search with Turkish folding, launch + usage recording, confirmation, Ctrl+Enter reveal, going up keeps the folder selected, wrap-around, review notes, missing-program notification, damaged config and recovery, remember-last-location across a fresh instance.

**Findings:**
- omarchy-shell 4.0.4 does **not** load changed plugin code on `rescanPlugins`, for symlinked or copied plugins, with or without `keepLoaded`; only a shell restart does. So the README tells users to `omarchy restart shell` after `omarchy plugin update`, and development uses `npm run reload`. Worth reporting to Omarchy.
- Its debug-level `console.log` output isn't recorded after a restart; use `console.warn` and `quickshell log -p /usr/share/omarchy/shell`.
- V4's `JSON.parse` error has no line or column, so a damaged config only says "Parse error". Improve in Phase 5: point at the line.

### Phase 3 — Editing UI (2–3 days)
- [x] Type picker (F/A/P/C/U/S) and editor form with per-type fields and an "Advanced" section (`ui/TypePicker.qml`, `ui/EditorPage.qml`; form logic and validation in `lib/Editing.js`)
- [x] Browse… through `omarchy-file-select` (`--directory` for folders). The panel hides while the portal dialog is open, then returns with focus restored; paths under `$HOME` are stored as `~/…`
- [x] Pick an app from installed `.desktop` entries (`ui/AppPicker.qml`, from Quickshell's `DesktopEntries`; no scan of our own needed)
- [x] Icon picker (theme icon name / file / glyph / emoji) (`ui/IconPage.qml`). Custom icons are copied to `~/.config/youromalauncher/icons/<id>.<ext>`, get their own copy on duplicate, and are deleted with their item (only files matching that exact id pattern, so a hand-edited path can never delete anything else)
- [x] Shortcuts: Ctrl+N, Ctrl+Shift+N, F2, Delete (with confirmation, Cancel is the default), Ctrl+↑/↓, Ctrl+X/V, Ctrl+D, Ctrl+I, Ctrl+,; plus Menu / Shift+F10 / right-click for the context menu (`ui/ContextMenu.qml`)
- [x] Settings page: `closeAfterLaunch`, `maxVisibleItems`, `defaultShell`, `rememberLastLocation`, `showHintBar`, and "Open config file" (`ui/SettingsPage.qml`)

Verified live with `wtype` in omarchy-shell 4.0.4: every shortcut above, type picker by letter, name suggestion from a URL, a picked app and a browsed file, multi-line command, duplicate/reorder/cut/paste, separator, delete confirmation, emoji and image icons (copied, then removed with the item), a setting toggled and saved, the context menu from the Menu key, and the file chooser round trip. Right-click and double-click are wired but can't be tested here (no pointer automation).

**Findings:**
- `qs.Ui` `Button` isn't a Tab stop unless `focusable: true`, and `ButtonGroup` moves a cursor with ←→ and picks with Space/Enter. We follow the kit's convention and say so in the hints.
- `TextNormalizer`'s Turkish alphabet was missing q, w and x, so they sorted before every other letter (seen in the app picker, and it affected search tie-breaks). Fixed to ICU's Turkish order, with a test.
- Separators can't be selected (arrows skip them), so right-click is the only way to move or delete one from the panel. Revisit if that turns out to matter.

### Phase 4 — Import and migration (1 day)
- [x] Windows config migration logic (done in Phase 1, `ConfigSerializer.js`)
- [x] **Windows config import** UI: pick the old `config.json`, then merge or replace (`ui/ImportPage.qml`). The migration flags Windows paths, `pwsh`/`cmd` commands and `runAsAdmin` with review notes (Phase 1). Replace keeps the current settings.
- [x] Chromium-family bookmark import (`lib/Bookmarks.js`): Chromium, Chrome (+Beta/Dev), Brave, Edge, Vivaldi, Opera, native and Flatpak; `AccountBookmarks` + `Bookmarks` merged; profile names from `Local State`. Found with one `find`, read with `cat` one file at a time (never blocks the shell). Re-import finds its folder by id (`bookmarks:<source>`) and replaces only its contents. Netscape HTML import with the Windows app's tolerant tokenizer. Every Windows xUnit case ported, plus Linux discovery tests (34 tests).
- [x] Export: `youromalauncher-config-<date>.json` into a chosen folder
- [x] Review notes are now collected from the whole tree (`ConfigSerializer.collectNotes`), not only during a migration, so the "N items need a look" hint survives a reload and covers imported items.

Verified live: browser discovery (found the installed Chrome profile), importing it (count matches an independent count of the file) and re-importing it ("Updates …", same folder, no duplicate). **Not verified live:** the three flows that start in the file chooser (HTML file, config file, export). GTK's dialog ignores typed paths under `wtype`, and `/usr/share/omarchy/bin` is first on the shell's `PATH`, so a stub chooser isn't possible. Their parsing is tested; the wiring needs one manual pass.

**Findings:**
- Firefox keeps bookmarks in `places.sqlite`, which QML can't read without a new dependency (`sqlite3`), so Firefox goes through its HTML export (documented in the README).
- The context menu gained Home/End.

### Phase 5 — Polish and publish prep (1 day)
- [ ] README: *(usage, keys, config format, install/update/remove written in Phase 2)* screenshots, **install** (`omarchy plugin add <url> --enable`), **Hyprland bind snippet**, config format, keyboard reference, **removal** (`omarchy plugin remove <id>` plus deleting `~/.config/youromalauncher`)
- [ ] LICENSE (MIT suggested). Say "no external dependencies, no binaries, no sudo" in the README.
- [ ] `preview.png` (a screenshot of the panel on a stock Omarchy theme)
- [x] `config.example.json` for Linux (Phase 1; a test keeps it loadable)
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
- ~~Turkish text normalization in V4~~: solved with an explicit character map and alphabet table, verified in V4 by `npm run test:qml`.
- **Search speed in V4**: see the Phase 1 finding. Keep `npm run test:qml` green; it fails if the 5,000-node median goes over 16 ms.

## 5. Settled (2026-09-28)
- Plugin id: **`io.github.xmsadik.youromalauncher`** (permanent). GitHub repo: `github.com/xmsadik/YourOmaLauncher`
- Display name: **YourOmaLauncher**
- License: **MIT**
- Suggested keybinding: **`SUPER + D`** (checked: plain SUPER+D is unbound on Omarchy 4.0.4; SHIFT/CTRL variants are taken). README snippet for `~/.config/hypr/bindings.lua`:
  `o.bind("SUPER + D", "YourOmaLauncher", "omarchy-shell shell toggle io.github.xmsadik.youromalauncher '{}'")`
- Config dir: `~/.config/youromalauncher/`
