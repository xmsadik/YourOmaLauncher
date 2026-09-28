.pragma library

// JSON with comments: comments (// and /* */) and trailing commas outside strings are blanked out,
// then the text goes to JSON.parse. Anything else malformed throws, with a message that says where:
// Qt's V4 engine gives JSON.parse errors no position, so on failure checkSyntax() finds one itself.

// Comments and trailing commas become spaces (newlines are kept), so every character stays at its
// original line and column and error positions match the file the user edits.
function strip(text) {
  var s = String(text)
  var out = ""
  var i = 0
  while (i < s.length) {
    var c = s.charAt(i)
    if (c === "\"") {
      var j = i + 1
      while (j < s.length && s.charAt(j) !== "\"" && s.charAt(j) !== "\n") j += s.charAt(j) === "\\" ? 2 : 1
      out += s.substring(i, j + 1)
      i = j + 1
    } else if (c === "/" && s.charAt(i + 1) === "/") {
      var eol = s.indexOf("\n", i)
      if (eol < 0) eol = s.length
      out += blank(s.substring(i, eol))
      i = eol
    } else if (c === "/" && s.charAt(i + 1) === "*") {
      var end = s.indexOf("*/", i + 2)
      end = end < 0 ? s.length : end + 2
      out += blank(s.substring(i, end))
      i = end
    } else if (c === "," && closesNext(s, i + 1)) {
      out += " "
      i++
    } else {
      out += c
      i++
    }
  }
  return out
}

function blank(s) {
  return s.replace(/[^\n]/g, " ")
}

// Whether the next significant character (skipping space and comments) closes an object or array.
function closesNext(s, k) {
  while (k < s.length) {
    var d = s.charAt(k)
    if (d === " " || d === "\t" || d === "\n" || d === "\r") { k++; continue }
    if (d === "/" && s.charAt(k + 1) === "/") { while (k < s.length && s.charAt(k) !== "\n") k++; continue }
    if (d === "/" && s.charAt(k + 1) === "*") { var e = s.indexOf("*/", k + 2); k = e < 0 ? s.length : e + 2; continue }
    return d === "}" || d === "]"
  }
  return false
}

function parse(text) {
  var stripped = strip(text)
  try {
    return JSON.parse(stripped)
  } catch (e) {
    var problem = checkSyntax(stripped)
    if (problem) throw new Error(problem.message + " (line " + problem.line + ", column " + problem.column + ")")
    throw e
  }
}

// The first syntax error in plain JSON text as { message, line, column } (1-based), or null if the
// text is valid. A small recursive-descent checker; it only runs after JSON.parse has failed.
function checkSyntax(text) {
  var s = String(text)
  var i = 0
  var depth = 0

  function Fail(message, at) { this.message = message; this.at = at }
  function fail(message, at) { throw new Fail(message, at === undefined ? i : at) }

  function shown(c) {
    return c === "\"" ? "a quote mark" : "“" + c + "”"
  }

  function ws() {
    while (i < s.length) {
      var c = s.charAt(i)
      if (c === " " || c === "\t" || c === "\n" || c === "\r") i++
      else break
    }
  }

  function value() {
    ws()
    var c = s.charAt(i)
    if (c === "{") object()
    else if (c === "[") array()
    else if (c === "\"") string()
    else if (c === "-" || (c >= "0" && c <= "9")) number()
    else if (s.substring(i, i + 4) === "true" || s.substring(i, i + 4) === "null") i += 4
    else if (s.substring(i, i + 5) === "false") i += 5
    else fail(i >= s.length ? "The file ends where a value should be" : "Expected a value but found “" + c + "”")
  }

  function object() {
    if (++depth > 512) fail("Nested too deeply")
    i++
    ws()
    if (s.charAt(i) === "}") { i++; depth--; return }
    while (true) {
      ws()
      if (s.charAt(i) !== "\"") fail(i >= s.length ? "The file ends inside an object" : "Expected a property name in double quotes")
      string()
      ws()
      if (s.charAt(i) !== ":") fail("Expected “:” after the property name")
      i++
      value()
      ws()
      var c = s.charAt(i)
      if (c === ",") { i++; continue }
      if (c === "}") { i++; depth--; return }
      fail(i >= s.length ? "The file ends inside an object" : "Expected “,” or “}” but found " + shown(c) + " (a missing comma?)")
    }
  }

  function array() {
    if (++depth > 512) fail("Nested too deeply")
    i++
    ws()
    if (s.charAt(i) === "]") { i++; depth--; return }
    while (true) {
      value()
      ws()
      var c = s.charAt(i)
      if (c === ",") { i++; continue }
      if (c === "]") { i++; depth--; return }
      fail(i >= s.length ? "The file ends inside a list" : "Expected “,” or “]” but found " + shown(c) + " (a missing comma?)")
    }
  }

  function string() {
    var start = i
    i++
    while (i < s.length) {
      var c = s.charAt(i)
      if (c === "\"") { i++; return }
      if (c === "\n") fail("This text is missing its closing quote", start)
      if (c < " ") fail("Control character inside text; write it as an escape like \\t")
      if (c === "\\") {
        var e = s.charAt(i + 1)
        if (e === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(s.substring(i + 2, i + 6))) fail("Invalid \\u escape")
          i += 6
          continue
        }
        if ("\"\\/bfnrt".indexOf(e) < 0 || e === "") fail("Invalid escape “\\" + e + "” (a Windows path? write \\\\ for each backslash)")
        i += 2
        continue
      }
      i++
    }
    fail("This text is missing its closing quote", start)
  }

  function number() {
    var m = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(s.substring(i, i + 400))
    if (!m) fail("Invalid number")
    i += m[0].length
  }

  try {
    value()
    ws()
    if (i < s.length) fail("Unexpected “" + s.charAt(i) + "” after the end of the data")
    return null
  } catch (err) {
    if (!(err instanceof Fail)) throw err
    var before = s.substring(0, err.at)
    var line = before.split("\n").length
    return { message: err.message, line: line, column: err.at - before.lastIndexOf("\n") }
  }
}
