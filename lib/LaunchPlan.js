.pragma library
.import "Model.js" as Model
.import "EnvExpander.js" as EnvExpander

// Turns a node into what to run: { argv: [...], workingDirectory } for Quickshell.execDetached, or
// { error } when the node can't be launched as configured. Pure; nothing is started here.
//
// Everything goes through uwsm-app, like Omarchy's own launchers, so each launch gets its own systemd
// scope instead of living inside omarchy-shell. Commands are passed as argv, never re-quoted into a
// shell string, except a command node's own text, which is the shell script the user wrote.

// Splits an app's "arguments" field into words the way a POSIX shell would, without running one:
// whitespace separates words; '…' is literal; "…" allows \" \\ \$ \` escapes; a backslash outside
// quotes escapes the next character. $VAR, ${VAR} and a leading ~ expand outside single quotes.
// Returns { words } or { error }.
function shellWords(input, env) {
  var s = String(input || "")
  var words = []
  var word = ""
  var inWord = false
  var i = 0

  function expandVar() {
    var rest = s.substring(i)
    var m = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}/.exec(rest) || /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(rest)
    if (!m) { word += "$"; i++; return }
    var value = EnvExpander.lookup(env, m[1])
    word += value !== null ? value : m[0]
    i += m[0].length
  }

  while (i < s.length) {
    var c = s.charAt(i)
    if (c === " " || c === "\t" || c === "\n") {
      if (inWord) { words.push(word); word = ""; inWord = false }
      i++
    } else if (c === "'") {
      var end = s.indexOf("'", i + 1)
      if (end < 0) return { error: "Unclosed ' in arguments." }
      word += s.substring(i + 1, end)
      inWord = true
      i = end + 1
    } else if (c === "\"") {
      inWord = true
      i++
      var closed = false
      while (i < s.length) {
        var d = s.charAt(i)
        if (d === "\"") { closed = true; i++; break }
        if (d === "\\" && "\"\\$`".indexOf(s.charAt(i + 1)) >= 0) { word += s.charAt(i + 1); i += 2 }
        else if (d === "$") expandVar()
        else { word += d; i++ }
      }
      if (!closed) return { error: "Unclosed \" in arguments." }
    } else if (c === "\\") {
      if (i + 1 < s.length) word += s.charAt(i + 1)
      inWord = true
      i += 2
    } else if (c === "$") {
      inWord = true
      expandVar()
    } else if (c === "~" && !inWord && (i + 1 === s.length || s.charAt(i + 1) === "/" || s.charAt(i + 1) === " ")) {
      var home = EnvExpander.lookup(env, "HOME")
      word += home !== null ? home : "~"
      inWord = true
      i++
    } else {
      word += c
      inWord = true
      i++
    }
  }
  if (inWord) words.push(word)
  return { words: words }
}

// node.shell, else settings.defaultShell, else the login shell from $SHELL when it's one we know,
// else bash.
function resolveShell(node, settings, env) {
  if (node && Model.SHELLS.indexOf(node.shell) >= 0) return node.shell
  if (settings && Model.SHELLS.indexOf(settings.defaultShell) >= 0) return settings.defaultShell
  var login = EnvExpander.lookup(env, "SHELL")
  var base = login ? login.substring(login.lastIndexOf("/") + 1) : ""
  return Model.SHELLS.indexOf(base) >= 0 ? base : "bash"
}

function workingDir(value, env) {
  var expanded = EnvExpander.expand(value, env)
  return expanded ? expanded : EnvExpander.lookup(env, "HOME")
}

// Adds https:// to a bare host like "github.com/anthropics".
function normalizeUrl(target) {
  var t = String(target || "").trim()
  if (t.length === 0) return ""
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(t) ? t : "https://" + t
}

function planFor(node, settings, env) {
  if (!Model.isLaunchable(node)) return { error: "This item can't be launched." }

  switch (node.type) {
  case "app": {
    if (node.desktopId) {
      var id = node.desktopId.slice(-8) === ".desktop" ? node.desktopId : node.desktopId + ".desktop"
      return { argv: ["uwsm-app", "--", "gtk-launch", id], workingDirectory: workingDir(node.workingDirectory, env) }
    }
    var program = EnvExpander.expand(node.target, env)
    if (!program || !program.trim()) return { error: "No program set." }
    var args = shellWords(node.arguments, env)
    if (args.error) return { error: args.error }
    return { argv: ["uwsm-app", "--", program].concat(args.words), workingDirectory: workingDir(node.workingDirectory, env) }
  }

  case "path": {
    var path = EnvExpander.expand(node.target, env)
    if (!path || !path.trim()) return { error: "No path set." }
    return { argv: ["uwsm-app", "--", "xdg-open", path], workingDirectory: null }
  }

  case "url": {
    var url = normalizeUrl(EnvExpander.expand(node.target, env))
    if (!url) return { error: "No address set." }
    // http(s) through Omarchy's browser launcher, which also focuses the browser window.
    if (/^https?:/i.test(url)) return { argv: ["omarchy", "launch", "browser", url], workingDirectory: null }
    return { argv: ["uwsm-app", "--", "xdg-open", url], workingDirectory: null }
  }

  case "command": {
    var command = String(node.command || "")
    if (!command.trim()) return { error: "No command set." }
    var shell = resolveShell(node, settings, env)
    var cwd = workingDir(node.workingDirectory, env)
    if (node.window === "hidden")
      return { argv: ["uwsm-app", "--", shell, "-l", "-c", command], workingDirectory: cwd }
    // keepOpen: once the command finishes, replace it with an interactive shell in the same terminal.
    var script = node.keepOpen === false ? command : command + "\nexec " + shell
    return {
      argv: ["uwsm-app", "--", "xdg-terminal-exec", "--title=" + (node.name || command), "-e", shell, "-l", "-c", script],
      workingDirectory: cwd
    }
  }
  }
  return { error: "Unknown item type." }
}
