.pragma library

// Turkish-aware, case- and diacritic-insensitive normalization for search.
//
// normalize() is a strict 1:1 mapping per UTF-16 code unit: the output always has the same length as
// the input, so an index found in normalized text is directly usable as an index into the original
// text (highlighting needs no separate index map). String.prototype.toLowerCase() is only ever applied
// to a single character, and only kept when it stays one character ("İ".toLowerCase() is two).

var FOLD = {
  "ı": "i", "ş": "s", "ğ": "g", "ü": "u", "ö": "o", "ç": "c",
  // A few common Latin diacritics too, as long as the mapping stays 1:1.
  "â": "a", "î": "i", "û": "u", "é": "e", "è": "e", "à": "a"
}

function lowerChar(c) {
  // Turkish casing: dotted İ and dotless I both end up as plain "i" after folding.
  if (c === "İ" || c === "I") return "i"
  var lower = c.toLowerCase()
  return lower.length === 1 ? lower : c
}

function normalize(s) {
  s = s === null || s === undefined ? "" : String(s)
  var out = ""
  for (var i = 0; i < s.length; i++) {
    var c = lowerChar(s.charAt(i))
    out += FOLD[c] || c
  }
  return out
}

// Turkish alphabet order for the alphabetical tie-breaker. Case-insensitive (Turkish casing),
// accent-sensitive: "Can" < "Çanta" < "Dosya". ASCII non-letters (space, digits, punctuation) sort before
// the letters, anything else outside the table after them; both by code point among themselves.
// q, w and x aren't Turkish letters but sit in their Latin places, as in ICU's Turkish collation.
var TR_ORDER = "abcçdefgğhıijklmnoöpqrsştuüvwxyz"

function rank(c) {
  var r = TR_ORDER.indexOf(c)
  if (r >= 0) return 0x10000 + r
  var code = c.charCodeAt(0)
  return code < 128 ? code : 0x20000 + code
}

function turkishLower(c) {
  if (c === "I") return "ı"
  if (c === "İ") return "i"
  var lower = c.toLowerCase()
  return lower.length === 1 ? lower : c
}

// A string whose plain </> order is compareTurkish's order, computed once per node so that sorting
// search results in V4 is a native string comparison instead of per-character work.
// ASCII non-letters keep their code (0x00–0x7F), alphabet letters become 0x80 + rank, anything else is
// shifted above both (0x100 + code, capped).
function sortKey(s) {
  s = String(s || "")
  var out = ""
  for (var i = 0; i < s.length; i++) {
    var c = turkishLower(s.charAt(i))
    var r = TR_ORDER.indexOf(c)
    var code = c.charCodeAt(0)
    out += String.fromCharCode(r >= 0 ? 0x80 + r : code < 128 ? code : Math.min(0xFFFF, 0x100 + code))
  }
  return out
}

function compareTurkish(a, b) {
  a = String(a || "")
  b = String(b || "")
  var n = Math.min(a.length, b.length)
  for (var i = 0; i < n; i++) {
    var ca = turkishLower(a.charAt(i))
    var cb = turkishLower(b.charAt(i))
    if (ca === cb) continue
    return rank(ca) - rank(cb)
  }
  return a.length - b.length
}
