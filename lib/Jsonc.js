.pragma library

// JSON with comments: strips // and /* */ comments and trailing commas (outside strings), then
// JSON.parse. Throws on anything else malformed, same as JSON.parse.

function strip(text) {
  var s = String(text)
  var out = ""
  var i = 0
  while (i < s.length) {
    var c = s.charAt(i)
    if (c === "\"") {
      var j = i + 1
      while (j < s.length && s.charAt(j) !== "\"") j += s.charAt(j) === "\\" ? 2 : 1
      out += s.substring(i, j + 1)
      i = j + 1
    } else if (c === "/" && s.charAt(i + 1) === "/") {
      while (i < s.length && s.charAt(i) !== "\n") i++
    } else if (c === "/" && s.charAt(i + 1) === "*") {
      var end = s.indexOf("*/", i + 2)
      i = end < 0 ? s.length : end + 2
    } else if (c === ",") {
      // Drop the comma if the next significant character closes an object or array.
      var k = i + 1
      while (k < s.length) {
        var d = s.charAt(k)
        if (d === " " || d === "\t" || d === "\n" || d === "\r") { k++; continue }
        if (d === "/" && s.charAt(k + 1) === "/") { while (k < s.length && s.charAt(k) !== "\n") k++; continue }
        if (d === "/" && s.charAt(k + 1) === "*") { var e = s.indexOf("*/", k + 2); k = e < 0 ? s.length : e + 2; continue }
        break
      }
      if (k < s.length && (s.charAt(k) === "}" || s.charAt(k) === "]")) i++
      else { out += c; i++ }
    } else {
      out += c
      i++
    }
  }
  return out
}

function parse(text) {
  return JSON.parse(strip(text))
}
