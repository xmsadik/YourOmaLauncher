.pragma library

// Suggests a display name for a target the user typed or picked, so the editor can pre-fill Name.
// Order: an existing directory → its name; an existing file → file name without extension; a URL
// (with or without a scheme) → its host; anything path-shaped → file name without extension; otherwise
// the text itself.
//
// probe(path) → "dir" | "file" | null is injected: QML has no synchronous stat, so the editor passes
// what it already knows (e.g. from the file picker), and tests pass a stub.

function lastSegment(path) {
  var trimmed = path.replace(/[\/\\]+$/, "")
  var cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
  return cut >= 0 ? trimmed.substring(cut + 1) : trimmed
}

function withoutExtension(name) {
  var dot = name.lastIndexOf(".")
  return dot > 0 ? name.substring(0, dot) : name
}

function looksLikePath(value) {
  return value.charAt(0) === "/" || value.indexOf("~/") === 0 || value.indexOf("./") === 0 ||
    value.indexOf("../") === 0 || value.indexOf("\\") >= 0 || /^[A-Za-z]:/.test(value)
}

function urlHost(value) {
  var m = /^(?:https?|ftp):\/\/([^\/:?#\s]+)/i.exec(value)
  if (m) return m[1]
  if (looksLikePath(value)) return null
  // A bare host typed without a scheme: "github.com" or "github.com/anthropics".
  m = /^([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)(?::\d+)?(?:[\/?#].*)?$/.exec(value)
  return m ? m[1] : null
}

function suggestName(target, probe) {
  if (target === null || target === undefined) return ""
  var trimmed = String(target).trim()
  if (trimmed.length === 0) return ""

  var kind = probe ? probe(trimmed) : null
  if (kind === "dir") return lastSegment(trimmed) || trimmed
  if (kind === "file") return withoutExtension(lastSegment(trimmed)) || trimmed

  var host = urlHost(trimmed)
  if (host) return host
  if (looksLikePath(trimmed)) return withoutExtension(lastSegment(trimmed)) || trimmed
  return trimmed
}
