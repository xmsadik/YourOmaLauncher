import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { load } from "./qmljs.mjs"

const Model = load("Model")
const Listing = load("Listing")
const LaunchPlan = load("LaunchPlan")

const n = (type, id, extra) => Model.createNode(type, { id, name: id, ...extra })

// ---- rows ----

test("folderRows lists folders first, each group in stored order, separators with the items", () => {
  const folder = n("folder", "root", { children: [
    n("url", "u1"), n("folder", "f1"), n("separator", "s"), n("command", "c1", { command: "x" }), n("folder", "f2"),
  ] })
  const rows = Listing.folderRows(folder)
  assert.deepEqual(rows.map(r => r.node.id), ["f1", "f2", "u1", "s", "c1"])
  assert.deepEqual(rows.map(r => r.separator), [false, false, false, true, false])
})

test("secondary text: folder counts (no separators), command first line, else description", () => {
  const folder = n("folder", "f", { children: [n("url", "a"), n("separator", "s")] })
  assert.equal(Listing.secondaryText(folder), "1 item")
  assert.equal(Listing.secondaryText(n("folder", "e")), "0 items")
  assert.equal(Listing.secondaryText(n("command", "c", { command: "make\nmake install" })), "make")
  assert.equal(Listing.secondaryText(n("url", "u", { description: "Docs" })), "Docs")
  assert.equal(Listing.secondaryText(n("path", "p")), "")
})

test("search rows carry the breadcrumb and highlight positions", () => {
  const node = n("url", "Rapor")
  const rows = Listing.resultRows([{ node, namePositions: [0, 1], breadcrumb: "Work › Reports" }])
  assert.equal(rows[0].secondary, "Work › Reports")
  assert.deepEqual(rows[0].positions, [0, 1])
})

test("rows carry review notes", () => {
  const rows = Listing.folderRows(n("folder", "r", { children: [n("path", "p", { reviewNote: "Windows path" })] }))
  assert.equal(rows[0].reviewNote, "Windows path")
})

// ---- selection ----

const rowsOf = pattern => pattern.split("").map(c => ({ separator: c === "-", node: {} }))

test("step with wrap skips separators and wraps at both ends", () => {
  const rows = rowsOf("a-b-c")   // selectable: 0, 2, 4
  assert.equal(Listing.step(rows, 0, 1, true), 2)
  assert.equal(Listing.step(rows, 4, 1, true), 0)
  assert.equal(Listing.step(rows, 0, -1, true), 4)
})

test("step without wrap clamps and steps off a separator", () => {
  const rows = rowsOf("ab-cdef-")
  assert.equal(Listing.step(rows, 0, 2, false), 3)    // lands on "-" at 2 → continues to 3
  assert.equal(Listing.step(rows, 1, 100, false), 6)  // clamps to 7 (a separator) → back to 6
  assert.equal(Listing.step(rows, 6, -100, false), 0)
})

test("step from no selection starts at the first or last selectable row", () => {
  const rows = rowsOf("-ab-")
  assert.equal(Listing.step(rows, -1, 1, true), 1)
  assert.equal(Listing.step(rows, -1, -1, true), 2)
  assert.equal(Listing.step(rowsOf("--"), 0, 1, true), -1)
  assert.equal(Listing.step([], -1, 1, true), -1)
})

// ---- highlight / breadcrumb ----

test("highlight wraps matched runs and escapes markup", () => {
  assert.equal(Listing.highlight("R&D <tools>", [0, 2], "#f00"),
    '<b><font color="#f00">R</font></b>&amp;<b><font color="#f00">D</font></b> &lt;tools&gt;')
  assert.equal(Listing.highlight("abc", [0, 1, 2], "#0f0"), '<b><font color="#0f0">abc</font></b>')
  assert.equal(Listing.highlight("a<b", [], "#0f0"), "a&lt;b")
})

test("header breadcrumb leaves out the root", () => {
  const root = n("folder", "Root"), dev = n("folder", "Dev"), tools = n("folder", "Tools")
  assert.equal(Listing.breadcrumb([root]), "")
  assert.equal(Listing.breadcrumb([root, dev, tools]), "Dev › Tools")
})

// ---- the launch wrapper, run for real ----

