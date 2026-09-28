import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { load } from "./qmljs.mjs"

const Model = load("Model")
const ConfigSerializer = load("ConfigSerializer")
const Jsonc = load("Jsonc")

const node = (type, fields) => Model.createNode(type, fields)

function nestedConfig() {
  const level4 = node("folder", {
    id: "level4", name: "Level 4", children: [
      node("app", { id: "app1", name: "Editor", target: "/usr/bin/nvim", arguments: "notes.md", workingDirectory: "~/notes" }),
      node("app", { id: "app2", name: "Files", desktopId: "org.gnome.Nautilus" }),
      node("path", { id: "path1", name: "Documents", target: "~/Documents" }),
      node("command", { id: "cmd1", name: "Build", command: "git pull && npm run build", shell: "bash", keepOpen: true }),
      node("url", { id: "url1", name: "Anthropic", target: "https://www.anthropic.com" }),
    ],
  })
  const level3 = node("folder", { id: "level3", name: "Level 3", children: [level4] })
  const level2 = node("folder", { id: "level2", name: "Level 2", children: [level3] })
  const level1 = node("folder", { id: "level1", name: "Level 1", children: [level2] })
  const config = Model.createConfig()
  config.settings.defaultShell = "zsh"
  config.settings.maxVisibleItems = 10
  config.root.children.push(level1)
  return config
}

function inOrder(json, ...fragments) {
  let last = json.indexOf(fragments[0])
  assert.ok(last >= 0, `'${fragments[0]}' not found`)
  for (const fragment of fragments.slice(1)) {
    const index = json.indexOf(fragment, last)
    assert.ok(index > last, `'${fragment}' should come after position ${last}`)
    last = index
  }
}

test("round trip keeps every node type and four levels of nesting", () => {
  const result = ConfigSerializer.deserialize(ConfigSerializer.serialize(nestedConfig()))
  assert.ok(result.ok, result.error)
  const config = result.config
  assert.equal(config.version, 2)
  assert.equal(config.settings.defaultShell, "zsh")
  assert.equal(config.settings.maxVisibleItems, 10)
  const level4 = config.root.children[0].children[0].children[0].children[0]
  assert.deepEqual(level4.children.map(n => n.type), ["app", "app", "path", "command", "url"])
  const [app, desktopApp, path, command, url] = level4.children
  assert.equal(app.target, "/usr/bin/nvim")
  assert.equal(app.arguments, "notes.md")
  assert.equal(app.workingDirectory, "~/notes")
  assert.equal(desktopApp.desktopId, "org.gnome.Nautilus")
  assert.equal(path.target, "~/Documents")
  assert.equal(command.command, "git pull && npm run build")
  assert.equal(command.shell, "bash")
  assert.equal(command.window, "terminal")
  assert.equal(url.target, "https://www.anthropic.com")
  assert.deepEqual(result.notes, [])
})

test("round trip is stable: serializing a loaded config gives the same text", () => {
  const first = ConfigSerializer.serialize(nestedConfig())
  assert.equal(ConfigSerializer.serialize(ConfigSerializer.deserialize(first).config), first)
})

test("serialize writes the type discriminator and readable settings", () => {
  const json = ConfigSerializer.serialize(nestedConfig())
  assert.ok(json.includes('"type": "folder"'))
  assert.ok(json.includes('"defaultShell": "zsh"'))
  assert.ok(json.includes('"maxVisibleItems": 10'))
  assert.ok(json.includes('"version": 2'))
})

test("node properties are written id, type, name first and children last", () => {
  const config = Model.createConfig()
  config.root.children.push(node("folder", {
    id: "f1", name: "Dev", children: [node("app", { id: "a1", name: "Editor", target: "/usr/bin/nvim" })],
  }))
  const json = ConfigSerializer.serialize(config)
  inOrder(json, '"id": "f1"', '"type": "folder"', '"name": "Dev"', '"keywords"', '"children"')
  inOrder(json, '"id": "a1"', '"type": "app"', '"name": "Editor"', '"target"', '"keywords"', '"description"', '"icon"')
})

test("a desktop app writes desktopId instead of target fields", () => {
  const config = Model.createConfig()
  config.root.children.push(node("app", { id: "a", name: "Files", desktopId: "org.gnome.Nautilus" }))
  const json = ConfigSerializer.serialize(config)
  assert.ok(json.includes('"desktopId": "org.gnome.Nautilus"'))
  assert.ok(!json.includes('"target"'))
})

