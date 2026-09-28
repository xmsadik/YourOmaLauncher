import { test } from "node:test"
import assert from "node:assert/strict"
import { load } from "./qmljs.mjs"

const Model = load("Model")
const TreeOps = load("TreeOps")
const Usage = load("Usage")

const folder = (id, ...children) => Model.createNode("folder", { id, name: id.toUpperCase(), children })
const item = (id, extra) => Model.createNode("url", { id, name: id.toUpperCase(), target: "https://" + id, ...extra })
const ids = f => f.children.map(n => n.id)

// ---- find ----

test("findParent: root-level node → root; nested → its immediate parent", () => {
  const leaf = item("leaf")
  const inner = folder("inner", leaf)
  const top = item("top")
  const root = folder("root", top, inner)
  assert.equal(TreeOps.findParent(root, top), root)
  assert.equal(TreeOps.findParent(root, leaf), inner)
})

test("findParent: node not in the tree, or the root itself → null", () => {
  const root = folder("root", item("a"))
  assert.equal(TreeOps.findParent(root, item("a")), null)   // same id, different object
  assert.equal(TreeOps.findParent(root, root), null)
})

test("findParentById and findById match by id", () => {
  const leaf = item("leaf")
  const inner = folder("inner", leaf)
  const root = folder("root", inner)
  assert.equal(TreeOps.findParentById(root, "leaf"), inner)
  assert.equal(TreeOps.findById(root, "leaf"), leaf)
  assert.equal(TreeOps.findById(root, "root"), null)
  assert.equal(TreeOps.findById(root, "missing"), null)
})

test("pathTo gives root … folder", () => {
  const b = folder("b")
  const root = folder("root", folder("a", b))
  assert.deepEqual(TreeOps.pathTo(root, b).map(f => f.id), ["root", "a", "b"])
  assert.deepEqual(TreeOps.pathTo(root, root).map(f => f.id), ["root"])
  assert.equal(TreeOps.pathTo(root, folder("elsewhere")), null)
})

// ---- add / remove ----

test("add appends, or inserts at a clamped index", () => {
  const root = folder("root", item("a"), item("b"))
  TreeOps.add(root, item("c"))
  TreeOps.add(root, item("x"), 1)
  TreeOps.add(root, item("first"), -5)
  TreeOps.add(root, item("last"), 99)
  assert.deepEqual(ids(root), ["first", "a", "x", "b", "c", "last"])
})

test("remove takes a folder's whole subtree with it", () => {
  const sub = folder("sub", item("deep"))
  const root = folder("root", item("a"), sub)
  assert.equal(TreeOps.remove(root, sub), true)
  assert.deepEqual(ids(root), ["a"])
  assert.equal(TreeOps.findById(root, "deep"), null)
})

test("remove: node not in the tree → false", () => {
  assert.equal(TreeOps.remove(folder("root", item("a")), item("a")), false)
})

// ---- move up / down within the display group ----

test("moveUp at the start of its group, and moveDown at the end, return false", () => {
  const a = item("a"), b = item("b")
  const root = folder("root", a, b)
  assert.equal(TreeOps.moveUp(root, a), false)
  assert.equal(TreeOps.moveDown(root, b), false)
  assert.deepEqual(ids(root), ["a", "b"])
})

test("moveDown in the middle swaps with the next in stored order", () => {
  const b = item("b")
  const root = folder("root", item("a"), b, item("c"))
  assert.equal(TreeOps.moveDown(root, b), true)
  assert.deepEqual(ids(root), ["a", "c", "b"])
})

test("moveUp with mixed folders and items only swaps within its own group", () => {
  // Stored: item1, folderA, item2, folderB. Displayed: folderA, folderB, item1, item2.
  const item2 = item("item2"), folderB = folder("folderB")
  const root = folder("root", item("item1"), folder("folderA"), item2, folderB)
  assert.equal(TreeOps.moveUp(root, item2), true)
  assert.deepEqual(ids(root), ["item2", "folderA", "item1", "folderB"])
  assert.equal(TreeOps.moveUp(root, folderB), true)
  assert.deepEqual(ids(root), ["item2", "folderB", "item1", "folderA"])
})

test("moveUp: the only member of its group, or a node without a parent → false", () => {
  const only = item("only")
  const root = folder("root", folder("f"), only)
  assert.equal(TreeOps.moveUp(root, only), false)
  assert.equal(TreeOps.moveDown(root, item("stray")), false)
})

// ---- moveToGroupIndex (drag reorder) ----

test("moveToGroupIndex moves to the exact final position", () => {
  const a = item("a")
  const root = folder("root", a, item("b"), item("c"), item("d"))
  assert.equal(TreeOps.moveToGroupIndex(root, a, 2), true)
  assert.deepEqual(ids(root), ["b", "c", "a", "d"])
})

