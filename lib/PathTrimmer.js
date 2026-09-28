.pragma library

// Shortens a breadcrumb ("A › B › C") from the start so its most specific part, the end, stays
// visible: whole leading segments become "… › " first ("… › B › C"); only if the last segment alone
// doesn't fit is it cut character-wise ("…C-tail"). measure(text) → width is supplied by the caller
// (e.g. a TextMetrics), so this stays free of UI code.

var SEPARATOR = " › "
var ELLIPSIS = "…"

function trimStart(text, maxWidth, measure) {
  if (!text || measure(text) <= maxWidth) return text || ""
  var segments = text.split(SEPARATOR)
  for (var skip = 1; skip < segments.length; skip++) {
    var candidate = ELLIPSIS + SEPARATOR + segments.slice(skip).join(SEPARATOR)
    if (measure(candidate) <= maxWidth) return candidate
  }
  var last = segments[segments.length - 1]
  for (var start = 1; start < last.length; start++) {
    var tail = ELLIPSIS + last.substring(start)
    if (measure(tail) <= maxWidth) return tail
  }
  return measure(ELLIPSIS) <= maxWidth ? ELLIPSIS : ""
}
