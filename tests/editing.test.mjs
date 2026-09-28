import { test } from "node:test"
import assert from "node:assert/strict"
import { load } from "./qmljs.mjs"

const Model = load("Model")
const Editing = load("Editing")
const ConfigSerializer = load("ConfigSerializer")

test("every node type round-trips through a form unchanged", () => {
  const nodes = [
    Model.createNode("folder", { name: "Dev", keywords: ["code", "work"], description: "Projects" }),
    Model.createNode("app", { name: "Files", desktopId: "org.gnome.Nautilus", confirmLaunch: true }),
    Model.createNode("app", { name: "Tool", target: "~/bin/tool", arguments: "--fast", workingDirectory: "~/w" }),
    Model.createNode("path", { name: "Docs", target: "~/Documents" }),
    Model.createNode("url", { name: "Site", target: "https://example.com" }),
    Model.createNode("command", { name: "Build", command: "make\nmake install", shell: "zsh", window: "hidden", keepOpen: false }),
    Model.createNode("separator", {}),
  ]
  for (const node of nodes) {
    const copy = ConfigSerializer.cloneNode(node)
    Editing.applyForm(copy, Editing.formFor(node))
    assert.deepEqual(copy, node, node.type)
  }
})

test("formFor picks the app mode from what's set", () => {
  assert.equal(Editing.formFor(Model.createNode("app", { desktopId: "firefox" })).appMode, "desktop")
  assert.equal(Editing.formFor(Model.createNode("app", { target: "gimp" })).appMode, "program")
  assert.equal(Editing.emptyForm("app").appMode, "desktop")
})

test("validate: name required, plus each type's essential field", () => {
  const cases = [
    [{ ...Editing.emptyForm("folder") }, ["name"]],
    [{ ...Editing.emptyForm("folder"), name: " Dev " }, []],
    [{ ...Editing.emptyForm("app"), name: "X" }, ["desktopId"]],
    [{ ...Editing.emptyForm("app"), name: "X", appMode: "program" }, ["target"]],
    [{ ...Editing.emptyForm("path"), name: "X", target: "  " }, ["target"]],
    [{ ...Editing.emptyForm("url"), name: "X" }, ["target"]],
    [{ ...Editing.emptyForm("command"), name: "X" }, ["command"]],
    [{ ...Editing.emptyForm("command"), name: "X", command: "ls", shell: "pwsh" }, ["shell"]],
    [{ ...Editing.emptyForm("separator") }, []],
  ]
  for (const [form, fields] of cases) {
    assert.deepEqual(Object.keys(Editing.validate(form)).sort(), fields.sort(), JSON.stringify(form))
    assert.equal(Editing.isValid(form), fields.length === 0)
  }
})

test("applyForm trims, splits keywords, turns blanks into null", () => {
  const node = Model.createNode("app")
  Editing.applyForm(node, { ...Editing.emptyForm("app"), appMode: "program", name: "  Tool ", target: " gimp ",
    arguments: "  ", workingDirectory: "", keywords: " image, , Paint ,image,PAINT ", description: "  " })
  assert.equal(node.name, "Tool")
  assert.equal(node.target, "gimp")
  assert.equal(node.arguments, null)
  assert.equal(node.workingDirectory, null)
  assert.deepEqual(node.keywords, ["image", "Paint"])
  assert.equal(node.description, null)
})

test("switching an app between modes clears the other mode's fields", () => {
  const node = Model.createNode("app", { name: "X", target: "gimp", arguments: "-n" })
  Editing.applyForm(node, { ...Editing.formFor(node), appMode: "desktop", desktopId: "gimp" })
  assert.equal(node.desktopId, "gimp")
  assert.equal(node.target, "")
  assert.equal(node.arguments, null)
  Editing.applyForm(node, { ...Editing.formFor(node), appMode: "program", target: "gimp-2.10" })
  assert.equal(node.desktopId, null)
  assert.equal(node.target, "gimp-2.10")
})

test("command text keeps inner newlines, loses surrounding blank space", () => {
  const node = Model.createNode("command")
  Editing.applyForm(node, { ...Editing.emptyForm("command"), name: "S", command: "\n  cd ~/x\n  make \n\n" })
  assert.equal(node.command, "cd ~/x\n  make")
})

test("saving an edit clears the review note but keeps id, icon and children", () => {
  const child = Model.createNode("url", { name: "c", target: "x" })
  const node = Model.createNode("folder", { id: "keep", name: "F", reviewNote: "check me",
    icon: { kind: "emoji", value: "📁" }, children: [child] })
  Editing.applyForm(node, { ...Editing.formFor(node), name: "Renamed" })
  assert.equal(node.reviewNote, null)
  assert.equal(node.id, "keep")
  assert.deepEqual(node.icon, { kind: "emoji", value: "📁" })
  assert.equal(node.children[0], child)
})

test("confirmLaunch only sticks on launchable types", () => {
  const folder = Editing.createFromForm({ ...Editing.emptyForm("folder"), name: "F", confirmLaunch: true })
  const cmd = Editing.createFromForm({ ...Editing.emptyForm("command"), name: "C", command: "x", confirmLaunch: true })
  assert.equal(folder.confirmLaunch, false)
  assert.equal(cmd.confirmLaunch, true)
})

test("createFromForm makes a fresh node with a new id", () => {
  const a = Editing.createFromForm({ ...Editing.emptyForm("url"), name: "A", target: "a.com" })
  const b = Editing.createFromForm({ ...Editing.emptyForm("url"), name: "A", target: "a.com" })
  assert.notEqual(a.id, b.id)
  assert.equal(a.type, "url")
})

