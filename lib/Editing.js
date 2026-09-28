.pragma library
.import "Model.js" as Model
.import "TargetName.js" as TargetName

// The editor works on a flat "form" (every field as the editor shows it, all strings and booleans)
// rather than on the node itself, so Cancel is free and validation happens in one place.

// Types offered by the type picker, with their shortcut letter (Windows spec D6) and glyph.
var TYPES = [
  { type: "folder", label: "Folder", key: "F", glyph: "󰉋" },
  { type: "app", label: "App", key: "A", glyph: "󰀻" },
  { type: "path", label: "File or folder path", key: "P", glyph: "󰈔" },
  { type: "command", label: "Command", key: "C", glyph: "󰆍" },
  { type: "url", label: "Web address", key: "U", glyph: "󰖟" },
  { type: "separator", label: "Separator", key: "S", glyph: "󰇜" }
]

function typeInfo(type) {
  for (var i = 0; i < TYPES.length; i++) if (TYPES[i].type === type) return TYPES[i]
  return null
}

function formFor(node) {
  return {
    type: node.type,
    name: node.name || "",
    // app: "desktop" (an installed app, by desktop id) or "program" (a path or name on $PATH)
    appMode: node.type === "app" && !node.desktopId && node.target ? "program" : "desktop",
    desktopId: node.desktopId || "",
    target: node.target || "",
    arguments: node.arguments || "",
    workingDirectory: node.workingDirectory || "",
    command: node.command || "",
    shell: node.shell || "",                 // "" = the default shell
    window: node.window === "hidden" ? "hidden" : "terminal",
    keepOpen: node.keepOpen !== false,
    keywords: (node.keywords || []).join(", "),
    description: node.description || "",
    confirmLaunch: !!node.confirmLaunch
  }
}

function emptyForm(type) {
  return formFor(Model.createNode(type))
}

function trim(s) { return String(s === null || s === undefined ? "" : s).trim() }

// { field: message } for everything that stops the form from being saved; {} when it can be.
function validate(form) {
  var errors = {}
  if (form.type === "separator") return errors
  if (!trim(form.name)) errors.name = "A name is required."
  if (form.type === "app") {
    if (form.appMode === "desktop" && !trim(form.desktopId)) errors.desktopId = "Pick an installed app."
    if (form.appMode === "program" && !trim(form.target)) errors.target = "Enter a program."
  }
  if ((form.type === "path" || form.type === "url") && !trim(form.target))
    errors.target = form.type === "url" ? "Enter an address." : "Enter a path."
  if (form.type === "command" && !trim(form.command)) errors.command = "Enter a command."
  if (form.type === "command" && form.shell && Model.SHELLS.indexOf(form.shell) < 0)
    errors.shell = "Unknown shell."
  return errors
}

function isValid(form) {
  for (var k in validate(form)) return false
  return true
}

function splitKeywords(text) {
  var seen = {}
  return String(text || "").split(",").map(trim).filter(function(k) {
    if (!k || seen[k.toLowerCase()]) return false
    seen[k.toLowerCase()] = true
    return true
  })
}

function orNull(s) {
  var t = trim(s)
  return t ? t : null
}

// Writes the form into node (same type). Editing and saving an item counts as reviewing it, so any
// migration note is cleared. The id, icon and children are left alone.
function applyForm(node, form) {
  node.name = trim(form.name)
  node.keywords = splitKeywords(form.keywords)
  node.description = orNull(form.description)
  node.confirmLaunch = form.type !== "folder" && form.type !== "separator" && !!form.confirmLaunch
  node.reviewNote = null

  switch (node.type) {
  case "app":
    if (form.appMode === "desktop") {
      node.desktopId = orNull(form.desktopId)
      node.target = ""
      node.arguments = null
    } else {
      node.desktopId = null
      node.target = trim(form.target)
      node.arguments = orNull(form.arguments)
    }
    node.workingDirectory = orNull(form.workingDirectory)
    break
  case "path":
  case "url":
    node.target = trim(form.target)
    break
  case "command":
    // Keep inner newlines (multi-line scripts); only trim the ends.
    node.command = String(form.command || "").replace(/^\s+|\s+$/g, "")
    node.shell = Model.SHELLS.indexOf(form.shell) >= 0 ? form.shell : null
    node.window = form.window === "hidden" ? "hidden" : "terminal"
    node.keepOpen = !!form.keepOpen
    node.workingDirectory = orNull(form.workingDirectory)
    break
  }
  return node
}

function createFromForm(form) {
  return applyForm(Model.createNode(form.type), form)
}

