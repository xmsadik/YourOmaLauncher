.pragma library
.import "Model.js" as Model
.import "ConfigSerializer.js" as ConfigSerializer

// Tree edits, in place, on the folder tree rooted at config.root. Nodes are identified by reference
// unless a ...ById function is used. Callers save the config and rebuild the search index afterwards.
//
// "Display group": the panel lists folders before everything else inside a folder, but both groups
// keep their own stored order in children. moveUp/moveDown/moveToGroupIndex work within the node's own
// group, so the visible result is always a one-step move that never crosses the folder boundary.

var MOVED = "moved"
var NO_OP = "noop"          // already a direct child of the target folder
var REJECTED = "rejected"   // target is the node itself or inside its own subtree, or node isn't in the tree

function findParent(root, node) {
  var children = root.children || []
  for (var i = 0; i < children.length; i++) {
    if (children[i] === node) return root
    if (children[i].type === "folder") {
      var found = findParent(children[i], node)
      if (found) return found
    }
  }
  return null
}

function findParentById(root, id) {
  var children = root.children || []
  for (var i = 0; i < children.length; i++) {
    if (children[i].id === id) return root
    if (children[i].type === "folder") {
      var found = findParentById(children[i], id)
      if (found) return found
    }
  }
  return null
}

// Anywhere under root (root itself is never returned; callers already hold it).
function findById(root, id) {
  var children = root.children || []
  for (var i = 0; i < children.length; i++) {
    if (children[i].id === id) return children[i]
    if (children[i].type === "folder") {
      var found = findById(children[i], id)
      if (found) return found
    }
  }
  return null
}

// Root … folder, inclusive, or null if folder isn't under root. Used to rebuild breadcrumbs.
function pathTo(root, folder) {
  if (root === folder) return [root]
  var children = root.children || []
  for (var i = 0; i < children.length; i++) {
    if (children[i].type !== "folder") continue
    var sub = pathTo(children[i], folder)
    if (sub) return [root].concat(sub)
  }
  return null
}

// Appended at the end, or inserted at index (clamped).
function add(folder, node, index) {
  if (index === undefined || index === null) folder.children.push(node)
  else folder.children.splice(Math.max(0, Math.min(index, folder.children.length)), 0, node)
}

// Removes node (a folder takes its whole subtree with it). False if it isn't under root.
function remove(root, node) {
  var parent = findParent(root, node)
  if (!parent) return false
  parent.children.splice(parent.children.indexOf(node), 1)
  return true
}

function moveUp(root, node) { return moveWithinGroup(root, node, -1) }
function moveDown(root, node) { return moveWithinGroup(root, node, 1) }

function sameGroup(a, b) { return (a.type === "folder") === (b.type === "folder") }

function moveWithinGroup(root, node, direction) {
  var parent = findParent(root, node)
  if (!parent) return false
  var siblings = parent.children
  var group = siblings.filter(function(n) { return sameGroup(n, node) })
  var target = group.indexOf(node) + direction
  if (target < 0 || target >= group.length) return false
  var a = siblings.indexOf(node)
  var b = siblings.indexOf(group[target])
  siblings[a] = group[target]
  siblings[b] = node
  return true
}

// Drag reorder: after the move, node is the groupIndex-th (0-based, clamped) member of its own display
// group. Nodes of the other group keep their exact stored slots. False if nothing changed.
function moveToGroupIndex(root, node, groupIndex) {
  var parent = findParent(root, node)
  if (!parent) return false
  var siblings = parent.children
  var group = siblings.filter(function(n) { return sameGroup(n, node) })
  var clamped = Math.max(0, Math.min(groupIndex, group.length - 1))
  var current = group.indexOf(node)
  if (current === clamped) return false
  group.splice(current, 1)
  group.splice(clamped, 0, node)
  var next = 0
  for (var i = 0; i < siblings.length; i++)
    if (sameGroup(siblings[i], node)) siblings[i] = group[next++]
  return true
}

// Cut/paste: moves node to the end of targetFolder.
function moveTo(root, node, targetFolder) {
  if (node === targetFolder) return REJECTED
  if (node.type === "folder" && isSameOrDescendant(node, targetFolder)) return REJECTED
  var parent = findParent(root, node)
  if (!parent) return REJECTED
  if (parent === targetFolder) return NO_OP
  parent.children.splice(parent.children.indexOf(node), 1)
  targetFolder.children.push(node)
  return MOVED
}

function isSameOrDescendant(ancestor, candidate) {
  if (ancestor === candidate) return true
  var children = ancestor.children || []
  for (var i = 0; i < children.length; i++)
    if (children[i].type === "folder" && isSameOrDescendant(children[i], candidate)) return true
  return false
}

// Deep copy with fresh ids for it and every descendant, named "<name> (copy)" (separators keep their
// name), inserted right after the original. Null if node isn't under root.
function duplicate(root, node) {
  var parent = findParent(root, node)
  if (!parent) return null
  var clone = ConfigSerializer.cloneNode(node)
  if (node.type !== "separator") clone.name = node.name + " (copy)"
  assignNewIds(clone)
  parent.children.splice(parent.children.indexOf(node) + 1, 0, clone)
  return clone
}

function assignNewIds(node) {
  node.id = Model.newId()
  var children = node.children || []
  for (var i = 0; i < children.length; i++) assignNewIds(children[i])
}

// Every id in the subtree, node itself included.
function collectIds(node, out) {
  out = out || []
  out.push(node.id)
  var children = node.children || []
  for (var i = 0; i < children.length; i++) collectIds(children[i], out)
  return out
}

// Nodes under (not including) folder.
function countDescendants(folder) {
  var n = 0
  var children = folder.children || []
  for (var i = 0; i < children.length; i++) n += 1 + countDescendants(children[i])
  return n
}

// Import "merge": appends importedRoot's children to currentRoot in order. Any imported id that
// collides with one already in either tree gets a fresh id (reserved as it goes, so two colliding
// imports never share a new id). Folders with the same name are not merged. Returns nodes added.
function merge(currentRoot, importedRoot) {
  var reserved = {}
  collectIds(currentRoot).forEach(function(id) { reserved[id] = true })
  var children = importedRoot.children || []
  for (var i = 0; i < children.length; i++) {
    renameCollisions(children[i], reserved)
    currentRoot.children.push(children[i])
  }
  return countDescendants(importedRoot)
}

function renameCollisions(node, reserved) {
  if (reserved[node.id]) node.id = Model.newId()
  reserved[node.id] = true
  var children = node.children || []
  for (var i = 0; i < children.length; i++) renameCollisions(children[i], reserved)
}