// A scratch dir with a stub `omarchy` that records notifications, and a stub `uwsm-app` that runs its
// command, so the wrapper runs end to end without launching anything.
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "yol-"))
  const bin = join(dir, "bin")
  execFileSync("mkdir", ["-p", bin])
  writeFileSync(join(bin, "omarchy"), `#!/bin/bash\nprintf '%s\\n' "$@" > "${dir}/notified"\n`)
  writeFileSync(join(bin, "uwsm-app"), `#!/bin/bash\n[ "$1" = "--" ] && shift\nexec "$@"\n`)
  chmodSync(join(bin, "omarchy"), 0o755)
  chmodSync(join(bin, "uwsm-app"), 0o755)
  return { dir, env: { PATH: `${bin}:/usr/bin:/bin`, HOME: dir } }
}

// The real wrapper uses a login shell (-l) for the user's PATH; tests use -c so the stub PATH stays.
function runWrapper(plan, box) {
  const argv = LaunchPlan.execArgv(plan)
  assert.deepEqual(argv.slice(0, 2), ["bash", "-lc"])
  try {
    return { status: 0, out: execFileSync("bash", ["-c", ...argv.slice(2)], { env: box.env, encoding: "utf8" }) }
  } catch (e) {
    return { status: e.status, out: e.stdout }
  }
}

test("wrapper runs the command in the working directory", () => {
  const box = sandbox()
  const r = runWrapper({ argv: ["uwsm-app", "--", "pwd"], workingDirectory: "/tmp" }, box)
  assert.equal(r.out.trim(), realpathSync("/tmp"))
})

test("wrapper falls back to $HOME when the working directory is missing or empty", () => {
  const box = sandbox()
  assert.equal(runWrapper({ argv: ["pwd"], workingDirectory: "/no/such/dir" }, box).out.trim(), realpathSync(box.dir))
  assert.equal(runWrapper({ argv: ["pwd"], workingDirectory: null }, box).out.trim(), realpathSync(box.dir))
})

test("wrapper passes arguments through literally", () => {
  const box = sandbox()
  const tricky = ["$(touch pwned)", "a b", "'q'", "--", "-rf", "$HOME", "x;y", "*"]
  const r = runWrapper({ argv: ["printf", "%s\\n", ...tricky], workingDirectory: box.dir }, box)
  assert.deepEqual(r.out.trimEnd().split("\n"), tricky)
  assert.ok(!existsSync(join(box.dir, "pwned")))
})

test("wrapper notifies and stops when a program isn't found", () => {
  const box = sandbox()
  const r = runWrapper({ argv: ["uwsm-app", "--", "no-such-program-xyz"], workingDirectory: null,
    check: { kind: "program", value: "no-such-program-xyz" } }, box)
  assert.equal(r.status, 127)
  const notified = readFileSync(join(box.dir, "notified"), "utf8").split("\n")
  assert.deepEqual(notified.slice(0, 2), ["notification", "send"])
  assert.ok(notified.includes("Couldn't launch"))
  assert.ok(notified.includes("Program not found: no-such-program-xyz"))
})

test("wrapper notifies when a path doesn't exist, and runs when it does", () => {
  const box = sandbox()
  const missing = runWrapper({ argv: ["true"], check: { kind: "path", value: "/no/such/file" } }, box)
  assert.equal(missing.status, 127)
  assert.ok(readFileSync(join(box.dir, "notified"), "utf8").includes("Not found: /no/such/file"))
  const ok = runWrapper({ argv: ["echo", "opened"], check: { kind: "path", value: box.dir } }, box)
  assert.equal(ok.out.trim(), "opened")
})

test("app and path plans carry an existence check; commands and urls don't", () => {
  const env = { HOME: "/home/u" }
  const s = Model.defaultSettings()
  assert.deepEqual(LaunchPlan.planFor(n("app", "a", { target: "~/bin/tool" }), s, env).check, { kind: "program", value: "/home/u/bin/tool" })
  assert.deepEqual(LaunchPlan.planFor(n("path", "p", { target: "~/x" }), s, env).check, { kind: "path", value: "/home/u/x" })
  assert.equal(LaunchPlan.planFor(n("command", "c", { command: "ls" }), s, env).check, undefined)
  assert.equal(LaunchPlan.planFor(n("url", "u", { target: "x.com" }), s, env).check, undefined)
  assert.equal(LaunchPlan.planFor(n("app", "d", { desktopId: "firefox" }), s, env).check, undefined)
})
