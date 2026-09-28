// Loads a QML JavaScript library (lib/*.js) under Node, the way QML would: ".pragma library" is
// dropped, each '.import "X.js" as Name' is loaded recursively and handed in as `Name`, and every
// top-level function and var is exported. Evaluated in the main realm so arrays and objects compare
// normally with node:assert.
import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const LIB = resolve(dirname(fileURLToPath(import.meta.url)), "../lib")
const cache = new Map()

export function load(name) {
  const path = join(LIB, name.endsWith(".js") ? name : name + ".js")
  if (cache.has(path)) return cache.get(path)

  const source = readFileSync(path, "utf8")
  const deps = []
  // Keep line numbers intact: directive lines become blank lines.
  const body = source.split("\n").map(line => {
    const imp = /^\.import\s+"([^"]+)"\s+as\s+(\w+)\s*$/.exec(line)
    if (imp) { deps.push({ file: imp[1], as: imp[2] }); return "" }
    return /^\.pragma\s/.test(line) ? "" : line
  }).join("\n")

  const exported = new Set()
  for (const m of body.matchAll(/^(?:function\s+(\w+)|var\s+(\w+))/gm)) exported.add(m[1] || m[2])

  const factory = new Function(...deps.map(d => d.as),
    `${body}\n;return { ${[...exported].join(", ")} }\n//# sourceURL=${path}`)
  const lib = factory(...deps.map(d => load(join(dirname(path), d.file).slice(LIB.length + 1))))
  cache.set(path, lib)
  return lib
}