test("confirmLaunch is omitted when false and round-trips when true", () => {
  const config = Model.createConfig()
  config.root.children.push(node("app", { id: "plain", name: "Editor", target: "nvim" }))
  config.root.children.push(node("command", { id: "off", name: "Shut down", command: "systemctl poweroff", confirmLaunch: true }))
  const json = ConfigSerializer.serialize(config)
  assert.equal(json.split('"confirmLaunch"').length - 1, 1)
  inOrder(json, '"id": "off"', '"confirmLaunch": true', '"keywords"')
  const reloaded = ConfigSerializer.deserialize(json).config
  assert.equal(reloaded.root.children[0].confirmLaunch, false)
  assert.equal(reloaded.root.children[1].confirmLaunch, true)
})

test("comments and trailing commas are accepted", () => {
  const result = ConfigSerializer.deserialize(`{
    // a comment
    "version": 2,
    /* block
       comment */
    "settings": { "showHintBar": false, },
    "root": { "id": "root", "type": "folder", "name": "Root", "children": [], },
  }`)
  assert.ok(result.ok, result.error)
  assert.equal(result.config.settings.showHintBar, false)
  assert.deepEqual(result.config.root.children, [])
})

test("comment markers and commas inside strings are left alone", () => {
  assert.deepEqual(Jsonc.parse('{ "a": "http://x // y, }", "b": "/* c */" }'), { a: "http://x // y, }", b: "/* c */" })
  assert.deepEqual(Jsonc.parse('{ "a": "quote \\" // still string" }'), { a: 'quote " // still string' })
})

test("unknown properties are ignored", () => {
  const result = ConfigSerializer.deserialize(`{
    "version": 2,
    "somethingFromTheFuture": { "nested": true },
    "settings": { "closeAfterLaunch": false, "unknownSetting": 42 },
    "root": { "id": "root", "type": "folder", "name": "Root", "children": [], "extra": "ignored" }
  }`)
  assert.ok(result.ok, result.error)
  assert.equal(result.config.settings.closeAfterLaunch, false)
})

test("missing optional fields get defaults", () => {
  const result = ConfigSerializer.deserialize('{ "version": 2, "root": { "id": "root", "type": "folder", "name": "Root" } }')
  assert.ok(result.ok, result.error)
  assert.deepEqual(result.config.settings, Model.defaultSettings())
  assert.deepEqual(result.config.root.children, [])
})

test("a missing root gives an empty tree", () => {
  const result = ConfigSerializer.deserialize('{ "version": 2 }')
  assert.ok(result.ok, result.error)
  assert.equal(result.config.root.id, "root")
})

for (const bad of ["{ not valid json ", "", "[1,2,3]", "null", '"text"', '{ "version": 2, "root": [] }',
  '{ "version": 2, "root": { "children": [ { "name": "no type" } ] } }',
  '{ "version": 2, "root": { "children": [ { "type": "widget" } ] } }',
  '{ "version": 2, "root": { "children": "nope" } }']) {
  test(`corrupt or wrongly shaped input fails without throwing: ${JSON.stringify(bad)}`, () => {
    const result = ConfigSerializer.deserialize(bad)
    assert.equal(result.ok, false)
    assert.equal(result.config, null)
    assert.ok(result.error)
  })
}

test("a config from a newer version is refused", () => {
  const result = ConfigSerializer.deserialize('{ "version": 3, "root": {} }')
  assert.equal(result.ok, false)
  assert.match(result.error, /newer/)
})

test("separator keeps its type and position", () => {
  const config = Model.createConfig()
  config.root.children.push(node("app", { id: "a", name: "A", target: "a" }))
  config.root.children.push(node("separator", { id: "sep" }))
  config.root.children.push(node("app", { id: "b", name: "B", target: "b" }))
  const json = ConfigSerializer.serialize(config)
  assert.ok(json.includes('"type": "separator"'))
  const reloaded = ConfigSerializer.deserialize(json).config
  assert.equal(reloaded.root.children[1].type, "separator")
  assert.equal(reloaded.root.children[1].id, "sep")
})

