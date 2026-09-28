import { test } from "node:test"
import assert from "node:assert/strict"
import { load } from "./qmljs.mjs"

const Model = load("Model")
const LaunchPlan = load("LaunchPlan")
const EnvExpander = load("EnvExpander")
const TargetName = load("TargetName")

const ENV = { HOME: "/home/u", SHELL: "/usr/bin/zsh", PROJ: "/home/u/Work/proj", SPACED: "/home/u/My Files" }
const settings = Model.defaultSettings()
const plan = (type, fields, s = settings, env = ENV) => LaunchPlan.planFor(Model.createNode(type, fields), s, env)

// ---- EnvExpander ----

test("expand: ~, $VAR and ${VAR}", () => {
  assert.equal(EnvExpander.expand("~", ENV), "/home/u")
  assert.equal(EnvExpander.expand("~/Documents", ENV), "/home/u/Documents")
  assert.equal(EnvExpander.expand("$PROJ/src", ENV), "/home/u/Work/proj/src")
  assert.equal(EnvExpander.expand("${PROJ}_old", ENV), "/home/u/Work/proj_old")
})

test("expand leaves unknown variables, mid-string ~ and escaped $ as written", () => {
  assert.equal(EnvExpander.expand("$NOPE/x", ENV), "$NOPE/x")
  assert.equal(EnvExpander.expand("a~/b", ENV), "a~/b")
  assert.equal(EnvExpander.expand("~user/x", ENV), "~user/x")
  assert.equal(EnvExpander.expand("price \\$5 $", ENV), "price $5 $")
  assert.equal(EnvExpander.expand(null, ENV), null)
})

// ---- shellWords ----

for (const [input, words] of [
  ["", []],
  ["  a   b  ", ["a", "b"]],
  ["--file 'my notes.md'", ["--file", "my notes.md"]],
  ['--title "He said \\"hi\\""', ["--title", 'He said "hi"']],
  ["one\\ word", ["one word"]],
  ["'$HOME' \"$HOME\" $HOME ~ ~/x", ["$HOME", "/home/u", "/home/u", "/home/u", "/home/u/x"]],
  ['"$SPACED"', ["/home/u/My Files"]],
  ["a''b \"\"", ["ab", ""]],
  ["--flag=&& ; |", ["--flag=&&", ";", "|"]],       // no shell: operators are just words
]) {
  test(`shellWords(${JSON.stringify(input)})`, () => {
    assert.deepEqual(LaunchPlan.shellWords(input, ENV), { words })
  })
}

