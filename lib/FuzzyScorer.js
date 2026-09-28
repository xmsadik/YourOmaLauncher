.pragma library

// Deterministic fuzzy scorer. Tiers, best to worst: EXACT, PREFIX, WORD_START (acronym / greedy
// word-prefix runs, e.g. "visco" against "visual studio code"), SUBSTRING, FUZZY (scattered, in-order
// chars). A multi-word query is split on spaces; every token must match independently, scores are summed
// and matched positions unioned. Inputs are expected to be TextNormalizer.normalize()d already.
//
// A match is { score, tier, positions } with positions ascending indices into the text; no match is null.
//
// This runs per keystroke over every node inside QML's V4 engine, which is far slower than a browser
// engine, so the hot path (scoreTokens with withPositions = false) avoids allocating: word starts come
// precomputed as index lists, and positions are only built for the results actually shown.

var EXACT = 0
var PREFIX = 1
var WORD_START = 2
var SUBSTRING = 3
var FUZZY = 4

function isLower(c) { return c !== c.toUpperCase() && c === c.toLowerCase() }
function isUpper(c) { return c !== c.toLowerCase() && c === c.toUpperCase() }

// Word-start flags: true at index 0, after a separator (space - _ . / \ (), or at a lower→upper camelCase
// boundary. Called with the original (un-normalized) name, camelCase boundaries are found; on
// already-lower-cased text the camelCase check never fires and this degrades to separators only.
function computeWordStarts(text) {
  var flags = []
  for (var i = 0; i < text.length; i++) {
    if (i === 0) { flags.push(true); continue }
    var prev = text.charAt(i - 1)
    var cur = text.charAt(i)
    flags.push(" -_./\\(".indexOf(prev) >= 0 || (isLower(prev) && isUpper(cur)))
  }
  return flags
}

// Flags → ascending list of the indices that start a word.
function wordStartIndices(flags) {
  var out = []
  for (var i = 0; i < flags.length; i++) if (flags[i]) out.push(i)
  return out
}

function tokenize(normalizedQuery) {
  return String(normalizedQuery || "").split(" ").filter(function(t) { return t.length > 0 })
}

function score(normalizedQuery, normalizedText, wordStarts) {
  var tokens = tokenize(normalizedQuery)
  if (tokens.length === 0) return null
  var text = String(normalizedText || "")
  return scoreTokens(tokens, text, wordStartIndices(wordStarts || computeWordStarts(text)), true)
}

// tokens: non-empty normalized tokens. ws: word-start indices of text. positions is null unless
// withPositions is set.
function scoreTokens(tokens, text, ws, withPositions) {
  if (text.length === 0) return null
  var total = 0
  var worst = EXACT
  var positions = withPositions ? [] : null
  for (var t = 0; t < tokens.length; t++) {
    var r = scoreToken(tokens[t], text, ws, withPositions)
    if (r === null) return null
    total += r.score
    if (r.tier > worst) worst = r.tier
    if (withPositions) positions = positions.concat(r.positions)
  }
  if (withPositions && tokens.length > 1) {
    positions.sort(function(a, b) { return a - b })
    positions = positions.filter(function(p, i) { return i === 0 || p !== positions[i - 1] })
  }
  return { score: total, tier: worst, positions: positions }
}

function range(start, length) {
  var out = []
  for (var i = 0; i < length; i++) out.push(start + i)
  return out
}

function isWordStart(ws, index) {
  // ws is short (a handful of words), so a scan beats anything cleverer.
  for (var i = 0; i < ws.length && ws[i] <= index; i++) if (ws[i] === index) return true
  return false
}

function scoreToken(token, text, ws, withPositions) {
  if (text === token)
    return { score: 1000, tier: EXACT, positions: withPositions ? range(0, token.length) : null }
  if (text.lastIndexOf(token, 0) === 0) {
    var prefixBonus = Math.max(0, 50 - (text.length - token.length))
    return { score: 800 + prefixBonus, tier: PREFIX, positions: withPositions ? range(0, token.length) : null }
  }
  var wordStart = matchWordStart(token, text, ws, withPositions)
  if (wordStart !== null) return wordStart
  var idx = text.indexOf(token)
  if (idx >= 0) {
    var bonus = isWordStart(ws, idx) ? 50 : 0
    return { score: Math.max(1, 400 + bonus - Math.min(idx, 30)), tier: SUBSTRING,
             positions: withPositions ? range(idx, token.length) : null }
  }
  return matchFuzzy(token, text, withPositions)
}

// True if the token splits into consecutive runs, each a literal prefix starting exactly at a word
// start, in increasing order ("visco" → "vis" at 0 + "co" at 14 for "visual studio code"). Backtracking
// so a greedy run that dead-ends can be shortened; failures are memoized to keep it bounded.
function matchWordStart(token, text, ws, withPositions) {
  // Cheap exit: the token's first char must begin some word.
  var first = token.charAt(0)
  var any = false
  for (var i = 0; i < ws.length; i++) if (text.charAt(ws[i]) === first) { any = true; break }
  if (!any) return null

  var runs = []
  if (!searchRuns(token, text, ws, 0, 0, runs, {})) return null
  var gapCount = runs.length / 2 - 1
  var bonus = Math.max(0, 30 - gapCount * 10) + Math.max(0, 20 - runs[0])
  var positions = null
  if (withPositions) {
    positions = []
    for (var r = 0; r < runs.length; r += 2)
      for (var k = 0; k < runs[r + 1]; k++) positions.push(runs[r] + k)
  }
  return { score: 600 + bonus, tier: WORD_START, positions: positions }
}

// runs is a flat [start, length, start, length, …] list of the current attempt.
function searchRuns(token, text, ws, tokenPos, wsSearchIdx, runs, failed) {
  if (tokenPos === token.length) return true
  if (wsSearchIdx >= ws.length) return false
  var key = tokenPos * (ws.length + 1) + wsSearchIdx
  if (failed[key]) return false
  for (var wi = wsSearchIdx; wi < ws.length; wi++) {
    var start = ws[wi]
    var maxLen = 0
    while (maxLen < token.length - tokenPos && start + maxLen < text.length &&
           text.charAt(start + maxLen) === token.charAt(tokenPos + maxLen))
      maxLen++
    for (var len = maxLen; len >= 1; len--) {
      var nextTextPos = start + len
      var nextWsIdx = wi + 1
      while (nextWsIdx < ws.length && ws[nextWsIdx] < nextTextPos) nextWsIdx++
      runs.push(start, len)
      if (searchRuns(token, text, ws, tokenPos + len, nextWsIdx, runs, failed)) return true
      runs.length -= 2
    }
  }
  failed[key] = true
  return false
}

// Scattered, in-order match: a leftmost forward pass finds the earliest position for each char, then a
// backward pass pulls each position as close as possible to the next one to minimize the total gap.
function matchFuzzy(token, text, withPositions) {
  var positions = []
  var from = 0
  for (var i = 0; i < token.length; i++) {
    var idx = text.indexOf(token.charAt(i), from)
    if (idx < 0) return null
    positions.push(idx)
    from = idx + 1
  }
  for (var j = token.length - 2; j >= 0; j--)
    positions[j] = text.lastIndexOf(token.charAt(j), positions[j + 1] - 1)
  var gap = 0
  for (var k = 1; k < positions.length; k++) gap += positions[k] - positions[k - 1] - 1
  return { score: Math.max(1, 200 - gap), tier: FUZZY, positions: withPositions ? positions : null }
}
