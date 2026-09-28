import { test } from "node:test"
import assert from "node:assert/strict"
import { load } from "./qmljs.mjs"

const TextNormalizer = load("TextNormalizer")
const FuzzyScorer = load("FuzzyScorer")
const SearchEngine = load("SearchEngine")
const PathTrimmer = load("PathTrimmer")
const Model = load("Model")

// ---- TextNormalizer ----

for (const [input, expected] of [
  ["IZMIR", "izmir"], ["İzmir", "izmir"], ["Şifre", "sifre"], ["ISIK", "isik"],
  ["IŞIK", "isik"], ["ışık", "isik"], ["ÜÖÇĞ", "uocg"],
]) {
  test(`normalize folds Turkish casing and diacritics: ${input}`, () => {
    assert.equal(TextNormalizer.normalize(input), expected)
  })
}

test("normalize preserves length for a mixed string", () => {
  const input = "İzmir'de Şifre Yöneticisi - Çanta.exe"
  assert.equal(TextNormalizer.normalize(input).length, input.length)
})

test("normalize preserves length for characters whose lower case is longer", () => {
  // "İ".toLowerCase() is two code units in JavaScript; the normalizer must not use it.
  assert.equal(TextNormalizer.normalize("İİ").length, 2)
  assert.equal(TextNormalizer.normalize("😀A").length, "😀A".length)
})

test("normalize: empty and already-lower ASCII", () => {
  assert.equal(TextNormalizer.normalize(""), "")
  assert.equal(TextNormalizer.normalize(null), "")
  assert.equal(TextNormalizer.normalize("visual studio code"), "visual studio code")
})

test("compareTurkish follows the Turkish alphabet, case-insensitively", () => {
  const sorted = ["Dosya", "Çanta", "Can", "ılık", "ilik", "Işık", "İlk"].sort(TextNormalizer.compareTurkish)
  assert.deepEqual(sorted, ["Can", "Çanta", "Dosya", "ılık", "Işık", "ilik", "İlk"])
})

test("compareTurkish sorts spaces and digits before letters", () => {
  assert.ok(TextNormalizer.compareTurkish("Can X", "Cana") < 0)
  assert.ok(TextNormalizer.compareTurkish("Build 2", "Build a") < 0)
})

test("sortKey orders exactly like compareTurkish", () => {
  const words = ["Dosya", "Çanta", "Can", "ılık", "ilik", "Işık", "İlk", "Can X", "Cana", "Build 2", "Build a",
    "zebra", "Zürih", "über", "émile", "日本", "", "a", "A", "ş", "Ş", "s", "_x", "9"]
  for (const a of words) for (const b of words) {
    const byCompare = Math.sign(TextNormalizer.compareTurkish(a, b))
    const byKey = Math.sign(TextNormalizer.sortKey(a) < TextNormalizer.sortKey(b) ? -1 : TextNormalizer.sortKey(a) > TextNormalizer.sortKey(b) ? 1 : 0)
    assert.equal(byKey, byCompare, `${a} vs ${b}`)
  }
})

// ---- FuzzyScorer ----

test("exact match is EXACT tier", () => {
  const r = FuzzyScorer.score("code", "code")
  assert.equal(r.tier, FuzzyScorer.EXACT)
  assert.equal(r.score, 1000)
  assert.deepEqual(r.positions, [0, 1, 2, 3])
})

test("prefix match is PREFIX tier", () => {
  const r = FuzzyScorer.score("vsc", "vscode-notes.txt")
  assert.equal(r.tier, FuzzyScorer.PREFIX)
  assert.deepEqual(r.positions, [0, 1, 2])
})

test("word-start acronym is WORD_START tier", () => {
  const r = FuzzyScorer.score("vsc", "visual studio code")
  assert.equal(r.tier, FuzzyScorer.WORD_START)
  assert.deepEqual(r.positions, [0, 7, 14])
})

test("word-start greedy prefix runs match visual studio code", () => {
  const r = FuzzyScorer.score("visco", "visual studio code")
  assert.equal(r.tier, FuzzyScorer.WORD_START)
  assert.deepEqual(r.positions, [0, 1, 2, 14, 15])
})

test("contiguous mid-word occurrence is SUBSTRING tier", () => {
  const r = FuzzyScorer.score("sual", "visual studio")
  assert.equal(r.tier, FuzzyScorer.SUBSTRING)
  assert.deepEqual(r.positions, [2, 3, 4, 5])
})