test("suggestedName fills an empty or still-suggested name, never a typed one", () => {
  const form = { ...Editing.emptyForm("path"), target: "/home/u/Documents/Report.ods" }
  assert.equal(Editing.suggestedName(form, "", null, null), "Report")
  assert.equal(Editing.suggestedName({ ...form, name: "Report", target: "/x/Notes.md" }, "Report", null, null), "Notes")
  assert.equal(Editing.suggestedName({ ...form, name: "Mine" }, "Report", null, null), "Mine")
  assert.equal(Editing.suggestedName({ ...Editing.emptyForm("url"), target: "https://www.anthropic.com/x" }, "", null, null), "www.anthropic.com")
  assert.equal(Editing.suggestedName({ ...Editing.emptyForm("app"), desktopId: "firefox" }, "", "Firefox", null), "Firefox")
  // Clearing the target also clears a name that was only ever the suggestion.
  assert.equal(Editing.suggestedName({ ...form, name: "Report", target: "" }, "Report", null, null), "")
})

test("deletePrompt mentions what goes with a folder", () => {
  const f = Model.createNode("folder", { name: "Dev", children: [
    Model.createNode("url", { name: "a" }), Model.createNode("separator"),
    Model.createNode("folder", { name: "sub", children: [Model.createNode("url", { name: "b" })] }) ] })
  assert.equal(Editing.deletePrompt(f), "Delete “Dev” and the 3 items in it?")
  assert.equal(Editing.deletePrompt(Model.createNode("folder", { name: "Empty" })), "Delete “Empty”?")
  assert.equal(Editing.deletePrompt(Model.createNode("url", { name: "Site" })), "Delete “Site”?")
  assert.equal(Editing.deletePrompt(Model.createNode("separator")), "Delete this separator?")
})

test("icon helpers", () => {
  assert.equal(Editing.iconCopyPath("/c", "abc", "/home/u/Pics/My Logo.PNG"), "/c/icons/abc.png")
  assert.equal(Editing.iconCopyPath("/c", "abc", "/home/u/noext"), "/c/icons/abc")
  assert.equal(Editing.isInIconsDir("/c", "/c/icons/abc.png"), true)
  assert.equal(Editing.isInIconsDir("/c", "/c/iconsx/abc.png"), false)
  assert.equal(Editing.iconFrom("auto", "x"), null)
  assert.equal(Editing.iconFrom("glyph", "  "), null)
  assert.deepEqual(Editing.iconFrom("emoji", " 🚀 "), { kind: "emoji", value: "🚀" })
  assert.ok(Editing.GLYPH_PALETTE.length >= 32)
})

test("the type picker lists every node type once, with unique shortcut letters", () => {
  assert.deepEqual(Editing.TYPES.map(t => t.type).sort(), [...Model.NODE_TYPES].sort())
  assert.equal(new Set(Editing.TYPES.map(t => t.key)).size, Editing.TYPES.length)
})

test("ownedIconFile only claims files this plugin copied for that exact id", () => {
  const icon = value => ({ kind: "file", value })
  const n = (id, ic) => Model.createNode("url", { id, icon: ic })
  assert.equal(Editing.ownedIconFile("/c", n("abc-1", icon("/c/icons/abc-1.png"))), "/c/icons/abc-1.png")
  assert.equal(Editing.ownedIconFile("/c", n("abc", icon("/c/icons/abc"))), "/c/icons/abc")
  assert.equal(Editing.ownedIconFile("/c", n("abc", icon("/home/u/logo.png"))), null)        // the user's own file
  assert.equal(Editing.ownedIconFile("/c", n("abc", icon("/c/icons/other.png"))), null)      // another node's
  assert.equal(Editing.ownedIconFile("/c", n("../config", icon("/c/icons/../config.json"))), null)
  assert.equal(Editing.ownedIconFile("/c", n(".hidden", icon("/c/icons/.hidden.png"))), null)
  assert.equal(Editing.ownedIconFile("/c", n("abc", { kind: "emoji", value: "x" })), null)
  const tree = Model.createNode("folder", { id: "f", icon: icon("/c/icons/f.svg"), children: [
    n("a", icon("/c/icons/a.png")), n("b", null), Model.createNode("folder", { id: "g", children: [n("c", icon("/c/icons/c.jpg"))] }) ] })
  assert.deepEqual(Editing.ownedIconFiles("/c", tree), ["/c/icons/f.svg", "/c/icons/a.png", "/c/icons/c.jpg"])
})

test("a duplicate gets its own copies of copied icons, so deleting the original can't break it", () => {
  const TreeOps = load("TreeOps")
  const icon = value => ({ kind: "file", value })
  const root = Model.createRoot()
  const folder = Model.createNode("folder", { id: "f", name: "F", icon: icon("/c/icons/f.svg"), children: [
    Model.createNode("url", { id: "a", name: "a", icon: icon("/c/icons/a.png") }),
    Model.createNode("url", { id: "b", name: "b", icon: icon("/home/u/logo.png") }) ] })
  root.children.push(folder)
  const clone = TreeOps.duplicate(root, folder)
  const copies = Editing.iconCopiesForDuplicate("/c", folder, clone)
  assert.deepEqual(copies, [
    { from: "/c/icons/f.svg", to: "/c/icons/" + clone.id + ".svg" },
    { from: "/c/icons/a.png", to: "/c/icons/" + clone.children[0].id + ".png" } ])
  assert.equal(Editing.ownedIconFile("/c", clone), "/c/icons/" + clone.id + ".svg")
  assert.equal(Editing.ownedIconFile("/c", clone.children[0]), "/c/icons/" + clone.children[0].id + ".png")
  assert.deepEqual(clone.children[1].icon, icon("/home/u/logo.png"))   // the user's own file is shared, not copied
  assert.deepEqual(folder.icon, icon("/c/icons/f.svg"))                 // the original is untouched
})