test("moveToGroupIndex clamps and reports no-ops", () => {
  const a = item("a"), c = item("c")
  const root = folder("root", a, item("b"), c)
  assert.equal(TreeOps.moveToGroupIndex(root, a, 99), true)
  assert.deepEqual(ids(root), ["b", "c", "a"])
  assert.equal(TreeOps.moveToGroupIndex(root, c, -3), true)
  assert.deepEqual(ids(root), ["c", "b", "a"])
  assert.equal(TreeOps.moveToGroupIndex(root, c, 0), false)
  assert.deepEqual(ids(root), ["c", "b", "a"])
})

test("moveToGroupIndex stays within its own group; the other group keeps its slots", () => {
  const i1 = item("i1")
  const root = folder("root", i1, folder("f1"), item("i2"), folder("f2"), item("i3"))
  assert.equal(TreeOps.moveToGroupIndex(root, i1, 2), true)
  assert.deepEqual(ids(root), ["i2", "f1", "i3", "f2", "i1"])
})

test("moveToGroupIndex: no parent, or single member → false", () => {
  const only = item("only")
  const root = folder("root", only)
  assert.equal(TreeOps.moveToGroupIndex(root, only, 0), false)
  assert.equal(TreeOps.moveToGroupIndex(root, item("stray"), 0), false)
})

// ---- moveTo (cut / paste) ----

test("moveTo a different folder appends at the end and leaves the old parent", () => {
  const a = item("a")
  const target = folder("target", item("t1"))
  const root = folder("root", a, target)
  assert.equal(TreeOps.moveTo(root, a, target), TreeOps.MOVED)
  assert.deepEqual(ids(root), ["target"])
  assert.deepEqual(ids(target), ["t1", "a"])
})

test("moveTo the folder it's already in is a no-op", () => {
  const a = item("a")
  const root = folder("root", a)
  assert.equal(TreeOps.moveTo(root, a, root), TreeOps.NO_OP)
})

test("moveTo itself or its own subtree is rejected", () => {
  const inner = folder("inner")
  const outer = folder("outer", inner)
  const root = folder("root", outer)
  assert.equal(TreeOps.moveTo(root, outer, outer), TreeOps.REJECTED)
  assert.equal(TreeOps.moveTo(root, outer, inner), TreeOps.REJECTED)
  assert.deepEqual(ids(root), ["outer"])
})

test("moveTo a leaf into an unrelated nested folder succeeds", () => {
  const leaf = item("leaf")
  const deep = folder("deep")
  const root = folder("root", folder("a", leaf), folder("b", deep))
  assert.equal(TreeOps.moveTo(root, leaf, deep), TreeOps.MOVED)
  assert.deepEqual(ids(deep), ["leaf"])
})

// ---- duplicate ----

test("duplicate inserts a copy right after the original with a new id", () => {
  const a = item("a", { keywords: ["k"], description: "desc", icon: { kind: "emoji", value: "⭐" } })
  const root = folder("root", a, item("b"))
  const copy = TreeOps.duplicate(root, a)
  assert.deepEqual(ids(root).slice(0, 1), ["a"])
  assert.equal(root.children[1], copy)
  assert.notEqual(copy.id, "a")
  assert.equal(copy.name, "A (copy)")
  assert.deepEqual(copy.keywords, ["k"])
  assert.equal(copy.description, "desc")
  copy.icon.value = "x"
  copy.keywords.push("y")
  assert.equal(a.icon.value, "⭐")
  assert.deepEqual(a.keywords, ["k"])
})

test("duplicate deep-copies a folder with fresh ids throughout", () => {
  const f = folder("f", item("x"), folder("g", item("y")))
  const root = folder("root", f)
  const copy = TreeOps.duplicate(root, f)
  const all = TreeOps.collectIds(root)
  assert.equal(new Set(all).size, all.length)
  assert.equal(copy.children[1].children[0].name, "Y")
  copy.children[1].children[0].name = "changed"
  assert.equal(f.children[1].children[0].name, "Y")
})

test("ids stay unique across repeated duplication", () => {
  const f = folder("f", item("x"))
  const root = folder("root", f)
  for (let i = 0; i < 20; i++) TreeOps.duplicate(root, root.children[i % root.children.length])
  const all = TreeOps.collectIds(root)
  assert.equal(new Set(all).size, all.length)
})

test("duplicate: node not in the tree → null; separators keep their name", () => {
  const sep = Model.createNode("separator", { id: "s", name: "" })
  const root = folder("root", sep)
  assert.equal(TreeOps.duplicate(root, item("stray")), null)
  assert.equal(TreeOps.duplicate(root, sep).name, "")
})

