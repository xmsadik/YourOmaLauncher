.pragma library
.import "SearchEngine.js" as SearchEngine

// What the panel shows: rows for a folder listing or search results, selection movement, secondary
// text and name highlighting. UI-free so it can be tested outside the shell.
//
// A row is { node, separator, positions (highlight indices into node.name), secondary, reviewNote,
// result (the search result, search mode only) }.

var GLYPHS = {
  folder: "󰉋",
  app: "󰀻",
  path: "󰈔",
  command: "󰆍",
  url: "󰖟",
  warning: "󰀦"
}

// Folders first, then everything else; each group in stored order. Separators belong to the
// non-folder group, same as the Windows app.
function folderRows(folder) {
  var children = (folder && folder.children) || []
  var rows = []
  var i
  for (i = 0; i < children.length; i++)
    if (children[i].type === "folder") rows.push(rowFor(children[i], [], null))
  for (i = 0; i < children.length; i++)
    if (children[i].type !== "folder") rows.push(rowFor(children[i], [], null))
  return rows
}

function resultRows(results) {
  return results.map(function(r) { return rowFor(r.node, r.namePositions, r) })
}

function rowFor(node, positions, result) {
  return {
    node: node,
    separator: node.type === "separator",
    positions: positions,
    secondary: result ? result.breadcrumb : secondaryText(node),
    reviewNote: node.reviewNote || null,
    result: result
  }
}

function countItems(folder) {
  var n = 0
  var children = folder.children || []
  for (var i = 0; i < children.length; i++) if (children[i].type !== "separator") n++
  return n
}

// Right-hand text in a folder listing: a folder's item count, a command's first line, otherwise the
// description.
function secondaryText(node) {
  if (node.type === "folder") {
    var n = countItems(node)
    return n === 1 ? "1 item" : n + " items"
  }
  if (node.type === "command") return String(node.command || "").split("\n")[0]
  return node.description || ""
}

function isSelectable(rows, i) {
  return i >= 0 && i < rows.length && !rows[i].separator
}

function firstSelectable(rows) {
  for (var i = 0; i < rows.length; i++) if (!rows[i].separator) return i
  return -1
}

function lastSelectable(rows) {
  for (var i = rows.length - 1; i >= 0; i--) if (!rows[i].separator) return i
  return -1
}

// Moves the selection by delta rows, skipping separators. wrap: going past either end continues from
// the other one (arrow keys); otherwise it stops at the first/last selectable row (Page Up/Down).
function step(rows, index, delta, wrap) {
  if (firstSelectable(rows) < 0) return -1
  if (!isSelectable(rows, index)) return delta >= 0 ? firstSelectable(rows) : lastSelectable(rows)
  if (wrap) {
    var dir = delta > 0 ? 1 : -1
    var i = index
    for (var moved = 0; moved < Math.abs(delta); ) {
      i = (i + dir + rows.length) % rows.length
      if (!rows[i].separator) moved++
    }
    return i
  }
  var target = Math.max(0, Math.min(rows.length - 1, index + delta))
  if (isSelectable(rows, target)) return target
  // Landed on a separator: keep going the same way, else back.
  var d = delta >= 0 ? 1 : -1
  for (var j = target; j >= 0 && j < rows.length; j += d) if (!rows[j].separator) return j
  for (var k = target; k >= 0 && k < rows.length; k -= d) if (!rows[k].separator) return k
  return index
}

function indexOfNode(rows, node) {
  for (var i = 0; i < rows.length; i++) if (rows[i].node === node) return i
  return -1
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

// Styled text for a name with the matched characters in `color` and bold. Positions index into the
// name (the normalizer keeps lengths 1:1, so search positions map straight onto the original).
function highlight(name, positions, color) {
  name = String(name || "")
  if (!positions || positions.length === 0) return escapeHtml(name)
  var marked = {}
  for (var p = 0; p < positions.length; p++) marked[positions[p]] = true
  var out = ""
  var open = false
  for (var i = 0; i < name.length; i++) {
    if (marked[i] && !open) { out += "<b><font color=\"" + color + "\">"; open = true }
    if (!marked[i] && open) { out += "</font></b>"; open = false }
    out += escapeHtml(name.charAt(i))
  }
  if (open) out += "</font></b>"
  return out
}

// Breadcrumb for the header: folder names below the root, " › "-joined; empty at the root.
function breadcrumb(folderPath) {
  var names = []
  for (var i = 1; i < folderPath.length; i++) names.push(folderPath[i].name)
  return names.join(SearchEngine.BREADCRUMB_SEPARATOR)
}

// The glyph shown when a node has no icon of its own, or when its icon can't be displayed.
function fallbackGlyph(node) {
  return GLYPHS[node.type] || GLYPHS.app
}
