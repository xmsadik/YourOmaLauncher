.pragma library
.import "Model.js" as Model
.import "Jsonc.js" as Jsonc

// config.json <-> config object, no file I/O.
//
// deserialize() never throws: malformed or wrongly shaped input gives { ok: false, error }, so the
// caller can keep running on an empty in-memory config without touching the file on disk. Comments and
// trailing commas are accepted, unknown properties are ignored, missing optional fields get defaults.
//
// Version 1 is the Windows app's format. It is migrated on read: Windows-only settings are dropped, and
// anything that can't work on Linux as-is (Windows paths, PowerShell/cmd commands, run-as-admin) is kept
// but gets a node.reviewNote and an entry in the returned `notes`, so the UI can point it out. Icons that
// only made sense on Windows (exe resources, Segoe glyphs, copies under %APPDATA%) reset to automatic.

function deserialize(text) {
  var raw
  try {
    raw = Jsonc.parse(text)
  } catch (e) {
    return fail("Invalid JSON: " + (e && e.message ? e.message : e))
  }
  if (!isObject(raw)) return fail("The config must be a JSON object.")

  var version = raw.version === undefined ? 1 : raw.version
  if (typeof version !== "number" || version < 1 || Math.floor(version) !== version)
    return fail("\"version\" must be a positive whole number.")
  if (version > Model.CONFIG_VERSION)
    return fail("This config was written by a newer YourOmaLauncher (version " + version + ").")

  var ctx = { legacy: version < 2, notes: [] }
  try {
    var config = {
      version: Model.CONFIG_VERSION,
      settings: readSettings(raw.settings, ctx),
      root: raw.root === undefined || raw.root === null ? Model.createRoot() : readRoot(raw.root, ctx)
    }
    return { ok: true, config: config, error: null, notes: ctx.notes }
  } catch (e) {
    return fail(e && e.message ? e.message : String(e))
  }
}

function fail(error) {
  return { ok: false, config: null, error: error, notes: [] }
}

function isObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v) }
function str(v, fallback) { return typeof v === "string" ? v : fallback }
function optStr(v) { return typeof v === "string" && v.length > 0 ? v : null }
function bool(v, fallback) { return typeof v === "boolean" ? v : fallback }
function oneOf(v, allowed, fallback) { return allowed.indexOf(v) >= 0 ? v : fallback }

function readSettings(raw, ctx) {
  var s = Model.defaultSettings()
  if (!isObject(raw)) return s
  s.closeAfterLaunch = bool(raw.closeAfterLaunch, s.closeAfterLaunch)
  if (typeof raw.maxVisibleItems === "number" && raw.maxVisibleItems >= 1)
    s.maxVisibleItems = Math.min(50, Math.floor(raw.maxVisibleItems))
  s.defaultShell = oneOf(raw.defaultShell, Model.SHELLS, null)   // v1's pwsh/powershell/cmd → null
  s.rememberLastLocation = bool(raw.rememberLastLocation, s.rememberLastLocation)
  s.showHintBar = bool(raw.showHintBar, s.showHintBar)
  return s
}

function readRoot(raw, ctx) {
  if (!isObject(raw)) throw new Error("\"root\" must be an object.")
  var root = readNodeFields(raw, "folder", ctx)
  if (!raw.id) root.id = "root"
  return root
}

function readNode(raw, ctx) {
  if (!isObject(raw)) throw new Error("Every entry in \"children\" must be an object.")
  if (typeof raw.type !== "string") throw new Error("Node " + describe(raw) + " is missing a \"type\".")
  if (Model.NODE_TYPES.indexOf(raw.type) < 0) throw new Error("Unknown node type '" + raw.type + "'.")
  return readNodeFields(raw, raw.type, ctx)
}

function describe(raw) {
  return raw.name ? "'" + raw.name + "'" : raw.id ? "'" + raw.id + "'" : "(unnamed)"
}