test("icons: valid kinds round-trip, unknown kinds reset to automatic", () => {
  const config = Model.createConfig()
  config.root.children.push(node("app", { id: "a", name: "A", target: "a", icon: { kind: "icon", value: "firefox" } }))
  config.root.children.push(node("app", { id: "b", name: "B", target: "b", icon: { kind: "emoji", value: "🚀" } }))
  const json = ConfigSerializer.serialize(config).replace('"emoji"', '"hologram"')
  const [a, b] = ConfigSerializer.deserialize(json).config.root.children
  assert.deepEqual(a.icon, { kind: "icon", value: "firefox" })
  assert.equal(b.icon, null)
})

test("cloneNode shares nothing with the original", () => {
  const original = node("folder", { name: "F", keywords: ["k"], icon: { kind: "emoji", value: "📁" },
    children: [node("url", { name: "U", target: "https://x" })] })
  const clone = ConfigSerializer.cloneNode(original)
  assert.deepEqual(clone, original)
  clone.keywords.push("more")
  clone.icon.value = "x"
  clone.children[0].name = "changed"
  assert.deepEqual(original.keywords, ["k"])
  assert.equal(original.icon.value, "📁")
  assert.equal(original.children[0].name, "U")
})

// ---- migration from the Windows app (version 1) ----

const windowsExample = readFileSync(new URL("./fixtures/windows-config.example.json", import.meta.url), "utf8")

test("the Windows example config loads and migrates to version 2", () => {
  const result = ConfigSerializer.deserialize(windowsExample)
  assert.ok(result.ok, result.error)
  assert.equal(result.config.version, 2)
  const s = result.config.settings
  assert.equal(s.defaultShell, null)                // "pwsh" doesn't exist here
  assert.equal(s.hotkey, undefined)                 // Windows-only settings are dropped
  assert.equal(s.startWithWindows, undefined)
  assert.equal(s.showHintBar, true)
  // …and what comes out is a valid version 2 file.
  const again = ConfigSerializer.deserialize(ConfigSerializer.serialize(result.config))
  assert.ok(again.ok, again.error)
  assert.deepEqual(again.config, result.config)
})

test("migration flags Windows paths, shells and run-as-admin, and keeps everything else", () => {
  const result = ConfigSerializer.deserialize(JSON.stringify({
    version: 1,
    settings: { hotkey: "Alt+Space", theme: "dark", defaultShell: "pwsh" },
    root: { id: "root", type: "folder", name: "Root", children: [
      { id: "code", type: "app", name: "VS Code", target: "%LOCALAPPDATA%\\Programs\\Code.exe", runAsAdmin: true,
        icon: { kind: "exe", value: "C:\\x.exe", index: 0 } },
      { id: "docs", type: "path", name: "Docs", target: "C:\\Users\\me\\Documents", icon: { kind: "emoji", value: "📄" } },
      { id: "build", type: "command", name: "Build", command: "npm run build", shell: "cmd", window: "visible", keepOpen: false,
        icon: { kind: "glyph", value: "\uE756" } },
      { id: "quiet", type: "command", name: "Sync", command: "git pull", window: "hidden" },
      { id: "site", type: "url", name: "Site", target: "https://example.com" },
    ] },
  }))
  assert.ok(result.ok, result.error)
  const [code, docs, build, quiet, site] = result.config.root.children

  assert.equal(code.target, "%LOCALAPPDATA%\\Programs\\Code.exe")   // kept, not dropped
  assert.match(code.reviewNote, /Windows program path/)
  assert.match(code.reviewNote, /administrator/)
  assert.equal(code.icon, null)

  assert.match(docs.reviewNote, /Windows path/)
  assert.deepEqual(docs.icon, { kind: "emoji", value: "📄" })

  assert.equal(build.shell, null)
  assert.equal(build.window, "terminal")
  assert.equal(build.keepOpen, false)
  assert.match(build.reviewNote, /Written for cmd/)
  assert.equal(build.icon, null)

  assert.equal(quiet.window, "hidden")
  assert.match(quiet.reviewNote, /PowerShell/)

  assert.equal(site.reviewNote, null)
  assert.deepEqual(result.notes.map(n => n.id), ["code", "docs", "build", "quiet"])
})

test("a version 2 config is never flagged, whatever its paths look like", () => {
  const result = ConfigSerializer.deserialize(JSON.stringify({
    version: 2, root: { children: [{ id: "w", type: "path", name: "Share", target: "\\\\server\\share" }] },
  }))
  assert.equal(result.config.root.children[0].reviewNote, null)
  assert.deepEqual(result.notes, [])
})

