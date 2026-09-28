.pragma library
.import "Model.js" as Model
.import "TreeOps.js" as TreeOps

// One-time bookmark import from Chromium-family browsers (their JSON `Bookmarks` files) and from
// Netscape bookmark HTML, the export format of Firefox, Chrome and most others. No file I/O here: the
// launcher lists and reads the files, these functions turn text into a folder of `url` nodes.
//
// Both parsers skip javascript: bookmarklets and links without a URL, name an untitled link after its
// host, call an unnamed folder "(unnamed)" and drop folders that end up empty. They return
// { ok: true, folder } or { ok: false, error } and never throw.

// ---- finding browser profiles ----

// Where each browser keeps its profiles, relative to the config directory ($XDG_CONFIG_HOME, or a
// Flatpak's own). `single`: the profile's files sit directly in that directory (Opera), instead of in
// Default/ and "Profile N"/ subdirectories.
var BROWSERS = [
  { browser: "Chromium", dir: "chromium", flatpak: "org.chromium.Chromium" },
  { browser: "Chrome", dir: "google-chrome", flatpak: "com.google.Chrome" },
  { browser: "Chrome Beta", dir: "google-chrome-beta" },
  { browser: "Chrome Dev", dir: "google-chrome-unstable" },
  { browser: "Brave", dir: "BraveSoftware/Brave-Browser", flatpak: "com.brave.Browser" },
  { browser: "Edge", dir: "microsoft-edge", flatpak: "com.microsoft.Edge" },
  { browser: "Vivaldi", dir: "vivaldi", flatpak: "com.vivaldi.Vivaldi" },
  { browser: "Opera", dir: "opera", single: true, flatpak: "com.opera.Opera" }
]

// Signed-in Chrome keeps the Google-account bookmarks in AccountBookmarks and local ones in Bookmarks;
// a profile can have either or both, and the browser shows them merged.
var BOOKMARK_FILES = ["AccountBookmarks", "Bookmarks"]

// Every user-data directory to look in: { browser, key, path, single }.
function userDataDirs(configHome, home) {
  var out = []
  BROWSERS.forEach(function(b) {
    var key = b.browser.toLowerCase().replace(/ /g, "-")
    out.push({ browser: b.browser, key: key, path: configHome + "/" + b.dir, single: !!b.single })
    if (b.flatpak)
      out.push({ browser: b.browser + " (Flatpak)", key: key + "-flatpak",
                 path: home + "/.var/app/" + b.flatpak + "/config/" + b.dir, single: !!b.single })
  })
  return out
}

// argv that lists every bookmark file and "Local State" under those directories (missing directories
// only produce complaints on stderr).
function findCommand(dirs) {
  return ["find"].concat(dirs.map(function(d) { return d.path }),
    ["-maxdepth", "2", "-type", "f", "(", "-name", "Bookmarks", "-o", "-name", "AccountBookmarks", "-o", "-name", "Local State", ")"])
}

// Profile display names from a browser's "Local State": { "Default": "Work", ... }. {} if unreadable.
function profileNames(localStateText) {
  try {
    var cache = JSON.parse(localStateText).profile.info_cache
    var out = {}
    for (var dir in cache)
      if (cache[dir] && typeof cache[dir].name === "string" && cache[dir].name.trim()) out[dir] = cache[dir].name
    return out
  } catch (e) {
    return {}
  }
}