test("scattered in-order chars are FUZZY tier", () => {
  const r = FuzzyScorer.score("ab", "xaxbx")
  assert.equal(r.tier, FuzzyScorer.FUZZY)
  assert.deepEqual(r.positions, [1, 3])
})

test("no in-order match returns null", () => {
  assert.equal(FuzzyScorer.score("ba", "ab"), null)
})

test("tiers are ordered exact > prefix > word start > substring > fuzzy", () => {
  const exact = FuzzyScorer.score("code", "code")
  const prefix = FuzzyScorer.score("cod", "code review")
  const wordStart = FuzzyScorer.score("vsc", "visual studio code")
  const substring = FuzzyScorer.score("sual", "visual studio")
  const fuzzy = FuzzyScorer.score("ab", "xaxbx")
  assert.ok(exact.score > prefix.score)
  assert.ok(prefix.score > wordStart.score)
  assert.ok(wordStart.score > substring.score)
  assert.ok(substring.score > fuzzy.score)
})

test("vsc: prefix beats word start, word start beats scattered", () => {
  const prefixHit = FuzzyScorer.score("vsc", "vscode-notes.txt")
  const wordStartHit = FuzzyScorer.score("vsc", "visual studio code")
  const fuzzyHit = FuzzyScorer.score("vsc", "visual basic")
  assert.ok(prefixHit.score > wordStartHit.score)
  assert.ok(wordStartHit.score > fuzzyHit.score)
})

test("multi-token query needs every token", () => {
  assert.equal(FuzzyScorer.score("sap dev", "sap dev system").tier, FuzzyScorer.WORD_START)
  assert.equal(FuzzyScorer.score("sap nope", "sap dev system"), null)
})

test("camelCase word starts from the original casing", () => {
  const original = "VsCodeInsiders"
  const r = FuzzyScorer.score("vci", TextNormalizer.normalize(original), FuzzyScorer.computeWordStarts(original))
  assert.equal(r.tier, FuzzyScorer.WORD_START)
})

test("rapor finds the word start in Haftalık Rapor", () => {
  const r = FuzzyScorer.score("rapor", TextNormalizer.normalize("Haftalık Rapor"))
  assert.equal(r.tier, FuzzyScorer.WORD_START)
  assert.deepEqual(r.positions, [9, 10, 11, 12, 13])
})

// ---- SearchEngine ----

const root = (...children) => Model.createNode("folder", { id: "root", name: "Root", children })
const app = (id, name, extra) => Model.createNode("app", { id, name, target: "/usr/bin/x", ...extra })
const folder = (id, name, ...children) => Model.createNode("folder", { id, name, children })
const run = (tree, query, usage) => SearchEngine.search(SearchEngine.buildIndex(tree), query, usage)

test("sifre finds Şifre Yöneticisi", () => {
  const results = run(root(app("1", "Şifre Yöneticisi")), "sifre")
  assert.equal(results.length, 1)
  assert.equal(results[0].node.name, "Şifre Yöneticisi")
})

test("IZMIR finds İzmir", () => {
  const results = run(root(Model.createNode("path", { id: "1", name: "İzmir", target: "~/İzmir" })), "IZMIR")
  assert.equal(results.length, 1)
})

test("rapor finds Haftalık Rapor with positions over the rapor chars", () => {
  const results = run(root(Model.createNode("path", { id: "1", name: "Haftalık Rapor", target: "x.ods" })), "rapor")
  assert.equal(results[0].matchedField, "name")
  assert.deepEqual(results[0].namePositions, [9, 10, 11, 12, 13])
})

test("vsc ranks vscode-notes above Visual Studio Code above Visual Basic", () => {
  const results = run(root(
    app("basic", "Visual Basic"),
    app("vscode", "Visual Studio Code"),
    Model.createNode("path", { id: "notes", name: "vscode-notes.txt", target: "notes.txt" })), "vsc")
  assert.deepEqual(results.map(r => r.node.id), ["notes", "vscode", "basic"])
})

test("a name match beats a same-tier keyword match", () => {
  const results = run(root(app("by-keyword", "Bar", { keywords: ["foo"] }), app("by-name", "Foo")), "foo")
  assert.deepEqual(results.map(r => [r.node.id, r.matchedField]), [["by-name", "name"], ["by-keyword", "keywords"]])
})

