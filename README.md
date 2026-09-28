# YourOmaLauncher

A launcher you build yourself, for [Omarchy](https://omarchy.org). Put apps, files, folders, shell
commands and links into nested folders, then open any of them from the keyboard with fuzzy search
across the whole tree. Nothing is indexed automatically; everything in it is something you put there.

> **Status: in development (0.1.0).** Browsing, search, launching, editing, and importing bookmarks
> and configs from the panel work. Publishing prep comes next. See [PLAN.md](PLAN.md).

## Requirements

Omarchy 4 (Quattro) with `omarchy-shell`. No other dependencies. The plugin is plain QML/JavaScript:
it ships no binaries and has no installer script, and it never uses `sudo`.

## Install

```bash
omarchy plugin add https://github.com/xmsadik/YourOmaLauncher.git --enable
```

Then bind a key in `~/.config/hypr/bindings.lua`:

```lua
o.bind("SUPER + D", "YourOmaLauncher", "omarchy-shell shell toggle io.github.xmsadik.youromalauncher '{}'")
```

## Keyboard

With the search empty you browse folders; typing searches the whole tree.

| Key | Browsing | Searching |
|---|---|---|
| `↑` `↓` | Move the selection (wraps around) | Same, through the results |
| `Page Up` `Page Down` | Move a page | Same |
| `Home` `End` | First / last item | Same |
| `Enter` | Open a folder, launch anything else | Same (a folder result opens that folder) |
| `→` `Tab` | Open the selected folder | — |
| `←` `Backspace` | Go up a folder | `Backspace` deletes a character |
| `Ctrl+Enter` | — | Show the result in its folder |
| `Ctrl+U` | — | Clear the search |
| `Esc` | Close | Clear the search |
| `Ctrl+R` | Reload the config file now | Same |
| `Ctrl+Shift+R` | Restore the backup, when the config file is damaged | Same |

### Editing

These work on the selected item, while browsing and in search results.

| Key | Does |
|---|---|
| `Ctrl+N` | Add an item to the current folder: pick a type (`F`older, `A`pp, `P`ath, `C`ommand, `U`RL, `S`eparator) |
| `Ctrl+Shift+N` | Add a folder |
| `F2` | Edit |
| `Delete` | Delete (asks first; a folder goes with everything in it) |
| `Ctrl+↑` `Ctrl+↓` | Move up / down within its folder (while browsing) |
| `Ctrl+X`, then `Ctrl+V` | Move to another folder: cut, open the folder, paste |
| `Ctrl+D` | Duplicate |
| `Ctrl+I` | Change the icon |
| `Ctrl+,` | Settings |
| `Menu` or `Shift+F10` | All of the above in a menu (also on right-click) |

In the editor, `Tab` moves between fields, `Enter` saves (`Ctrl+Enter` in the command box, where
`Enter` starts a new line), `Alt+A` shows the advanced fields and `Esc` cancels. In a row of choices,
`←` `→` move and `Space` picks. **Browse…** opens the desktop file chooser; the panel steps aside
until you've picked something. A name is suggested from what you pick, unless you've typed your own.

Separators can't be selected, so to move or delete one, right-click it.

Click selects a row; double-click opens it.

Items marked "ask before launching" show a confirmation first; `Enter` launches, `Esc` cancels.

## Config

Everything lives in `~/.config/youromalauncher/`:

| File | What it is |
|---|---|
| `config.json` | Your tree and settings. Hand-editable; comments and trailing commas are fine. The panel picks up changes as soon as you save. |
| `config.backup.json` | The version before the last save the panel made. |
| `usage.json` | How often and how recently you launched each item; used to rank search results. |
| `state.json` | Where the panel was left, for `rememberLastLocation`. |

Start from [config.example.json](config.example.json). Each item has an `id` (any unique text), a
`type`, a `name`, and the fields for its type:

| `type` | Fields | What happens |
|---|---|---|
| `folder` | `children` | Opens the folder |
| `app` | `desktopId` (an installed app, e.g. `org.gnome.Nautilus`) **or** `target` (a program) + `arguments` + `workingDirectory` | Starts the app |
| `path` | `target` | Opens the file or folder with its default app |
| `url` | `target` | Opens in your browser (`https://` is added to a bare host) |
| `command` | `command`, `shell` (`bash`, `zsh`, `fish`, `sh`, or `null` for your login shell), `window` (`terminal` or `hidden`), `keepOpen`, `workingDirectory` | Runs the command in a terminal (staying open afterwards if `keepOpen`) or in the background |
| `separator` | — | A divider line |

Optional on every item: `keywords` (extra search terms), `description` (shown on the right and
searched), `confirmLaunch` (ask first), and `icon`:

```jsonc
"icon": { "kind": "icon",  "value": "firefox" }            // a theme icon name
"icon": { "kind": "file",  "value": "~/Pictures/logo.png" } // an image file
"icon": { "kind": "glyph", "value": "󰅩" }                  // a Nerd Font glyph
"icon": { "kind": "emoji", "value": "🚀" }
```

Without an icon, apps show their installed icon and everything else a glyph for its type. An image
chosen from the panel is copied to `~/.config/youromalauncher/icons/`, so it keeps working if the
original moves. `~`,
`$VAR` and `${VAR}` work in targets, arguments and working directories. Programs are started through
your login shell's environment, so everything on your `PATH` works; if a program or path doesn't
exist, you get a notification.

Settings (`Ctrl+,` in the panel, or `"settings"` at the top of the file): `closeAfterLaunch` (default `true`),
`maxVisibleItems` (8), `defaultShell` (`null` = your login shell), `rememberLastLocation` (`false`),
`showHintBar` (`true`).

### Import and export

**Import and export…** (in Settings, or at the bottom of the `Menu` key's menu) offers:

- **Bookmarks from a browser.** Every Chromium-family profile with bookmarks is listed: Chromium,
  Chrome, Brave, Edge, Vivaldi and Opera, native or Flatpak. Signed-in Chrome's account bookmarks are
  included. They're added to the current folder as one folder of links. Importing the same profile
  again replaces that folder's contents, even if you've renamed or moved it since; nothing else is
  touched. This is a one-time copy, not a sync.
- **A bookmarks file (HTML).** The export format of Firefox, Chrome and most other browsers. Firefox
  keeps its bookmarks in a database, so export them first (*Bookmarks → Manage bookmarks → Import
  and Backup → Export Bookmarks to HTML*).
- **A config file**, from this launcher or the Windows version. Choose to **add** its items after
  yours (items with clashing ids get new ones), or to **replace** your tree with it. Your settings
  are kept either way.
- **Export my config** saves `youromalauncher-config-<date>.json` into a folder you choose.

Bookmarklets (`javascript:` links) and empty folders are skipped.

### Coming from the Windows version

Import your Windows `config.json` with **Import a config file…**, or copy it over
`~/.config/youromalauncher/config.json`. It's converted as it loads: nothing is dropped, but items that can't work on Linux as they are (Windows paths, PowerShell
or cmd commands, run as administrator) are marked with 󰀦, and the status line tells you what to
change when you select one. Your `usage.json` works unchanged.

If the file is damaged, the panel keeps showing the last good version, says what's wrong, and doesn't
write to the file until you fix it or restore the backup.

## Remove

```bash
omarchy plugin remove io.github.xmsadik.youromalauncher
rm -rf ~/.config/youromalauncher    # your launcher tree, icons and usage stats
```

Also delete the `SUPER + D` line from `~/.config/hypr/bindings.lua`.

## Update

```bash
omarchy plugin update io.github.xmsadik.youromalauncher
omarchy restart shell
```

The restart is needed because omarchy-shell (4.0.4) keeps running a plugin's old code after an
update until it restarts.

## Development

The plugin is QML (`Launcher.qml` for the panel, `ConfigStore.qml` for the files, `NodeIcon.qml`)
plus JavaScript libraries in `lib/`: the logic ported from the Windows app (config format, tree
edits, search, launch plans). The libraries have no QML dependencies, so they are tested outside
the shell:

```bash
npm test            # Node's built-in test runner, no packages to install
npm run test:qml    # the same libraries inside Qt's V4 engine (needs qml6), with search timing
```

V4 is the engine omarchy-shell runs, and it is much slower than Node, so keep `npm run test:qml`
green for anything on the search path.

To try your working copy in the shell, link it into the plugin directory once:

```bash
ln -s "$PWD" ~/.config/omarchy/plugins/io.github.xmsadik.youromalauncher
omarchy-shell shell rescanPlugins
omarchy plugin enable io.github.xmsadik.youromalauncher
```

After changing QML or `lib/`, run `npm run reload` (validates, then restarts the shell; a rescan
alone doesn't load changed code). The shell's log: `quickshell log -p /usr/share/omarchy/shell`.
Set `YOUROMALAUNCHER_CONFIG_DIR` in the shell's environment to use a different config folder.

## License

[MIT](LICENSE)
