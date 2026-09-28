# YourOmaLauncher

A launcher you build yourself, for [Omarchy](https://omarchy.org). Put apps, files, folders, shell
commands and links into nested folders, then open any of them from the keyboard with fuzzy search
across the whole tree. Nothing is indexed automatically; everything in it is something you put there.

> **Status: early development (0.1.0).** The panel opens and closes, but the tree, search and editing
> are still being built. See [PLAN.md](PLAN.md).

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

## Remove

```bash
omarchy plugin remove io.github.xmsadik.youromalauncher
rm -rf ~/.config/youromalauncher    # your launcher tree, icons and usage stats
```

Also delete the `SUPER + D` line from `~/.config/hypr/bindings.lua`.

## Update

```bash
omarchy plugin update io.github.xmsadik.youromalauncher
```

## Development

The plugin is plain QML plus JavaScript libraries in `lib/` (the logic ported from the Windows app:
config format, tree edits, search, launch plans). The libraries have no QML dependencies, so they are
tested outside the shell:

```bash
npm test            # Node's built-in test runner, no packages to install
npm run test:qml    # the same libraries inside Qt's V4 engine (needs qml6), with search timing
```

V4 is the engine omarchy-shell runs, and it is much slower than Node, so keep `npm run test:qml`
green for anything on the search path.

To try your working copy in the shell, link it into the plugin directory:

```bash
ln -s "$PWD" ~/.config/omarchy/plugins/io.github.xmsadik.youromalauncher
omarchy-shell shell rescanPlugins
omarchy plugin enable io.github.xmsadik.youromalauncher
```

Saving any file reloads the plugin.

## License

[MIT](LICENSE)
