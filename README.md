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

## License

[MIT](LICENSE)
