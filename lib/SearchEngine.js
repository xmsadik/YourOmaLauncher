.pragma library
.import "TextNormalizer.js" as TextNormalizer
.import "FuzzyScorer.js" as FuzzyScorer

// Whole-tree search. buildIndex() flattens the tree once (call it again whenever the config changes);
// search() scores every entry on name (weight 10), best keyword (8), description (6) and command text
// (5, command nodes only); the best weighted field wins. Order: score desc, then usage desc, then depth
// asc, then Turkish alphabetical, then tree order.
//
// Performance: this runs on every keystroke in QML's V4 engine, which is 20–50× slower than a browser
// engine. So everything that doesn't depend on the query is precomputed per entry, entries that can't
// match are rejected with a few native indexOf calls, only the best `limit` hits are kept (no full
// sort), and highlight positions are computed for those alone.

var NAME_WEIGHT = 10
var KEYWORD_WEIGHT = 8
var DESCRIPTION_WEIGHT = 6
var COMMAND_WEIGHT = 5

var BREADCRUMB_SEPARATOR = " › "
var FIELD_SEPARATOR = "\u0001"

// One entry per node except the root itself and separators:
// { node, parentChain (root … parent), depth, breadcrumb, order, sortKey, fields, haystack }
function buildIndex(root) {
  var entries = []
  walk(root, [root], entries)
  return entries
}

function walk(folder, chain, entries) {
  var children = folder.children || []
  for (var i = 0; i < children.length; i++) {
    var child = children[i]
    if (child.type === "separator") continue
    entries.push(createEntry(child, chain, entries.length))
    if (child.type === "folder") {
      chain.push(child)
      walk(child, chain, entries)
      chain.pop()
    }
  }
}

function field(kind, weight, original, wordStartSource) {
  var text = TextNormalizer.normalize(original)
  return {
    kind: kind,
    weight: weight,
    text: text,
    ws: FuzzyScorer.wordStartIndices(FuzzyScorer.computeWordStarts(wordStartSource === undefined ? text : wordStartSource))
  }
}

function createEntry(node, chain, order) {
  var names = []
  for (var i = 1; i < chain.length; i++) names.push(chain[i].name)  // chain[0] is the root, never shown
  var name = String(node.name || "")
  // The name's word starts come from the ORIGINAL text, so camelCase boundaries ("VsCode") count.
  var fields = [field("name", NAME_WEIGHT, name, name)]
  var keywords = node.keywords || []
  for (var k = 0; k < keywords.length; k++)
    if (keywords[k]) fields.push(field("keywords", KEYWORD_WEIGHT, keywords[k]))
  if (node.description) fields.push(field("description", DESCRIPTION_WEIGHT, node.description))
  if (node.type === "command" && node.command) fields.push(field("command", COMMAND_WEIGHT, node.command))

  return {
    node: node,
    parentChain: chain.slice(),
    depth: chain.length - 1,
    breadcrumb: names.join(BREADCRUMB_SEPARATOR),
    order: order,
    sortKey: TextNormalizer.sortKey(name),
    fields: fields,
    haystack: fields.map(function(f) { return f.text }).join(FIELD_SEPARATOR)
  }
}

// Every char of every token must occur, in order, somewhere in the entry's text. Necessary for every
// match tier, and cheap, so it rules most entries out before real scoring.
function mayMatch(haystack, tokens) {
  for (var t = 0; t < tokens.length; t++) {
    var token = tokens[t]
    var from = 0
    for (var i = 0; i < token.length; i++) {
      from = haystack.indexOf(token.charAt(i), from)
      if (from < 0) return false
      from++
    }
  }
  return true
}

// usage: optional; either function(nodeId) → number or a { nodeId: number } map, higher = used more
// or more recently. Returns [{ node, parentChain, breadcrumb, depth, score, tier, matchedField,
// namePositions }]; namePositions index into node.name and are empty unless the name won.
function search(index, query, usage, limit) {
  var tokens = FuzzyScorer.tokenize(TextNormalizer.normalize(query))
  if (tokens.length === 0) return []
  var max = limit === undefined || limit === null ? 50 : limit
  if (max <= 0) return []
  var usageOf = typeof usage === "function" ? usage
    : usage ? function(id) { return usage[id] || 0 } : null

  var top = []   // best first, at most `max` long
  for (var i = 0; i < index.length; i++) {
    var entry = index[i]
    if (!mayMatch(entry.haystack, tokens)) continue
    var hit = scoreEntry(entry, tokens)
    if (hit === null) continue
    if (top.length === max && compareHits(hit, top[max - 1], usageOf) >= 0) continue
    // Binary search for the insertion point.
    var lo = 0, hi = top.length
    while (lo < hi) {
      var mid = (lo + hi) >> 1
      if (compareHits(hit, top[mid], usageOf) < 0) hi = mid
      else lo = mid + 1
    }
    top.splice(lo, 0, hit)
    if (top.length > max) top.pop()
  }

  return top.map(function(h) {
    var e = h.entry
    var namePositions = []
    if (h.field.kind === "name")
      namePositions = FuzzyScorer.scoreTokens(tokens, h.field.text, h.field.ws, true).positions
    return {
      node: e.node,
      parentChain: e.parentChain,
      breadcrumb: e.breadcrumb,
      depth: e.depth,
      score: h.weighted,
      tier: h.tier,
      matchedField: h.field.kind,
      namePositions: namePositions
    }
  })
}

// Negative when a ranks before b.
function compareHits(a, b, usageOf) {
  if (a.weighted !== b.weighted) return b.weighted - a.weighted
  if (usageOf) {
    if (a.usage === undefined) a.usage = usageOf(a.entry.node.id) || 0
    if (b.usage === undefined) b.usage = usageOf(b.entry.node.id) || 0
    if (a.usage !== b.usage) return b.usage - a.usage
  }
  if (a.entry.depth !== b.entry.depth) return a.entry.depth - b.entry.depth
  if (a.entry.sortKey !== b.entry.sortKey) return a.entry.sortKey < b.entry.sortKey ? -1 : 1
  return a.entry.order - b.entry.order
}

// Best weighted field for one entry, or null. tokens must be non-empty.
function scoreEntry(entry, tokens) {
  var best = null
  var fields = entry.fields
  for (var f = 0; f < fields.length; f++) {
    var fld = fields[f]
    var match = FuzzyScorer.scoreTokens(tokens, fld.text, fld.ws, false)
    if (match === null) continue
    var weighted = Math.floor(match.score * fld.weight / 10)
    if (best === null || weighted > best.weighted)
      best = { entry: entry, field: fld, tier: match.tier, weighted: weighted }
  }
  return best
}