test("a reviewNote survives saving until the user clears it", () => {
  const migrated = ConfigSerializer.deserialize('{ "version": 1, "root": { "children": [ { "id": "p", "type": "path", "name": "P", "target": "D:\\\\x" } ] } }')
  const json = ConfigSerializer.serialize(migrated.config)
  assert.ok(json.includes('"reviewNote"'))
  const reloaded = ConfigSerializer.deserialize(json).config.root.children[0]
  assert.equal(reloaded.reviewNote, migrated.config.root.children[0].reviewNote)
  reloaded.reviewNote = null
  assert.ok(!ConfigSerializer.serialize({ settings: Model.defaultSettings(), root: { ...Model.createRoot(), children: [reloaded] } }).includes("reviewNote"))
})

test("the Linux example config loads cleanly", () => {
  const result = ConfigSerializer.deserialize(readFileSync(new URL("../config.example.json", import.meta.url), "utf8"))
  assert.ok(result.ok, result.error)
  assert.deepEqual(result.notes, [])
  assert.ok(result.config.root.children.length > 0)
})

test("collectNotes finds review notes anywhere in the tree, including ones saved earlier", () => {
  const Model = load("Model")
  const ConfigSerializer = load("ConfigSerializer")
  const root = Model.createNode("folder", { id: "root", name: "Root", children: [
    Model.createNode("url", { id: "a", name: "A", reviewNote: "check a" }),
    Model.createNode("folder", { id: "f", name: "F", children: [Model.createNode("path", { id: "b", name: "B", reviewNote: "check b" })] }),
    Model.createNode("url", { id: "c", name: "C" }) ] })
  assert.deepEqual(ConfigSerializer.collectNotes(root), [
    { id: "a", name: "A", message: "check a" }, { id: "b", name: "B", message: "check b" }])
  const reread = ConfigSerializer.deserialize(ConfigSerializer.serialize({ ...Model.createConfig(), root }))
  assert.deepEqual(reread.notes, [])                                  // not a migration…
  assert.equal(ConfigSerializer.collectNotes(reread.config.root).length, 2)   // …but the notes are still there
})

test("a damaged config says where: line and column, with comments not shifting them", () => {
  const Jsonc = load("Jsonc")
  const ConfigSerializer = load("ConfigSerializer")
  const where = text => {
    const p = Jsonc.checkSyntax(Jsonc.strip(text))
    return p && [p.line, p.column, p.message]
  }
  assert.deepEqual(where('{\n  "a": 1\n  "b": 2\n}'), [3, 3, "Expected “,” or “}” but found a quote mark (a missing comma?)"])
  assert.deepEqual(where('{\n  // note, with "quotes"\n  /* block\n  comment */ "a": [1, 2,],\n  "b": tru\n}').slice(0, 2), [5, 8])
  assert.deepEqual(where('{ "path": "C:\\Users\\me" }'), [1, 14, "Invalid escape “\\U” (a Windows path? write \\\\ for each backslash)"])
  assert.deepEqual(where('{ "a": "open\n}').slice(0, 2), [1, 8])
  assert.deepEqual(where('{ "a": 1 } x').slice(0, 2), [1, 12])
  assert.deepEqual(where('{ "a": [1, 2 }').slice(0, 2), [1, 14])
  assert.deepEqual(where('{ a: 1 }').slice(0, 2), [1, 3])
  assert.deepEqual(where('{ "a": 01 }').slice(0, 2), [1, 9])
  assert.deepEqual(where('{ "a": '), [1, 8, "The file ends where a value should be"])
  assert.equal(where('{ "a": [1, 2,], /* x */ "b": { "c": "d\\n" }, }'), null)   // valid once stripped
  const r = ConfigSerializer.deserialize('{\n  "version": 2,\n  "root": { "id": "root" "type": "folder" }\n}')
  assert.equal(r.ok, false)
  assert.match(r.error, /^Invalid JSON: Expected “,” or “}” .*\(line 3, column 26\)$/)
})

test("strip keeps every character's position", () => {
  const Jsonc = load("Jsonc")
  const text = '{ // c\n "a": 1, /* x\n y */ "b": [2,],\n}'
  const stripped = Jsonc.strip(text)
  assert.equal(stripped.length, text.length)
  assert.deepEqual(stripped.split("\n").map(l => l.length), text.split("\n").map(l => l.length))
  assert.deepEqual(JSON.parse(stripped), { a: 1, b: [2] })
})
