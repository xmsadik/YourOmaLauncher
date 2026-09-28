import Quickshell
import Quickshell.Io
import QtQuick
import "lib/Model.js" as Model
import "lib/ConfigSerializer.js" as ConfigSerializer
import "lib/TreeOps.js" as TreeOps
import "lib/Usage.js" as Usage

// Owns ~/.config/youromalauncher: config.json (the tree and settings), config.backup.json (the
// version before the last save), usage.json (launch counts) and state.json (where the panel was left,
// for settings.rememberLastLocation).
//
// The panel is created on each open and destroyed on close (no keepLoaded), so config.json is read
// synchronously at creation: the first frame already shows the tree, never a flash of "empty".
//
// - Missing config.json on first run: an empty config is created.
// - Edited outside the plugin: reloaded automatically (watchChanges); our own writes are recognized
//   by their text and ignored.
// - Damaged config.json: `error` says why, the last good tree (or an empty one) stays usable, and
//   nothing is written until the file is fixed or restoreBackup() succeeds, so a hand-edit in
//   progress is never overwritten.
// - Saves are atomic (write to a temp file, then rename) and move the previous text to the backup.
Scope {
  id: store

  readonly property string configDir: {
    var custom = Quickshell.env("YOUROMALAUNCHER_CONFIG_DIR")
    if (custom) return String(custom)
    var xdg = Quickshell.env("XDG_CONFIG_HOME")
    return (xdg ? String(xdg) : String(Quickshell.env("HOME")) + "/.config") + "/youromalauncher"
  }
  readonly property string configPath: configDir + "/config.json"
  readonly property string backupPath: configDir + "/config.backup.json"
  readonly property string usagePath: configDir + "/usage.json"
  readonly property string statePath: configDir + "/state.json"

  property var config: Model.createConfig()
  property bool loaded: false
  property string error: ""          // non-empty while config.json can't be used; saving is off
  property var notes: []             // migration review notes from the last load
  readonly property bool readOnly: error.length > 0
  property var usage: Usage.create()

  // Emitted whenever `config` is replaced (load, reload, restore) — not after in-place edits.
  signal configReplaced()

  property string lastDiskText: ""   // what config.json holds, as far as we know

  function reload() {
    configFile.reload()
  }

  // Writes the current config. False (and nothing written) while the file on disk is damaged.
  function save() {
    if (readOnly || !loaded) return false
    var text = ConfigSerializer.serialize(store.config)
    if (text === store.lastDiskText) return true
    if (store.lastDiskText) backupFile.setText(store.lastDiskText)
    store.lastDiskText = text
    configFile.setText(text)
    return true
  }

  // Changes one setting and saves. Settings are a plain object inside `config`, so bindings on them
  // only update if `config` itself signals a change.
  function setSetting(key, value) {
    var settings = Object.assign({}, store.config.settings)
    settings[key] = value
    store.config.settings = settings
    store.configChanged()
    return save()
  }

  // Replaces a damaged config.json with the backup, if the backup itself is good.
  function restoreBackup() {
    backupFile.reload()
    var text = backupFile.text()
    if (!text) {
      store.error = "There is no backup to restore (" + store.backupPath + ")."
      return false
    }
    var result = ConfigSerializer.deserialize(text)
    if (!result.ok) {
      store.error = "The backup is damaged too: " + result.error
      return false
    }
    store.lastDiskText = text
    configFile.setText(text)
    apply(result)
    return true
  }

  function recordUsage(nodeId) {
    Usage.record(store.usage, nodeId, new Date())
    usageTimer.restart()
  }

  // { nodeId: score } for the search tie-breaker, as of now.
  function usageScores() {
    var now = new Date()
    var scores = {}
    for (var id in store.usage.entries) scores[id] = Usage.score(store.usage, id, now)
    return scores
  }

  function flushUsage() {
    if (!usageTimer.running) return
    usageTimer.stop()
    writeUsage()
  }

  function writeUsage() {
    if (!store.readOnly) Usage.prune(store.usage, TreeOps.collectIds(store.config.root))
    usageFile.setText(Usage.serialize(store.usage))
  }

  function handleText(text) {
    if (text === store.lastDiskText && store.loaded) return   // our own write coming back
    store.lastDiskText = text
    var result = ConfigSerializer.deserialize(text)
    if (!result.ok) {
      store.error = "config.json can't be read: " + result.error
      store.loaded = true
      store.configReplaced()   // same tree as before (or empty on first load), now read-only
      return
    }
    apply(result)
  }

  function apply(result) {
    store.config = result.config
    store.notes = result.notes
    store.error = ""
    store.loaded = true
    store.configReplaced()
  }

  // Folder ids from the root down to where the panel was last closed; [] if unknown.
  function lastLocation() {
    try {
      var state = JSON.parse(stateFile.text() || "{}")
      return Array.isArray(state.lastLocation) ? state.lastLocation.filter(function(id) { return typeof id === "string" }) : []
    } catch (e) {
      return []
    }
  }

  function setLastLocation(folderIds) {
    var text = JSON.stringify({ lastLocation: folderIds }, null, 2) + "\n"
    if (text !== stateFile.text()) stateFile.setText(text)
  }

  function firstRun() {
    store.config = Model.createConfig()
    store.notes = []
    store.error = ""
    store.loaded = true
    store.lastDiskText = ""
    save()
    store.configReplaced()
  }

  // Only on first run: the directory has to exist before config.json can be created in it.
  Process {
    id: mkdir
    command: ["mkdir", "-p", "--", store.configDir]
    onExited: function(code) {
      if (code === 0) store.firstRun()
      else {
        store.error = "Can't create " + store.configDir + "."
        store.loaded = true
        store.configReplaced()
      }
    }
  }

  FileView {
    id: configFile
    path: store.configPath
    blockLoading: true
    watchChanges: true
    atomicWrites: true
    blockWrites: true
    printErrors: false
    onLoaded: store.handleText(text())
    onLoadFailed: function(err) {
      if (err === FileViewError.FileNotFound) mkdir.running = true
      else {
        store.error = "config.json can't be read: " + FileViewError.toString(err)
        store.loaded = true
        store.configReplaced()
      }
    }
    onFileChanged: reload()
    onSaveFailed: function(err) {
      store.error = "Couldn't save config.json: " + FileViewError.toString(err)
    }
  }

  FileView {
    id: backupFile
    path: store.backupPath
    blockLoading: true
    atomicWrites: true
    blockWrites: true
    printErrors: false
  }

  FileView {
    id: usageFile
    path: store.usagePath
    blockLoading: true
    atomicWrites: true
    printErrors: false
    onLoaded: store.usage = Usage.deserialize(text())
    onLoadFailed: store.usage = Usage.create()
  }

  FileView {
    id: stateFile
    path: store.statePath
    blockLoading: true
    atomicWrites: true
    printErrors: false
  }

  // Launch counts change on every launch; write them at most every two seconds.
  Timer {
    id: usageTimer
    interval: 2000
    onTriggered: store.writeUsage()
  }

  Component.onDestruction: flushUsage()
}
