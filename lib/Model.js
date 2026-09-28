.pragma library

// The launcher tree is plain JSON-shaped objects: { id, type, name, …type fields, confirmLaunch,
// keywords, description, icon, reviewNote, children }. See ConfigSerializer.js for the on-disk format.

var CONFIG_VERSION = 2

var NODE_TYPES = ["folder", "app", "path", "command", "url", "separator"]
var SHELLS = ["bash", "zsh", "fish", "sh"]
var WINDOW_MODES = ["terminal", "hidden"]
var ICON_KINDS = ["file", "icon", "glyph", "emoji"]

// RFC 4122 version-4 id, same shape the Windows app used (Guid "D" format).
function newId() {
  var hex = "0123456789abcdef"
  var out = ""
  for (var i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-"
    else if (i === 14) out += "4"
    else if (i === 19) out += hex.charAt(8 + Math.floor(Math.random() * 4))
    else out += hex.charAt(Math.floor(Math.random() * 16))
  }
  return out
}

// Ids end up in file names (copied icons are <config>/icons/<id>.<ext>), so only plain characters
// are allowed: letters, digits, "-", "_" and "." (not first, so never "." or ".."), at most 128.
// Windows GUIDs, newId() and hand-written slugs like "git-status" all fit.
function isSafeId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/.test(id)
}

// A safe id for any id text: itself when already safe, otherwise a readable slug plus a hash of the
// original, the same every time, so an item keeps its id across reloads until the file is saved.
// The old bookmark folder ids ("bookmarks:<source>") map to what Bookmarks.importedFolderId gives.
function safeId(id) {
  if (isSafeId(id)) return id
  var text = String(id)
  var m = /^bookmarks:(.+)$/.exec(text)
  return m ? "bookmarks-" + slugHash(m[1]) : "id-" + slugHash(text)
}

// "chrome/profile 2" → "chrome-profile-2-1a2b3c4d5e6f7a8b": up to 40 slug characters, then 64 bits
// of hash (two 32-bit FNV-1a passes), so different texts don't collide in practice.
function slugHash(text) {
  var slug = String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").substring(0, 40)
  return (slug ? slug + "-" : "") + fnv1a(text, 0x811c9dc5) + fnv1a(text, 0x01000193)
}

function fnv1a(text, seed) {
  var h = seed >>> 0
  for (var i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  var hex = h.toString(16)
  return "00000000".substring(hex.length) + hex
}

function defaultSettings() {
  return {
    closeAfterLaunch: true,
    maxVisibleItems: 8,
    defaultShell: null,          // null: the login shell from $SHELL, else bash
    rememberLastLocation: false,
    showHintBar: true
  }
}

function createRoot() {
  return createNode("folder", { id: "root", name: "Root" })
}

function createConfig() {
  return { version: CONFIG_VERSION, settings: defaultSettings(), root: createRoot() }
}

// A node of the given type with every field at its default, overridden by `fields`.
function createNode(type, fields) {
  var node = {
    id: newId(),
    type: type,
    name: "",
    confirmLaunch: false,
    keywords: [],
    description: null,
    icon: null,
    reviewNote: null
  }
  switch (type) {
  case "folder":
    node.children = []
    break
  case "app":
    node.desktopId = null        // a .desktop entry id ("firefox", "org.gnome.Nautilus"), or…
    node.target = ""             // …an executable path or name on $PATH
    node.arguments = null
    node.workingDirectory = null
    break
  case "path":
  case "url":
    node.target = ""
    break
  case "command":
    node.command = ""
    node.shell = null            // null: settings.defaultShell
    node.workingDirectory = null
    node.window = "terminal"
    node.keepOpen = true
    break
  }
  if (fields) for (var key in fields) node[key] = fields[key]
  return node
}

function isFolder(node) { return !!node && node.type === "folder" }
function isLaunchable(node) { return !!node && node.type !== "folder" && node.type !== "separator" }
