// Guard for the spec's "< 16 ms per keystroke even at 5,000 nodes" search budget. Node's JIT is faster
// than QML's V4 engine, so this bounds the algorithm, not the in-shell timing; tests/qml checks V4.
import { test } from "node:test"
import assert from "node:assert/strict"
import { load } from "./qmljs.mjs"

const Model = load("Model")
const SearchEngine = load("SearchEngine")

const NAMES = [
  "Visual Studio Code", "Şifre Yöneticisi", "Haftalık Rapor", "SAP Dev System", "Build & Deploy",
  "Notepad", "Documents", "Downloads", "Anthropic", "Google Chrome", "Slack", "Microsoft Teams",
  "Excel Rapor", "İzmir Şube", "Ankara Ofis", "Configuration", "Backup Script", "Database Client",
  "Docker Desktop", "Git Bash", "PowerShell", "Windows Terminal", "Outlook", "OneNote", "Calculator",
  "Paint", "Task Manager", "Control Panel", "Network Settings", "VPN Client", "Şubeler", "Işık Ayarları",
]
export const QUERIES = [
  "a", "vs", "sap", "rapor", "izmir", "docker", "notepad", "şube", "isik", "build",
  "sd", "gd", "vsc", "ofis", "excel", "sap dev", "git bash", "control", "conf", "z",
]

// Small deterministic PRNG so every run builds the same tree.
function rng(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

export function buildTree(total, seed) {
  const random = rng(seed)
  const root = Model.createRoot()
  const folders = [root]
  for (let id = 1; id <= total; id++) {
    const parent = folders[Math.floor(random() * folders.length)]
    const name = `${NAMES[Math.floor(random() * NAMES.length)]} ${id}`
    if (folders.length < total / 4 && random() < 0.25) {
      const folder = Model.createNode("folder", { id: "f" + id, name })
      parent.children.push(folder)
      folders.push(folder)
    } else {
      const type = ["app", "path", "command", "url"][id % 4]
      parent.children.push(Model.createNode(type, { id: "n" + id, name, target: "/x", command: "echo hi" }))
    }
  }
  return root
}

test("search over 5,000 nodes: median under 16 ms", () => {
  const index = SearchEngine.buildIndex(buildTree(5000, 42))
  assert.equal(index.length, 5000)
  for (const q of QUERIES) SearchEngine.search(index, q)   // warm up
  const timings = QUERIES.map(q => {
    const start = performance.now()
    SearchEngine.search(index, q)
    return performance.now() - start
  }).sort((a, b) => a - b)
  const median = timings[Math.floor(timings.length / 2)]
  assert.ok(median < 16, `median ${median.toFixed(2)} ms`)
})

// The fast path (prefilter, top-K, positions only for the kept hits) must rank exactly like scoring
// every node and fully sorting, as the Windows app did.
const TextNormalizer = load("TextNormalizer")
const FuzzyScorer = load("FuzzyScorer")

function referenceSearch(root, query, usage, limit) {
  const q = TextNormalizer.normalize(query).trim()
  const hits = []
  let order = 0
  ;(function walk(folder, depth) {
    for (const node of folder.children) {
      if (node.type === "separator") continue
      const fields = [["name", 10, TextNormalizer.normalize(node.name), FuzzyScorer.computeWordStarts(node.name)]]
      for (const k of node.keywords || []) fields.push(["keywords", 8, TextNormalizer.normalize(k)])
      if (node.description) fields.push(["description", 6, TextNormalizer.normalize(node.description)])
      if (node.type === "command" && node.command) fields.push(["command", 5, TextNormalizer.normalize(node.command)])
      let best = null
      for (const [kind, weight, text, ws] of fields) {
        const m = FuzzyScorer.score(q, text, ws)
        if (m && (!best || Math.floor(m.score * weight / 10) > best.weighted))
          best = { kind, weighted: Math.floor(m.score * weight / 10), positions: m.positions }
      }
      if (best) hits.push({ node, depth, order, ...best })
      order++
      if (node.type === "folder") walk(node, depth + 1)
    }
  })(root, 0)
  hits.sort((a, b) => (b.weighted - a.weighted) || ((usage[b.node.id] || 0) - (usage[a.node.id] || 0)) ||
    (a.depth - b.depth) || TextNormalizer.compareTurkish(a.node.name, b.node.name) || (a.order - b.order))
  return hits.slice(0, limit).map(h => [h.node.id, h.weighted, h.kind, h.kind === "name" ? h.positions : []])
}

test("fast search ranks exactly like a full score-and-sort", () => {
  const tree = buildTree(2000, 7)
  // Give some nodes keywords, descriptions and usage so every tie-breaker gets exercised.
  const usage = {}
  let n = 0
  ;(function decorate(folder) {
    for (const node of folder.children) {
      n++
      if (n % 3 === 0) node.keywords = ["daily", "tool"]
      if (n % 5 === 0) node.description = "Opens the weekly report"
      if (n % 7 === 0) usage[node.id] = n % 4
      if (node.type === "folder") decorate(node)
    }
  })(tree)
  const index = SearchEngine.buildIndex(tree)
  for (const q of [...QUERIES, "daily", "weekly rep", "echo", "d t", "ş", "i̇"]) {
    const fast = SearchEngine.search(index, q, usage).map(r => [r.node.id, r.score, r.matchedField, r.namePositions])
    assert.deepEqual(fast, referenceSearch(tree, q, usage, 50), `query "${q}"`)
  }
})