// The name to pre-fill while the user fills in the target: only when Name is still empty or still
// the previous suggestion, so a name the user typed is never overwritten. Returns the form's new
// name (unchanged if the user has typed their own).
function suggestedName(form, previousSuggestion, desktopEntryName, probe) {
  if (form.name && form.name !== previousSuggestion) return form.name
  if (form.type === "app" && form.appMode === "desktop") return desktopEntryName || form.name
  var source = form.type === "command" ? "" : form.target
  var suggestion = TargetName.suggestName(source, probe)
  return suggestion || (form.name === previousSuggestion ? "" : form.name)
}

// Status-line wording for a delete confirmation.
function deletePrompt(node) {
  if (node.type === "separator") return "Delete this separator?"
  if (node.type === "folder") {
    var n = countAll(node)
    if (n > 0) return "Delete “" + node.name + "” and the " + (n === 1 ? "item" : n + " items") + " in it?"
  }
  return "Delete “" + node.name + "”?"
}

function countAll(folder) {
  var n = 0
  var children = folder.children || []
  for (var i = 0; i < children.length; i++) {
    if (children[i].type !== "separator") n++
    if (children[i].type === "folder") n += countAll(children[i])
  }
  return n
}

// ---- icons ----

// A few common Nerd Font glyphs to pick from (any glyph can also be pasted).
var GLYPH_PALETTE = [
  "󰉋", "󰝰", "󰈔", "󰈙", "󰈚", "󰉏", "󰎆", "󰕧", "󰀻", "󰆍", "", "󰅩", "󰊢", "󰘬", "󰡨", "󰖟",
  "󰇮", "󰍡", "󰭹", "󰃭", "󰥔", "󰒓", "󰌾", "󰍛", "󰋊", "󰆼", "󰖩", "󰂯", "󰕾", "󰐥", "󰜉", "󰗼",
  "󰄛", "󰓓", "󰊴", "󰎈", "󰏘", "󰠮", "󰃨", "󰀦", "󰋜", "󰓎", "󰄬", "󰑓", "󱓞", "󰌌", "󰍹", "󰅬"
]

var ICON_KINDS = [
  { value: "auto", label: "Automatic" },
  { value: "icon", label: "Theme icon" },
  { value: "file", label: "Image file" },
  { value: "glyph", label: "Glyph" },
  { value: "emoji", label: "Emoji" }
]

// Custom icon files are copied next to the config, so the icon survives the original being moved
// or deleted: <configDir>/icons/<node id>.<ext>. null for an id that isn't a plain file name, so no
// id (the serializer already canonicalizes them) can ever point a copy outside the icons folder.
function iconCopyPath(configDir, nodeId, sourcePath) {
  if (!Model.isSafeId(nodeId)) return null
  var base = String(sourcePath).substring(String(sourcePath).lastIndexOf("/") + 1)
  var dot = base.lastIndexOf(".")
  var ext = dot > 0 ? base.substring(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : ""
  return configDir + "/icons/" + nodeId + (ext ? "." + ext : "")
}

function isInIconsDir(configDir, path) {
  return String(path).indexOf(configDir + "/icons/") === 0
}

// The icon spec for a kind and a typed value; null for automatic or an empty value.
function iconFrom(kind, value) {
  var v = trim(value)
  if (kind === "auto" || !v) return null
  return { kind: kind, value: v }
}

// The icon file this plugin copied for node, safe to delete along with it; null otherwise. Only a
// path that is exactly what iconCopyPath() makes for this id qualifies, and only for ids made of
// plain characters, so a hand-edited config can never point this at another file.
function ownedIconFile(configDir, node) {
  if (!node || !node.icon || node.icon.kind !== "file") return null
  if (!Model.isSafeId(node.id)) return null
  var value = String(node.icon.value)
  return value === iconCopyPath(configDir, node.id, value) ? value : null
}

// After TreeOps.duplicate the clone still points at the original's copied icon files, which go away
// when the original is deleted. Points each cloned node at a copy of its own and returns the
// [{ from, to }] files to copy. original and clone have the same shape (clone is a deep copy).
function iconCopiesForDuplicate(configDir, original, clone, out) {
  out = out || []
  var own = ownedIconFile(configDir, original)
  var to = own ? iconCopyPath(configDir, clone.id, own) : null
  if (to) {
    out.push({ from: own, to: to })
    clone.icon = { kind: "file", value: to }
  }
  var a = original.children || []
  var b = clone.children || []
  for (var i = 0; i < a.length && i < b.length; i++) iconCopiesForDuplicate(configDir, a[i], b[i], out)
  return out
}

// Every owned icon file in a subtree (for deleting a folder).
function ownedIconFiles(configDir, node, out) {
  out = out || []
  var own = ownedIconFile(configDir, node)
  if (own) out.push(own)
  var children = node.children || []
  for (var i = 0; i < children.length; i++) ownedIconFiles(configDir, children[i], out)
  return out
}