// Turns the file list from findCommand into sources, in BROWSERS order, then profile order:
// { browser, profileDir, profileName, paths, sourceKey, displayName }. localStates maps a user-data
// directory to its "Local State" text, for profile names; missing ones fall back to the directory name.
function sources(dirs, foundPaths, localStates) {
  var found = {}
  foundPaths.forEach(function(p) { found[p] = true })
  var out = []
  dirs.forEach(function(d) {
    var profiles = []
    if (d.single) {
      var paths = existing(d.path, found)
      if (paths.length) profiles.push({ dir: "", paths: paths })
    } else {
      var dirsSeen = {}
      foundPaths.forEach(function(p) {
        if (p.indexOf(d.path + "/") !== 0) return
        var rest = p.substring(d.path.length + 1).split("/")
        if (rest.length === 2 && (rest[0] === "Default" || /^Profile \d+$/.test(rest[0]))) dirsSeen[rest[0]] = true
      })
      Object.keys(dirsSeen).sort(compareProfileDirs).forEach(function(dir) {
        profiles.push({ dir: dir, paths: existing(d.path + "/" + dir, found) })
      })
    }
    var names = profileNames((localStates || {})[d.path] || "")
    profiles.forEach(function(p) { p.name = names[p.dir] || p.dir })
    profiles.forEach(function(p) {
      var shared = profiles.filter(function(q) { return q.name === p.name }).length > 1
      out.push({
        browser: d.browser,
        profileDir: p.dir,
        profileName: p.name,
        paths: p.paths,
        sourceKey: d.key + "/" + p.dir.toLowerCase(),
        // Only name the profile when the browser has more than one; two can share a name.
        displayName: profiles.length < 2 ? d.browser
          : d.browser + " (" + p.name + (shared ? ", " + p.dir : "") + ")"
      })
    })
  })
  return out
}

function existing(dir, found) {
  return BOOKMARK_FILES.map(function(f) { return dir + "/" + f }).filter(function(p) { return found[p] })
}

// Default first, then Profile 1, Profile 2, … Profile 10 (numerically).
function compareProfileDirs(a, b) {
  function n(d) { return d === "Default" ? -1 : parseInt(d.substring(8), 10) }
  return n(a) - n(b)
}

// ---- shared tree rules ----

function newFolder(name) {
  return Model.createNode("folder", { name: name })
}

function isBookmarklet(url) {
  return /^javascript:/i.test(url)
}

// An empty title becomes the URL's host, or the URL itself when it has none (about:blank).
function titleOrHost(title, url) {
  if (title) return title
  var m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^\/?#@]*@)?(\[[^\]]*\]|[^\/?#:]+)/i.exec(url)
  return m && m[1] ? m[1] : url
}

function folderName(name) {
  return name ? name : "(unnamed)"
}

function urlNode(title, url) {
  if (!url || isBookmarklet(url)) return null
  return Model.createNode("url", { name: titleOrHost(title, url), target: url })
}

// Drops folders that end up empty, including ones that only became empty once their own were dropped.
function pruneEmpty(folder) {
  for (var i = folder.children.length - 1; i >= 0; i--) {
    var child = folder.children[i]
    if (child.type !== "folder") continue
    pruneEmpty(child)
    if (child.children.length === 0) folder.children.splice(i, 1)
  }
}

function countUrls(node) {
  if (node.type === "url") return 1
  var n = 0
  var children = node.children || []
  for (var i = 0; i < children.length; i++) n += countUrls(children[i])
  return n
}

// ---- Chromium JSON ----

// Several files of one profile merge under the same three folders, in file order. The roots' own
// names in the file are ignored; these three are always used.
function parseChromium(texts, name) {
  var result = newFolder(name)
  var bar = newFolder("Bookmarks bar")
  var other = newFolder("Other bookmarks")
  var synced = newFolder("Mobile bookmarks")
  result.children.push(bar, other, synced)
  for (var i = 0; i < texts.length; i++) {
    var data
    try {
      data = JSON.parse(texts[i])
    } catch (e) {
      return { ok: false, error: "Could not parse the bookmarks file: " + (e && e.message ? e.message : e) }
    }
    if (!isObject(data) || !isObject(data.roots))
      return { ok: false, error: "Could not parse the bookmarks file: it has no \"roots\"." }
    addChromiumChildren(bar, data.roots.bookmark_bar)
    addChromiumChildren(other, data.roots.other)
    addChromiumChildren(synced, data.roots.synced)
  }
  pruneEmpty(result)
  return { ok: true, folder: result }
}

function isObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v) }
function str(v) { return typeof v === "string" ? v : "" }

