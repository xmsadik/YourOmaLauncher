.pragma library

// usage.json: per-node launch counts, kept apart from config.json so the hand-edited file stays free
// of noisy data. Shape: { "entries": { "<node id>": { "useCount": 3, "lastUsedUtc": "<ISO 8601>" } } }.
// Used only as a search-ranking tie breaker; it never changes the order of a folder listing.

var DAY_MS = 24 * 60 * 60 * 1000

function create() {
  return { entries: {} }
}

function record(data, nodeId, now) {
  var when = (now || new Date()).toISOString()
  var entry = data.entries[nodeId]
  if (entry) {
    entry.useCount++
    entry.lastUsedUtc = when
  } else {
    data.entries[nodeId] = { useCount: 1, lastUsedUtc: when }
  }
}

// Frecency: useCount weighted by age of the last use: ≤1 day ×4, ≤7 days ×2, ≤30 days ×1, older ×0.5.
// Nodes never used score 0.
function score(data, nodeId, now) {
  var entry = data.entries[nodeId]
  if (!entry) return 0
  var last = Date.parse(entry.lastUsedUtc)
  if (isNaN(last)) return 0
  var ageDays = ((now || new Date()).getTime() - last) / DAY_MS
  var weight = ageDays <= 1 ? 4 : ageDays <= 7 ? 2 : ageDays <= 30 ? 1 : 0.5
  return entry.useCount * weight
}

// Drops entries whose node no longer exists (after a delete or an import, and once at startup).
function prune(data, existingIds) {
  var keep = {}
  for (var i = 0; i < existingIds.length; i++) keep[existingIds[i]] = true
  for (var id in data.entries) if (!keep[id]) delete data.entries[id]
}

function serialize(data) {
  return JSON.stringify(data, null, 2) + "\n"
}

// Never throws: a corrupt or missing file just means no usage history.
function deserialize(text) {
  var data = create()
  var raw
  try { raw = JSON.parse(text) } catch (e) { return data }
  if (!raw || typeof raw.entries !== "object" || Array.isArray(raw.entries)) return data
  for (var id in raw.entries) {
    var e = raw.entries[id]
    if (e && typeof e.useCount === "number" && typeof e.lastUsedUtc === "string")
      data.entries[id] = { useCount: e.useCount, lastUsedUtc: e.lastUsedUtc }
  }
  return data
}
