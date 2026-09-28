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