function addChromiumChildren(folder, raw) {
  if (!isObject(raw) || !Array.isArray(raw.children)) return
  raw.children.forEach(function(child) {
    if (!isObject(child)) return
    if (child.type === "folder") {
      var sub = newFolder(folderName(str(child.name)))
      addChromiumChildren(sub, child)
      folder.children.push(sub)
    } else if (child.type === "url") {
      var node = urlNode(str(child.name), str(child.url))
      if (node) folder.children.push(node)
    }
  })
}

// ---- Netscape HTML ----

// The format is old, informal HTML whose <DT> and <p> are never closed, so a tolerant tokenizer is
// what it calls for rather than an HTML parser. In document order, case-insensitively:
// <H3>name</H3> followed by <DL> is a folder, <A HREF="…">title</A> a bookmark, </DL> ends a folder.
// Everything else (<H1>, <DT>, <p>, <META>, …) is ignored. The outermost <DL> has no <H3>, so its
// links and folders go straight into the result.
var TOKENS = /<H3\b[^>]*>([\s\S]*?)<\/H3\s*>|<A\s+([^>]*?)>([\s\S]*?)<\/A\s*>|(<DL\b[^>]*>)|(<\/DL\s*>)/gi

function parseNetscape(html, name) {
  var root = newFolder(name)
  var stack = [root]
  var pendingFolder = null
  var m
  TOKENS.lastIndex = 0
  while ((m = TOKENS.exec(String(html))) !== null) {
    var top = stack[stack.length - 1]
    if (m[5]) {
      if (stack.length > 1) stack.pop()   // never past the root, whatever stray </DL>s there are
    } else if (m[4]) {
      if (pendingFolder !== null) {
        var folder = newFolder(pendingFolder)
        top.children.push(folder)
        stack.push(folder)
        pendingFolder = null
      } else {
        stack.push(top)   // a <DL> without a name: its items belong to the enclosing folder
      }
    } else if (m[1] !== undefined) {
      pendingFolder = folderName(decodeEntities(stripTags(m[1])).trim())
    } else if (m[2] !== undefined) {
      pendingFolder = null
      var href = /\bHREF\s*=\s*"([^"]*)"/i.exec(m[2])
      var node = href ? urlNode(decodeEntities(stripTags(m[3])).trim(), decodeEntities(href[1]).trim()) : null
      if (node) top.children.push(node)
    }
  }
  pruneEmpty(root)
  if (root.children.length === 0) return { ok: false, error: "No bookmarks found in " + name + "." }
  return { ok: true, folder: root }
}

function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, "")
}

var NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " }

function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, function(all, e) {
    if (e.charAt(0) === "#") {
      var code = e.charAt(1) === "x" || e.charAt(1) === "X" ? parseInt(e.substring(2), 16) : parseInt(e.substring(1), 10)
      return code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : all
    }
    var named = NAMED_ENTITIES[e.toLowerCase()]
    return named !== undefined ? named : all
  })
}

// ---- applying ----

// The id a source's import folder gets, so that importing the same source again finds it.
function importedFolderId(sourceKey) {
  return "bookmarks:" + sourceKey
}

function htmlSourceKey(path) {
  return "html/" + String(path).substring(String(path).lastIndexOf("/") + 1).toLowerCase()
}

// A source imported for the first time is added to targetFolder as a new folder. Importing it again
// replaces just the contents of the folder from last time, wherever it has been moved since, keeping
// its name, icon and place. Returns { folder, replaced, count } (count: bookmarks now in it).
function apply(root, targetFolder, imported, sourceKey) {
  var id = importedFolderId(sourceKey)
  var count = countUrls(imported)
  var existing = TreeOps.findById(root, id)
  if (existing && existing.type === "folder") {
    existing.children = imported.children
    return { folder: existing, replaced: true, count: count }
  }
  // The id is taken by something else (only possible in a hand-edited config): never duplicate it.
  imported.id = existing ? Model.newId() : id
  TreeOps.add(targetFolder, imported)
  return { folder: imported, replaced: false, count: count }
}