function readNodeFields(raw, type, ctx) {
  var node = Model.createNode(type)
  var notes = []
  if (typeof raw.id === "string" && raw.id.length > 0) node.id = raw.id
  node.name = str(raw.name, "")
  node.confirmLaunch = bool(raw.confirmLaunch, false)
  node.keywords = Array.isArray(raw.keywords) ? raw.keywords.filter(function(k) { return typeof k === "string" }) : []
  node.description = optStr(raw.description)
  node.icon = readIcon(raw.icon, ctx)
  node.reviewNote = optStr(raw.reviewNote)

  switch (type) {
  case "folder":
    if (raw.children !== undefined && raw.children !== null && !Array.isArray(raw.children))
      throw new Error("\"children\" of " + describe(raw) + " must be an array.")
    node.children = (raw.children || []).map(function(c) { return readNode(c, ctx) })
    break
  case "app":
    node.desktopId = optStr(raw.desktopId)
    node.target = str(raw.target, "")
    node.arguments = optStr(raw.arguments)
    node.workingDirectory = optStr(raw.workingDirectory)
    if (ctx.legacy) {
      if (looksWindows(node.target)) notes.push("Windows program path; point it at a Linux program or pick an installed app.")
      if (raw.runAsAdmin === true) notes.push("Was set to run as administrator, which isn't supported here.")
    }
    break
  case "path":
    node.target = str(raw.target, "")
    if (ctx.legacy && looksWindows(node.target)) notes.push("Windows path; change it to a Linux path.")
    break
  case "url":
    node.target = str(raw.target, "")
    break
  case "command":
    node.command = str(raw.command, "")
    node.shell = oneOf(raw.shell, Model.SHELLS, null)
    node.workingDirectory = optStr(raw.workingDirectory)
    node.window = raw.window === "hidden" ? "hidden" : "terminal"   // v1 "visible" → terminal
    node.keepOpen = bool(raw.keepOpen, true)
    if (ctx.legacy) {
      var was = typeof raw.shell === "string" ? raw.shell : "PowerShell"
      notes.push("Written for " + was + " on Windows; check that it works in your Linux shell.")
      if (raw.runAsAdmin === true) notes.push("Was set to run as administrator, which isn't supported here.")
    }
    break
  }

  if (ctx.legacy && node.workingDirectory && looksWindows(node.workingDirectory))
    notes.push("Windows working directory; change or clear it.")

  if (notes.length > 0) {
    node.reviewNote = notes.join(" ")
    ctx.notes.push({ id: node.id, name: node.name, message: node.reviewNote })
  }
  return node
}

function readIcon(raw, ctx) {
  if (!isObject(raw) || typeof raw.value !== "string" || raw.value.length === 0) return null
  if (ctx.legacy) {
    // exe resources and Segoe glyph code points mean nothing here; custom icon files were copies under
    // %APPDATA%. Emoji survive as they are.
    return raw.kind === "emoji" ? { kind: "emoji", value: raw.value } : null
  }
  if (Model.ICON_KINDS.indexOf(raw.kind) < 0) return null
  return { kind: raw.kind, value: raw.value }
}

// Drive letters, UNC paths, %VAR% references, backslashes, Windows executables.
function looksWindows(value) {
  if (!value) return false
  return /^[A-Za-z]:([\\\/]|$)/.test(value) ||
    value.indexOf("\\") >= 0 ||
    /%[A-Za-z_][A-Za-z0-9_()]*%/.test(value) ||
    /\.(exe|lnk|bat|cmd|msc|ps1)$/i.test(value)
}

// ---- writing ----

// Property order is fixed for hand-editing: id, type, name, type fields, confirmLaunch (only when true),
// keywords, description, icon, reviewNote (only when set), children.
function serialize(config) {
  return JSON.stringify({
    version: Model.CONFIG_VERSION,
    settings: writeSettings(config.settings || Model.defaultSettings()),
    root: writeNode(config.root || Model.createRoot())
  }, null, 2) + "\n"
}

function writeSettings(s) {
  var d = Model.defaultSettings()
  return {
    closeAfterLaunch: bool(s.closeAfterLaunch, d.closeAfterLaunch),
    maxVisibleItems: typeof s.maxVisibleItems === "number" ? s.maxVisibleItems : d.maxVisibleItems,
    defaultShell: s.defaultShell || null,
    rememberLastLocation: bool(s.rememberLastLocation, d.rememberLastLocation),
    showHintBar: bool(s.showHintBar, d.showHintBar)
  }
}

function writeNode(node) {
  var out = { id: node.id, type: node.type, name: node.name || "" }
  switch (node.type) {
  case "app":
    if (node.desktopId) {
      out.desktopId = node.desktopId
    } else {
      out.target = node.target || ""
      out.arguments = node.arguments || null
      out.workingDirectory = node.workingDirectory || null
    }
    break
  case "path":
  case "url":
    out.target = node.target || ""
    break
  case "command":
    out.command = node.command || ""
    out.shell = node.shell || null
    out.workingDirectory = node.workingDirectory || null
    out.window = node.window === "hidden" ? "hidden" : "terminal"
    out.keepOpen = node.keepOpen !== false
    break
  }
  if (node.confirmLaunch) out.confirmLaunch = true
  out.keywords = (node.keywords || []).slice()
  out.description = node.description || null
  out.icon = node.icon ? { kind: node.icon.kind, value: node.icon.value } : null
  if (node.reviewNote) out.reviewNote = node.reviewNote
  if (node.type === "folder") out.children = (node.children || []).map(writeNode)
  return out
}

// Deep copy through the on-disk shape, so a clone shares nothing with the original.
function cloneNode(node) {
  return readNode(JSON.parse(JSON.stringify(writeNode(node))), { legacy: false, notes: [] })
}