test("shellWords reports unclosed quotes", () => {
  assert.match(LaunchPlan.shellWords("'open", ENV).error, /Unclosed '/)
  assert.match(LaunchPlan.shellWords('"open', ENV).error, /Unclosed "/)
})

// ---- resolveShell ----

test("resolveShell: node, then settings, then $SHELL, then bash", () => {
  const node = Model.createNode("command", { command: "x" })
  assert.equal(LaunchPlan.resolveShell({ ...node, shell: "fish" }, { defaultShell: "bash" }, ENV), "fish")
  assert.equal(LaunchPlan.resolveShell(node, { defaultShell: "bash" }, ENV), "bash")
  assert.equal(LaunchPlan.resolveShell(node, settings, ENV), "zsh")
  assert.equal(LaunchPlan.resolveShell(node, settings, { SHELL: "/usr/bin/nu" }), "bash")
  assert.equal(LaunchPlan.resolveShell(node, settings, {}), "bash")
})

// ---- planFor ----

test("app with a desktop id launches through gtk-launch", () => {
  assert.deepEqual(plan("app", { desktopId: "org.gnome.Nautilus" }).argv, ["uwsm-app", "--", "gtk-launch", "org.gnome.Nautilus.desktop"])
  assert.deepEqual(plan("app", { desktopId: "firefox.desktop" }).argv, ["uwsm-app", "--", "gtk-launch", "firefox.desktop"])
})

test("app with a program runs it directly with split, expanded arguments", () => {
  const p = plan("app", { target: "~/bin/tool", arguments: "--in '$PROJ' --out \"$PROJ/out\"", workingDirectory: "$PROJ" })
  assert.deepEqual(p.argv, ["uwsm-app", "--", "/home/u/bin/tool", "--in", "$PROJ", "--out", "/home/u/Work/proj/out"])
  assert.equal(p.workingDirectory, "/home/u/Work/proj")
})

test("app without a working directory starts in $HOME", () => {
  assert.equal(plan("app", { target: "gimp" }).workingDirectory, "/home/u")
})

test("app errors: no program, bad arguments", () => {
  assert.match(plan("app", { target: "  " }).error, /No program/)
  assert.match(plan("app", { target: "x", arguments: "'oops" }).error, /Unclosed/)
})

test("path opens with xdg-open, expanded but not split", () => {
  assert.deepEqual(plan("path", { target: "$SPACED/report.ods" }).argv, ["uwsm-app", "--", "xdg-open", "/home/u/My Files/report.ods"])
  assert.match(plan("path", { target: "" }).error, /No path/)
})

test("http(s) urls go through Omarchy's browser launcher; a bare host gets https://", () => {
  assert.deepEqual(plan("url", { target: "https://example.com/a?b=c" }).argv, ["omarchy", "launch", "browser", "https://example.com/a?b=c"])
  assert.deepEqual(plan("url", { target: "github.com/anthropics" }).argv, ["omarchy", "launch", "browser", "https://github.com/anthropics"])
})

test("other url schemes go to xdg-open", () => {
  assert.deepEqual(plan("url", { target: "mailto:me@example.com" }).argv, ["uwsm-app", "--", "xdg-open", "mailto:me@example.com"])
  assert.match(plan("url", { target: " " }).error, /No address/)
})

test("terminal command that stays open ends in an interactive shell", () => {
  const p = plan("command", { name: "Build", command: "git pull && npm run build", workingDirectory: "~/Work" })
  assert.deepEqual(p.argv, ["uwsm-app", "--", "xdg-terminal-exec", "--title=Build", "-e", "zsh", "-l", "-c",
    "git pull && npm run build\nexec zsh"])
  assert.equal(p.workingDirectory, "/home/u/Work")
})

test("terminal command that closes runs the script as written", () => {
  const p = plan("command", { name: "Top", command: "htop", keepOpen: false, shell: "bash" })
  assert.deepEqual(p.argv.slice(-4), ["bash", "-l", "-c", "htop"])
})

test("the command text is passed through untouched: quotes, $, &&, newlines", () => {
  const command = "echo \"$HOME\" 'single' && printf '%s\\n' a\nls ~"
  const p = plan("command", { command, keepOpen: false, window: "hidden" })
  assert.deepEqual(p.argv, ["uwsm-app", "--", "zsh", "-l", "-c", command])
})

test("a hidden command never opens a terminal and ignores keepOpen", () => {
  const p = plan("command", { command: "sync", window: "hidden", keepOpen: true })
  assert.ok(!p.argv.includes("xdg-terminal-exec"))
  assert.equal(p.argv[p.argv.length - 1], "sync")
})

test("command without a name uses the command as the window title", () => {
  assert.ok(plan("command", { command: "btop" }).argv.includes("--title=btop"))
})

test("commands use settings.defaultShell when the node has none", () => {
  const p = plan("command", { command: "x", window: "hidden" }, { ...settings, defaultShell: "fish" })
  assert.equal(p.argv[2], "fish")
})

test("folders, separators and empty commands can't be launched", () => {
  assert.ok(plan("folder", {}).error)
  assert.ok(plan("separator", {}).error)
  assert.match(plan("command", { command: "  " }).error, /No command/)
})

// ---- TargetName ----

const probe = map => p => map[p] || null

test("suggestName: empty or whitespace → empty", () => {
  assert.equal(TargetName.suggestName("", null), "")
  assert.equal(TargetName.suggestName("   ", null), "")
  assert.equal(TargetName.suggestName(null, null), "")
})

test("suggestName: existing directory → its name, trailing slash or not", () => {
  const p = probe({ "/home/u/Projects": "dir", "/home/u/Projects/": "dir" })
  assert.equal(TargetName.suggestName("/home/u/Projects", p), "Projects")
  assert.equal(TargetName.suggestName("/home/u/Projects/", p), "Projects")
})

test("suggestName: existing file → name without extension; dotfiles keep their name", () => {
  const p = probe({ "/home/u/report.final.ods": "file", "/home/u/.bashrc": "file" })
  assert.equal(TargetName.suggestName("/home/u/report.final.ods", p), "report.final")
  assert.equal(TargetName.suggestName("/home/u/.bashrc", p), ".bashrc")
})

test("suggestName: urls → host", () => {
  assert.equal(TargetName.suggestName("https://www.anthropic.com/news", null), "www.anthropic.com")
  assert.equal(TargetName.suggestName("http://localhost:3000/x", null), "localhost")
  assert.equal(TargetName.suggestName("github.com/anthropics", null), "github.com")
})

test("suggestName: path-shaped but not on disk → file name without extension", () => {
  assert.equal(TargetName.suggestName("~/Documents/Notes.md", null), "Notes")
  assert.equal(TargetName.suggestName("C:\\Tools\\thing.exe", null), "thing")
  assert.equal(TargetName.suggestName("\\\\server\\share\\doc.txt", null), "doc")
})

test("suggestName: plain text → the text itself", () => {
  assert.equal(TargetName.suggestName("  gimp  ", null), "gimp")
  assert.equal(TargetName.suggestName("My Thing", null), "My Thing")
})