test("newId gives unique v4 UUID strings", () => {
  const seen = new Set()
  for (let i = 0; i < 1000; i++) {
    const id = Model.newId()
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    seen.add(id)
  }
  assert.equal(seen.size, 1000)
})

// ---- import merge ----

test("merge without collisions appends children in order", () => {
  const current = folder("root", item("a1"))
  const imported = folder("root2", item("i1"), item("i2"), item("i3"))
  assert.equal(TreeOps.merge(current, imported), 3)
  assert.deepEqual(ids(current), ["a1", "i1", "i2", "i3"])
})

test("merge renames a colliding top-level id and leaves the original alone", () => {
  const current = folder("root", item("dup"))
  TreeOps.merge(current, folder("root2", item("dup", { name: "Imported" })))
  assert.equal(current.children[0].id, "dup")
  assert.notEqual(current.children[1].id, "dup")
  assert.equal(current.children[1].name, "Imported")
})

test("merge renames a colliding nested id but keeps non-colliding ones", () => {
  const current = folder("root", folder("dupFolder", item("leaf")))
  TreeOps.merge(current, folder("root2", folder("dupFolder", item("dupLeaf"))))
  assert.notEqual(current.children[1].id, "dupFolder")
  assert.equal(current.children[1].children[0].id, "dupLeaf")
})

test("merge gives two colliding imports distinct new ids", () => {
  const current = folder("root", item("dup"))
  TreeOps.merge(current, folder("root2", item("dup"), item("dup")))
  const [, a, b] = ids(current)
  assert.notEqual(a, "dup")
  assert.notEqual(b, "dup")
  assert.notEqual(a, b)
})

test("countDescendants counts nested nodes", () => {
  assert.equal(TreeOps.countDescendants(folder("root", item("a"), folder("f", item("b"), item("c")))), 4)
})

// ---- usage ----

const NOW = new Date(Date.UTC(2026, 8, 26, 12, 0, 0))
const daysAgo = d => new Date(NOW.getTime() - d * 24 * 3600 * 1000)

test("record creates an entry, then increments it and bumps lastUsed", () => {
  const data = Usage.create()
  Usage.record(data, "a", daysAgo(2))
  assert.deepEqual(data.entries.a, { useCount: 1, lastUsedUtc: daysAgo(2).toISOString() })
  Usage.record(data, "a", NOW)
  assert.deepEqual(data.entries.a, { useCount: 2, lastUsedUtc: NOW.toISOString() })
})

test("score of an unknown node is 0", () => {
  assert.equal(Usage.score(Usage.create(), "missing", NOW), 0)
})

for (const [age, weight] of [[0, 4], [1, 4], [1.5, 2], [7, 2], [10, 1], [30, 1], [60, 0.5]]) {
  test(`score applies weight ${weight} at ${age} days`, () => {
    const data = Usage.create()
    data.entries.a = { useCount: 1, lastUsedUtc: daysAgo(age).toISOString() }
    assert.equal(Usage.score(data, "a", NOW), weight)
  })
}

test("recent low count can outrank stale high count", () => {
  const data = Usage.create()
  data.entries.recent = { useCount: 1, lastUsedUtc: daysAgo(0.05).toISOString() }
  data.entries.stale = { useCount: 3, lastUsedUtc: daysAgo(60).toISOString() }
  data.entries.frequent = { useCount: 10, lastUsedUtc: daysAgo(0.05).toISOString() }
  assert.ok(Usage.score(data, "recent", NOW) > Usage.score(data, "stale", NOW))
  assert.ok(Usage.score(data, "frequent", NOW) > Usage.score(data, "recent", NOW))
})

test("prune drops entries for nodes that no longer exist", () => {
  const data = Usage.create()
  Usage.record(data, "kept", NOW)
  Usage.record(data, "gone", NOW)
  Usage.prune(data, ["kept"])
  assert.deepEqual(Object.keys(data.entries), ["kept"])
  Usage.prune(data, [])
  assert.deepEqual(data.entries, {})
})

test("usage (de)serialization round-trips and never throws", () => {
  const data = Usage.create()
  Usage.record(data, "a", NOW)
  Usage.record(data, "a", NOW)
  Usage.record(data, "b", daysAgo(5))
  assert.deepEqual(Usage.deserialize(Usage.serialize(data)), data)
  assert.deepEqual(Usage.deserialize("{ this is not json"), Usage.create())
  assert.deepEqual(Usage.deserialize(""), Usage.create())
  assert.deepEqual(Usage.deserialize('{"entries": {"x": {"useCount": "lots"}}}'), Usage.create())
})

test("usage.json from the Windows app reads as-is", () => {
  const data = Usage.deserialize('{"entries":{"n1":{"useCount":4,"lastUsedUtc":"2026-09-25T08:30:00Z"}}}')
  assert.equal(Usage.score(data, "n1", NOW), 8)
})