test("a keyword-only match has no name positions", () => {
  const results = run(root(app("1", "Bar", { keywords: ["foo"] })), "foo")
  assert.equal(results[0].matchedField, "keywords")
  assert.deepEqual(results[0].namePositions, [])
})

test("description and command text are searched too", () => {
  const tree = root(
    app("d", "Alpha", { description: "weekly backup" }),
    Model.createNode("command", { id: "c", name: "Beta", command: "rsync -a ~/src backup:" }))
  const results = run(tree, "backup")
  assert.deepEqual(results.map(r => [r.node.id, r.matchedField]), [["d", "description"], ["c", "command"]])
})

test("tie break: usage beats depth beats alphabetical", () => {
  const tree = root(app("shallow", "Test"), folder("folder", "Sub", app("deep", "Test")))
  const index = SearchEngine.buildIndex(tree)
  assert.deepEqual(SearchEngine.search(index, "test").map(r => r.node.id), ["shallow", "deep"])
  const favorDeep = id => (id === "deep" ? 100 : 0)
  assert.deepEqual(SearchEngine.search(index, "test", favorDeep).map(r => r.node.id), ["deep", "shallow"])
})

test("usage can be passed as a { nodeId: score } map", () => {
  const tree = root(app("shallow", "Test"), folder("folder", "Sub", app("deep", "Test")))
  assert.deepEqual(run(tree, "test", { deep: 3 }).map(r => r.node.id), ["deep", "shallow"])
})

test("tie break: alphabetical uses Turkish order", () => {
  const tree = root(
    app("dosya", "Dosya", { keywords: ["x"] }),
    app("canta", "Çanta", { keywords: ["x"] }),
    app("can", "Can", { keywords: ["x"] }))
  assert.deepEqual(run(tree, "x").map(r => r.node.id), ["can", "canta", "dosya"])
})

test("multi-token query matches SAP Dev System", () => {
  const results = run(root(folder("1", "SAP Dev System"), app("2", "Unrelated")), "sap dev")
  assert.deepEqual(results.map(r => r.node.id), ["1"])
})

test("a third-level node is found from the root, with a two-level breadcrumb", () => {
  const tree = root(folder("a", "A", folder("b", "B", app("target", "Deep Target"))))
  const results = run(tree, "deep target")
  assert.equal(results.length, 1)
  assert.equal(results[0].breadcrumb, "A › B")
  assert.equal(results[0].depth, 2)
  assert.deepEqual(results[0].parentChain.map(f => f.id), ["root", "a", "b"])
})

test("an empty query returns nothing", () => {
  assert.deepEqual(run(root(app("1", "Anything")), "   "), [])
})

test("the index excludes separators", () => {
  const tree = root(
    app("1", "Anything"),
    Model.createNode("separator", { id: "sep" }),
    folder("f", "F", Model.createNode("separator", { id: "sep2" })))
  assert.deepEqual(SearchEngine.buildIndex(tree).map(e => e.node.id), ["1", "f"])
})

test("multi-token highlight positions are the sorted union", () => {
  const results = run(root(app("1", "SAP Dev System")), "dev sap")
  assert.deepEqual(results[0].namePositions, [0, 1, 2, 4, 5, 6])
})

test("limit caps the result count", () => {
  const tree = root(...Array.from({ length: 80 }, (_, i) => app("n" + i, "Note " + i)))
  assert.equal(run(tree, "note").length, 50)
  assert.equal(SearchEngine.search(SearchEngine.buildIndex(tree), "note", null, 5).length, 5)
})

// ---- PathTrimmer ----

const measure = s => s.length

test("trimStart: fits unchanged", () => {
  assert.equal(PathTrimmer.trimStart("A › B", 5, measure), "A › B")
})

test("trimStart: drops leading segments first", () => {
  const path = "Chrome bookmarks › Bookmarks bar › Work › Müşteri"
  assert.equal(PathTrimmer.trimStart(path, 18, measure), "… › Work › Müşteri")
  assert.equal(PathTrimmer.trimStart(path, 17, measure), "… › Müşteri")
})

test("trimStart: keeps the tail of a too-wide last segment", () => {
  assert.equal(PathTrimmer.trimStart("abc › abcdefghij", 5, measure), "…ghij")
  assert.equal(PathTrimmer.trimStart("0123456789", 5, measure), "…6789")
})

test("trimStart: no room, or empty input", () => {
  assert.equal(PathTrimmer.trimStart("abc", 0, measure), "")
  assert.equal(PathTrimmer.trimStart("", 10, measure), "")
})
