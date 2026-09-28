import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Wayland
import QtQuick
import qs.Commons
import qs.Ui
import "lib/SearchEngine.js" as SearchEngine
import "lib/Listing.js" as Listing
import "lib/LaunchPlan.js" as LaunchPlan
import "lib/EnvExpander.js" as EnvExpander
import "lib/TreeOps.js" as TreeOps
import "lib/PathTrimmer.js" as PathTrimmer
import "lib/Model.js" as Model
import "lib/Editing.js" as Editing
import "lib/Bookmarks.js" as Bookmarks
import "lib/ConfigSerializer.js" as ConfigSerializer
import "ui"

// The launcher panel. Two modes:
// - nav: the search text is empty; the list is the current folder (folders first).
// - search: the list is ranked results from the whole tree, each with its folder path.
// Keyboard behavior follows the Windows app's spec §6.1–§6.3; see the hint bar and README.
// Editing happens on pages that replace the list inside the same card (`page`).
Item {
  id: root

  // Lifecycle contract with omarchy-shell: summon → open(payload), hide → close(),
  // toggle reads `opened`.
  property bool opened: false

  property string filterText: ""
  property var folderPath: [store.config.root]   // root … current folder
  property var rows: []
  property int selectedIndex: -1
  property string message: ""          // transient status line, e.g. a launch error
  property bool messageIsInfo: false   // a confirmation ("Saved …") rather than a problem
  property var pendingLaunch: null     // node waiting for "Launch?" confirmation
  property var searchIndex: null       // rebuilt lazily after the tree changes
  property var usageScores: ({})
  property var pendingLocation: null   // folder ids to open once the config has loaded

  property string page: "list"         // list | type | editor | apps | icon | settings | transfer
  property string editId: ""           // the node the editor or icon page works on; "" = a new one
  property var pendingDelete: null     // node waiting for "Delete?" confirmation
  property string cutId: ""            // Ctrl+X'd node, moved by Ctrl+V
  property bool menuOpen: false
  property var menuNode: null          // what the context menu acts on (null: the folder itself)
  property var targetScreen: null      // the monitor the panel opens on, chosen at open()
  property string browseFor: ""        // the field a running file chooser fills in
  property var pendingImport: null     // a config file read for import, waiting for merge or replace
  property var readQueue: []           // readFiles() jobs, one file at a time

  readonly property var settings: store.config.settings
  readonly property bool searching: filterText.trim().length > 0
  readonly property var currentFolder: folderPath[folderPath.length - 1]
  readonly property var selectedRow: selectedIndex >= 0 && selectedIndex < rows.length ? rows[selectedIndex] : null

  // Same [menu] surface tokens as the built-in clipboard, so themes that style the menu also style
  // the launcher.
  property color background: Color.menu.background
  property color foreground: Color.menu.text
  property color border: Color.menu.border
  property var borderSpec: Border.surfaceSpec("menu", "border", border, Math.max(1, Style.space(2)))
  property color scrim: Color.menu.scrim
  property color selectedBackground: Color.menu.selectedBackground
  property color selectedText: Color.menu.selectedText
  property color muted: Util.alpha(Color.menu.text, 0.55)
  property color warning: Color.urgent
  readonly property int cornerRadius: Style.cornerRadius
  property string fontFamily: Style.font.menuFamily
  property int contentMargin: Style.spacing.panelPadding
  property int contentSpacing: Style.spacing.md
  property int headerHeight: Math.max(Style.space(34), Style.font.title + Style.spacing.controlPaddingY * 2)
  property int rowHeight: Math.max(Style.space(36), Style.font.subtitle + Style.space(16))
  property int separatorHeight: Style.space(11)
  property int iconSize: Math.round(Style.font.subtitle * 1.6)
  property int cardWidth: Math.min(Style.space(640), panel.width - Style.gapsOut * 2)
  readonly property int visibleRowCount: Math.max(1, (settings && settings.maxVisibleItems) || 8)

  function env(name) { return Quickshell.env(name) }

  onMessageChanged: root.messageIsInfo = false

  // A status-line confirmation, shown muted instead of as a warning.
  function inform(text) {
    root.message = text
    root.messageIsInfo = text.length > 0
  }

  // ---- lifecycle ----

  function open(payloadJson) {
    root.targetScreen = root.focusedScreen()
    root.opened = true
    root.filterText = ""
    root.message = ""
    root.pendingLaunch = null
    root.pendingDelete = null
    root.page = "list"
    root.menuOpen = false
    root.usageScores = store.usageScores()
    // The config usually arrives just after open(); until then only remember where to go.
    var ids = store.loaded && !root.settings.rememberLastLocation ? [] : store.lastLocation()
    if (store.loaded) root.folderPath = root.pathFromIds(root.settings.rememberLastLocation ? ids : [])
    else root.pendingLocation = ids
    root.refresh(null)
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  // The screen of the monitor Hyprland has focused, where a keyboard-summoned panel belongs (the same
  // rule as the bar's panels). null until Hyprland reports one: the compositor then picks.
  function focusedScreen() {
    var monitor = Hyprland.focusedMonitor
    var name = monitor ? String(monitor.name || "") : ""
    var screens = Quickshell.screens
    for (var i = 0; i < screens.length; i++) if (screens[i].name === name) return screens[i]
    return null
  }

  function close() {
    if (root.settings.rememberLastLocation && !store.readOnly)
      store.setLastLocation(root.folderPath.slice(1).map(function(f) { return f.id }))
    root.pendingLaunch = null
    root.pendingDelete = null
    root.opened = false
  }

  function toggle() {
    if (root.opened) root.close()
    else root.open("{}")
  }

  // ---- listing ----

  function ensureIndex() {
    if (root.searchIndex === null) root.searchIndex = SearchEngine.buildIndex(store.config.root)
    return root.searchIndex
  }

  // Rebuilds the rows; keeps `keepNode` selected if it's still listed, else selects the first row.
  function refresh(keepNode) {
    if (root.searching)
      root.rows = Listing.resultRows(SearchEngine.search(root.ensureIndex(), root.filterText, root.usageScores, 50))
    else
      root.rows = Listing.folderRows(root.currentFolder)
    var keep = keepNode ? Listing.indexOfNode(root.rows, keepNode) : -1
    root.select(keep >= 0 ? keep : Listing.firstSelectable(root.rows))
  }

  function select(index) {
    root.selectedIndex = index
    // The config can arrive while the panel is still being built, before the list exists.
    if (index >= 0 && typeof list !== "undefined" && list) list.positionViewAtIndex(index, ListView.Contain)
  }

  function setFilter(text) {
    root.filterText = text
    root.message = ""
    root.refresh(null)
  }

  // Root … the deepest folder in `ids` (folder ids below the root) that still exists.
  function pathFromIds(ids) {
    var path = [store.config.root]
    for (var i = 0; i < ids.length; i++) {
      var found = TreeOps.findById(path[path.length - 1], ids[i])
      if (!found || found.type !== "folder") break
      path.push(found)
    }
    return path
  }

  // After a load, reload or restore: find the same folders (by id) in the new tree.
  function onConfigReplaced() {
    root.searchIndex = null
    var keepId = root.selectedRow ? root.selectedRow.node.id : null
    var ids = root.folderPath.slice(1).map(function(f) { return f.id })
    if (root.pendingLocation !== null) {
      ids = root.settings.rememberLastLocation ? root.pendingLocation : []
      root.pendingLocation = null
      keepId = null
    }
    root.folderPath = root.pathFromIds(ids)
    root.refresh(keepId ? TreeOps.findById(store.config.root, keepId) : null)
  }

  // ---- navigation ----

  function enterFolder(folder, parentChain) {
    root.folderPath = parentChain ? parentChain.concat([folder]) : root.folderPath.concat([folder])
    root.filterText = ""
    root.message = ""
    root.refresh(null)
  }

  function goUp() {
    if (root.folderPath.length <= 1) return
    var left = root.currentFolder
    root.folderPath = root.folderPath.slice(0, -1)
    root.message = ""
    root.refresh(left)
  }

  // Ctrl+Enter on a search result: open the folder it lives in, with it selected.
  function revealSelected() {
    var row = root.selectedRow
    if (!row || !row.result) return
    root.folderPath = row.result.parentChain
    root.filterText = ""
    root.refresh(row.node)
  }

  function activate(row) {
    if (!row || row.separator) return
    if (row.node.type === "folder") root.enterFolder(row.node, row.result ? row.result.parentChain : null)
    else if (row.node.confirmLaunch) root.pendingLaunch = row.node
    else root.launch(row.node)
  }

  // ---- launching ----

  function desktopEntryFor(desktopId) {
    var id = String(desktopId || "").trim()
    if (id.slice(-8) === ".desktop") id = id.slice(0, -8)
    return id ? DesktopEntries.byId(id) : null
  }

  function launch(node) {
    if (node.type === "app" && node.desktopId && !root.desktopEntryFor(node.desktopId)) {
      root.message = "“" + node.name + "”: no installed app with the id " + node.desktopId + "."
      return
    }
    var plan = LaunchPlan.planFor(node, root.settings, root.env)
    if (plan.error) {
      root.message = "“" + node.name + "”: " + plan.error
      return
    }
    Quickshell.execDetached(LaunchPlan.execArgv(plan))
    store.recordUsage(node.id)
    if (root.settings.closeAfterLaunch) root.close()
    else root.inform("Launched “" + node.name + "”.")
  }

  // ---- pages ----

  // Focus moves at once, so a key typed right after (Enter, then Ctrl+D) reaches the new page.
  function showPage(name) {
    root.page = name
    root.menuOpen = false
    root.refocus()
  }

  function refocus() {
    if (root.menuOpen) menu.forceActiveFocus()
    else if (root.page === "type") typePicker.takeFocus()
    else if (root.page === "editor") editor.takeFocus()
    else if (root.page === "apps") appPicker.takeFocus()
    else if (root.page === "icon") iconPage.takeFocus()
    else if (root.page === "settings") settingsPage.takeFocus()
    else if (root.page === "transfer") importPage.takeFocus()
    else keyCatcher.forceActiveFocus()
  }

  // ---- editing ----

  function canEdit() {
    if (!store.loaded) return false
    if (store.readOnly) {
      root.message = "Editing is off until config.json is fixed (Ctrl+R reload, Ctrl+Shift+R restore backup)."
      return false
    }
    return true
  }

  // After an in-place change to the tree: save, and list it again with `keepNode` selected.
  function commit(keepNode, text) {
    store.save()
    store.refreshNotes()
    root.searchIndex = null
    root.inform(text || "")
    root.refresh(keepNode)
  }

  function nodeById(id) {
    return id ? TreeOps.findById(store.config.root, id) : null
  }

  // A new item goes right after the selected one when that's in the current folder, else at the end.
  function insertIndex(folder) {
    var selected = root.selectedRow ? root.selectedRow.node : null
    var at = selected ? folder.children.indexOf(selected) : -1
    return at >= 0 ? at + 1 : null
  }

  function startNew(type) {
    if (!root.canEdit()) return
    if (!type) {
      typePicker.open(root.folderPath.length > 1 ? root.currentFolder.name : "")
      root.showPage("type")
    } else if (type === "separator") {
      var keep = root.selectedRow ? root.selectedRow.node : null
      TreeOps.add(root.currentFolder, Model.createNode("separator"), root.insertIndex(root.currentFolder))
      root.filterText = ""
      root.showPage("list")
      root.commit(keep, "Added a separator.")
    } else {
      root.editId = ""
      editor.open(Editing.emptyForm(type), true, "")
      root.showPage("editor")
    }
  }

  function startEdit(node) {
    if (!node || node.type === "separator" || !root.canEdit()) return
    root.editId = node.id
    var entry = node.type === "app" ? root.desktopEntryFor(node.desktopId) : null
    editor.open(Editing.formFor(node), false, entry ? entry.name : "")
    root.showPage("editor")
  }

  function saveEditor(form) {
    if (!root.canEdit()) return
    var node
    if (root.editId) {
      node = root.nodeById(root.editId)
      if (!node) {
        root.showPage("list")
        root.message = "That item was removed while you were editing it."
        return
      }
      Editing.applyForm(node, form)
    } else {
      node = Editing.createFromForm(form)
      TreeOps.add(root.currentFolder, node, root.insertIndex(root.currentFolder))
      root.filterText = ""   // show the new item where it was added
    }
    root.showPage("list")
    root.commit(node, (root.editId ? "Saved “" : "Added “") + node.name + "”.")
  }

  function startIcon(node) {
    if (!node || node.type === "separator" || !root.canEdit()) return
    root.editId = node.id
    iconPage.open(node)
    root.showPage("icon")
  }

  // Image files are copied into <config>/icons first, so the icon survives the original moving.
  function saveIcon(icon) {
    var node = root.nodeById(root.editId)
    if (!node || !root.canEdit()) return root.showPage("list")
    var source = icon && icon.kind === "file" ? EnvExpander.expand(icon.value, root.env) : ""
    if (source && !Editing.isInIconsDir(store.configDir, source)) {
      var target = Editing.iconCopyPath(store.configDir, node.id, source)
      iconCopy.onDone = function(ok) {
        if (ok) root.finishIcon(node, { kind: "file", value: target })
        else root.message = "Couldn't copy " + source + " into " + store.configDir + "/icons."
      }
      iconCopy.command = ["install", "-D", "-m", "0644", "-T", "--", source, target]
      iconCopy.running = true
      root.showPage("list")
      return
    }
    root.showPage("list")
    root.finishIcon(node, icon)
  }

  function finishIcon(node, icon) {
    var old = Editing.ownedIconFile(store.configDir, node)
    node.icon = icon
    if (old && !(icon && icon.kind === "file" && icon.value === old))
      Quickshell.execDetached(["rm", "-f", "--", old])
    root.commit(node, icon ? "Changed the icon of “" + node.name + "”." : "“" + node.name + "” uses its automatic icon again.")
  }

  function askDelete(node) {
    if (!node || !root.canEdit()) return
    root.pendingDelete = node
  }

  function deleteNode(node) {
    var at = root.selectedIndex
    var files = Editing.ownedIconFiles(store.configDir, node)
    if (!TreeOps.remove(store.config.root, node)) return
    if (files.length > 0) Quickshell.execDetached(["rm", "-f", "--"].concat(files))
    if (root.cutId && !root.nodeById(root.cutId)) root.cutId = ""
    root.commit(null, node.type === "separator" ? "Deleted a separator." : "Deleted “" + node.name + "”.")
    root.select(root.nearestSelectable(at))
  }

  function nearestSelectable(index) {
    for (var i = Math.min(index, root.rows.length - 1); i >= 0; i--) if (Listing.isSelectable(root.rows, i)) return i
    return Listing.firstSelectable(root.rows)
  }

  function move(node, direction) {
    if (!node || !root.canEdit()) return
    if (root.searching) {
      root.message = "Clear the search to reorder items."
      return
    }
    var moved = direction < 0 ? TreeOps.moveUp(store.config.root, node) : TreeOps.moveDown(store.config.root, node)
    if (moved) root.commit(node)
  }

  function cut(node) {
    if (!node || !root.canEdit()) return
    root.cutId = node.id
    root.inform("Cut “" + (node.name || "separator") + "”. Open another folder and press Ctrl+V to move it there.")
  }

  function paste() {
    if (!root.canEdit()) return
    var node = root.nodeById(root.cutId)
    if (!node) {
      root.cutId = ""
      root.message = "Nothing to paste. Select an item and press Ctrl+X first."
      return
    }
    if (root.searching) {
      root.message = "Clear the search and open the folder to move “" + node.name + "” into."
      return
    }
    var result = TreeOps.moveTo(store.config.root, node, root.currentFolder)
    if (result === TreeOps.REJECTED) root.message = "A folder can't go inside itself."
    else if (result === TreeOps.NO_OP) root.message = "“" + node.name + "” is already in this folder."
    else {
      root.cutId = ""
      root.commit(node, "Moved “" + node.name + "” here.")
    }
  }

  function duplicate(node) {
    if (!node || !root.canEdit()) return
    var clone = TreeOps.duplicate(store.config.root, node)
    if (!clone) return
    Editing.iconCopiesForDuplicate(store.configDir, node, clone).forEach(function(copy) {
      Quickshell.execDetached(["cp", "-f", "--", copy.from, copy.to])
    })
    root.commit(clone, "Duplicated “" + node.name + "”.")
  }

  function changeSetting(key, value) {
    if (!root.canEdit()) return
    store.setSetting(key, value)
  }

  // Browse…: the portal file chooser is an ordinary window, so the panel steps aside while it's open.
  function browse(field, directory, title, extensions) {
    root.browseFor = field
    var argv = ["omarchy-file-select", "--title", title || (directory ? "Choose a folder" : "Choose a file")]
    if (directory) argv.push("--directory")
    if (extensions) argv.push("--extensions", extensions)
    chooser.command = argv
    chooser.running = true
  }

  function browsed(text) {
    var path = String(text || "").split("\n")[0]
    if (!path) return
    if (root.browseFor === "icon") iconPage.setFile(path)
    else if (root.browseFor === "bookmarksHtml") root.importHtmlFile(path)
    else if (root.browseFor === "config") root.readConfigFile(path)
    else if (root.browseFor === "export") root.exportTo(path)
    else editor.setField(root.browseFor, root.tildePath(path))
  }

  // ---- reading files ----

  // Reads each path in turn and calls done(texts), with null for any that couldn't be read (or is
  // empty). Asynchronous, so a big bookmarks file never stalls the shell.
  function readFiles(paths, done) {
    root.readQueue.push({ paths: paths.slice(), texts: [], done: done })
    if (root.readQueue.length === 1) root.readNext()
  }

  function readNext() {
    var job = root.readQueue[0]
    if (!job) return
    if (job.texts.length === job.paths.length) {
      root.readQueue.shift()
      job.done(job.texts)
      root.readNext()
      return
    }
    reader.command = ["cat", "--", job.paths[job.texts.length]]
    reader.running = true
  }

  function readDone(text) {
    var job = root.readQueue[0]
    if (!job) return
    job.texts.push(text ? text : null)
    Qt.callLater(root.readNext)   // let the Process finish before it's started again
  }

  function baseName(path) {
    return String(path).substring(String(path).lastIndexOf("/") + 1)
  }

  // ---- import and export ----

  function startTransfer() {
    root.message = ""
    importPage.folderName = root.folderPath.length > 1 ? root.currentFolder.name : ""
    importPage.pendingConfig = null
    importPage.sources = null
    importPage.index = 0
    root.pendingImport = null
    root.showPage("transfer")
    var home = String(root.env("HOME") || "")
    var configHome = String(root.env("XDG_CONFIG_HOME") || "") || home + "/.config"
    var dirs = Bookmarks.userDataDirs(configHome, home)
    finder.dirs = dirs
    finder.command = Bookmarks.findCommand(dirs)
    finder.running = true
  }

  function foundBookmarkFiles(text) {
    var paths = String(text || "").split("\n").filter(function(p) { return p.length > 0 })
    var dirs = finder.dirs
    var localStates = paths.filter(function(p) { return root.baseName(p) === "Local State" })
    root.readFiles(localStates, function(texts) {
      var states = {}
      localStates.forEach(function(p, i) { states[p.substring(0, p.lastIndexOf("/"))] = texts[i] || "" })
      var sources = Bookmarks.sources(dirs, paths, states)
      // A re-import updates the folder from last time; show its current name.
      var previous = {}
      sources.forEach(function(s) {
        var folder = root.nodeById(Bookmarks.importedFolderId(s.sourceKey))
        if (folder && folder.type === "folder") previous[s.sourceKey] = folder.name
      })
      importPage.previousImports = previous
      importPage.sources = sources
      importPage.index = importPage.step(-1, 1)   // start on the first browser found
    })
  }

  function importSource(source) {
    if (!root.canEdit()) return
    root.readFiles(source.paths, function(texts) {
      if (texts.indexOf(null) >= 0) {
        root.message = "Couldn't read the bookmarks of " + source.displayName + "."
        return
      }
      root.addBookmarks(Bookmarks.parseChromium(texts, source.displayName + " bookmarks"), source.sourceKey, source.displayName)
    })
  }

  function importHtmlFile(path) {
    if (!root.canEdit()) return
    root.readFiles([path], function(texts) {
      if (texts[0] === null) {
        root.message = "Couldn't read " + path + "."
        return
      }
      root.addBookmarks(Bookmarks.parseNetscape(texts[0], "Bookmarks (" + root.baseName(path) + ")"),
                        Bookmarks.htmlSourceKey(path), root.baseName(path))
    })
  }

  function addBookmarks(parsed, sourceKey, from) {
    if (!parsed.ok) {
      root.message = parsed.error
      return
    }
    if (parsed.folder.children.length === 0) {
      root.message = "No bookmarks found in " + from + "."
      return
    }
    var result = Bookmarks.apply(store.config.root, root.currentFolder, parsed.folder, sourceKey)
    root.filterText = ""
    root.showPage("list")
    root.commit(result.folder, (result.replaced ? "Updated “" + result.folder.name + "” with " : "Imported ")
      + result.count + (result.count === 1 ? " bookmark" : " bookmarks") + " from " + from + ".")
  }

  function readConfigFile(path) {
    if (!root.canEdit()) return
    root.readFiles([path], function(texts) {
      var result = texts[0] === null ? { ok: false, error: "it can't be read." } : ConfigSerializer.deserialize(texts[0])
      if (!result.ok) {
        root.message = root.baseName(path) + ": " + result.error
        return
      }
      root.pendingImport = result
      importPage.pendingConfig = {
        fileName: root.baseName(path),
        count: TreeOps.countDescendants(result.config.root),
        notes: ConfigSerializer.collectNotes(result.config.root).length
      }
    })
  }

  // Merge appends the imported top level after yours (ids that clash get new ones); replace swaps the
  // whole tree but keeps your settings. Either way you land at the top level.
  function finishConfigImport(replace) {
    var imported = root.pendingImport
    root.pendingImport = null
    if (!imported || !root.canEdit()) return
    var count = TreeOps.countDescendants(imported.config.root)
    if (replace) store.config.root = imported.config.root
    else TreeOps.merge(store.config.root, imported.config.root)
    if (root.cutId && !root.nodeById(root.cutId)) root.cutId = ""
    root.folderPath = [store.config.root]
    root.filterText = ""
    root.showPage("list")
    root.commit(null, (replace ? "Replaced your launcher with " : "Added ") + count + (count === 1 ? " item." : " items."))
  }

  function exportTo(directory) {
    var d = new Date()
    function two(n) { return (n < 10 ? "0" : "") + n }
    exportFile.path = directory + "/youromalauncher-config-" + d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate()) + ".json"
    exportFile.setText(ConfigSerializer.serialize(store.config))
  }

  // /home/me/x → ~/x, which keeps the config usable under another user name.
  function tildePath(path) {
    var home = String(root.env("HOME") || "")
    if (!home) return path
    if (path === home) return "~"
    return path.indexOf(home + "/") === 0 ? "~" + path.substring(home.length) : path
  }

  // ---- context menu ----

  function menuItemsFor(node) {
    var items = []
    var editable = !store.readOnly
    if (node && node.type !== "separator") {
      items.push({ action: "open", label: node.type === "folder" ? "Open folder" : "Open", shortcut: "↵" })
      if (root.searching) items.push({ action: "reveal", label: "Show in folder", shortcut: "Ctrl+↵" })
      items.push({ action: "edit", label: "Edit…", shortcut: "F2", enabled: editable, separatorBefore: true })
      items.push({ action: "icon", label: "Change icon…", shortcut: "Ctrl+I", enabled: editable })
      items.push({ action: "duplicate", label: "Duplicate", shortcut: "Ctrl+D", enabled: editable })
      items.push({ action: "cut", label: "Cut", shortcut: "Ctrl+X", enabled: editable })
    }
    if (node && !root.searching) {
      items.push({ action: "up", label: "Move up", shortcut: "Ctrl+↑", enabled: editable, separatorBefore: node.type !== "separator" })
      items.push({ action: "down", label: "Move down", shortcut: "Ctrl+↓", enabled: editable })
    }
    items.push({ action: "paste", label: "Paste here", shortcut: "Ctrl+V", separatorBefore: items.length > 0,
                 enabled: editable && !root.searching && !!root.nodeById(root.cutId) })
    items.push({ action: "new", label: "New item…", shortcut: "Ctrl+N", enabled: editable })
    items.push({ action: "newFolder", label: "New folder…", shortcut: "Ctrl+Shift+N", enabled: editable })
    if (node) items.push({ action: "delete", label: "Delete…", shortcut: "Del", enabled: editable, destructive: true, separatorBefore: true })
    items.push({ action: "settings", label: "Settings", shortcut: "Ctrl+,", separatorBefore: true })
    items.push({ action: "transfer", label: "Import and export…" })
    return items
  }

  // `at` is a point in the card; without one (Menu key) the menu opens under the selected row.
  function openMenu(node, at) {
    menu.items = root.menuItemsFor(node)
    root.menuNode = node
    if (!at) {
      var item = root.selectedIndex >= 0 ? list.itemAtIndex(root.selectedIndex) : null
      at = item ? item.mapToItem(card, Style.space(48), item.height) : Qt.point(card.width / 3, card.height / 3)
    }
    menu.x = Math.max(Style.space(4), Math.min(at.x, card.width - menu.width - Style.space(4)))
    menu.y = Math.max(Style.space(4), Math.min(at.y, card.height - menu.height - Style.space(4)))
    root.menuOpen = true
    Qt.callLater(root.refocus)
  }

  function closeMenu() {
    root.menuOpen = false
    Qt.callLater(root.refocus)
  }

  function menuChosen(action) {
    var node = root.menuNode
    root.closeMenu()
    if (action === "open") root.activate(root.selectedRow && root.selectedRow.node === node ? root.selectedRow : Listing.rowFor(node, null, null))
    else if (action === "reveal") root.revealSelected()
    else if (action === "edit") root.startEdit(node)
    else if (action === "icon") root.startIcon(node)
    else if (action === "duplicate") root.duplicate(node)
    else if (action === "cut") root.cut(node)
    else if (action === "up") root.move(node, -1)
    else if (action === "down") root.move(node, 1)
    else if (action === "paste") root.paste()
    else if (action === "new") root.startNew(null)
    else if (action === "newFolder") root.startNew("folder")
    else if (action === "delete") root.askDelete(node)
    else if (action === "settings") root.showPage("settings")
    else if (action === "transfer") root.startTransfer()
  }

  // ---- keyboard ----

  function handleKey(event) {
    var ctrl = (event.modifiers & Qt.ControlModifier) !== 0
    var shift = (event.modifiers & Qt.ShiftModifier) !== 0
    var key = event.key

    if (root.pendingLaunch || root.pendingDelete) {
      if (!confirm.handleKey(event)) return false
      return true
    }

    var selected = root.selectedRow ? root.selectedRow.node : null
    if (key === Qt.Key_Menu || (shift && key === Qt.Key_F10)) {
      root.openMenu(selected, null)
      return true
    }
    if (ctrl) {
      if (key === Qt.Key_N) root.startNew(shift ? "folder" : null)
      else if (key === Qt.Key_Up) root.move(selected, -1)
      else if (key === Qt.Key_Down) root.move(selected, 1)
      else if (key === Qt.Key_X) root.cut(selected)
      else if (key === Qt.Key_V) root.paste()
      else if (key === Qt.Key_D) root.duplicate(selected)
      else if (key === Qt.Key_I) root.startIcon(selected)
      else if (key === Qt.Key_Comma) root.showPage("settings")
      else key = 0
      if (key !== 0) return true
      key = event.key
    }
    if (key === Qt.Key_F2) {
      root.startEdit(selected)
      return true
    }
    if (key === Qt.Key_Delete) {
      root.askDelete(selected)
      return true
    }

    if (key === Qt.Key_Escape) {
      if (root.searching || root.filterText) root.setFilter("")
      else root.close()
    } else if (ctrl && key === Qt.Key_R) {
      if (shift && store.readOnly) store.restoreBackup()
      else store.reload()
      root.message = ""
    } else if (key === Qt.Key_Up) {
      root.select(Listing.step(root.rows, root.selectedIndex, -1, true))
    } else if (key === Qt.Key_Down) {
      root.select(Listing.step(root.rows, root.selectedIndex, 1, true))
    } else if (key === Qt.Key_PageUp) {
      root.select(Listing.step(root.rows, root.selectedIndex, -root.visibleRowCount, false))
    } else if (key === Qt.Key_PageDown) {
      root.select(Listing.step(root.rows, root.selectedIndex, root.visibleRowCount, false))
    } else if (key === Qt.Key_Home) {
      root.select(Listing.firstSelectable(root.rows))
    } else if (key === Qt.Key_End) {
      root.select(Listing.lastSelectable(root.rows))
    } else if (key === Qt.Key_Return || key === Qt.Key_Enter) {
      if (ctrl && root.searching) root.revealSelected()
      else root.activate(root.selectedRow)
    } else if (!root.searching && (key === Qt.Key_Right || key === Qt.Key_Tab)) {
      if (root.selectedRow && root.selectedRow.node.type === "folder") root.activate(root.selectedRow)
    } else if (!root.filterText && (key === Qt.Key_Left || key === Qt.Key_Backspace)) {
      root.goUp()
    } else if (Util.editsFilter(event, root.filterText)) {
      root.setFilter(Util.editedFilter(event, root.filterText))
    } else if (!ctrl && event.text && event.text.length === 1 && event.text.charCodeAt(0) >= 32 && event.text.charCodeAt(0) !== 127) {
      // A leading space would only mean "search for nothing"; ignore it.
      if (root.filterText || event.text !== " ") root.setFilter(root.filterText + event.text)
    } else {
      return key === Qt.Key_Tab || key === Qt.Key_Backtab   // never let Tab move focus away
    }
    return true
  }

  // ---- status line ----

  readonly property string statusText: {
    if (store.error) return store.error
    if (root.message) return root.message
    if (root.selectedRow && root.selectedRow.reviewNote) return root.selectedRow.reviewNote
    if (!root.searching && root.folderPath.length === 1 && store.notes.length > 0)
      return store.notes.length + (store.notes.length === 1 ? " item needs" : " items need") +
        " a look after the move from Windows (marked " + Listing.GLYPHS.warning + ")."
    return ""
  }
  readonly property bool statusIsWarning: store.error.length > 0 || (root.message.length > 0 && !root.messageIsInfo)
    || (!root.message && root.selectedRow !== null && !!root.selectedRow.reviewNote)

  readonly property string hintText: {
    if (store.readOnly) return "Ctrl+R reload   Ctrl+Shift+R restore backup   Esc close"
    if (root.searching) return "↵ open   Ctrl+↵ show in folder   F2 edit   Menu more   Esc clear"
    return "↵ open   → enter   ← back   Ctrl+N add   F2 edit   Menu more   Esc close"
  }

  ConfigStore {
    id: store
    onConfigReplaced: root.onConfigReplaced()
  }

  // The file chooser for Browse…; prints the chosen path, or nothing when canceled.
  Process {
    id: chooser
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.browsed(text)
    }
    onRunningChanged: if (!running) Qt.callLater(root.refocus)
  }

  // Lists browser bookmark files (Bookmarks.findCommand); missing browsers only complain on stderr.
  Process {
    id: finder
    property var dirs: []
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.foundBookmarkFiles(text)
    }
  }

  Process {
    id: reader
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.readDone(text)
    }
  }

  FileView {
    id: exportFile
    blockLoading: false
    atomicWrites: true
    printErrors: false
    onSaved: {
      root.message = ""
      root.inform("Exported to " + root.tildePath(path) + ".")
    }
    onSaveFailed: function(err) { root.message = "Couldn't export to " + path + ": " + FileViewError.toString(err) }
  }

  Process {
    id: iconCopy
    property var onDone: null
    onExited: function(code) { if (onDone) onDone(code === 0) }
  }

  FontMetrics {
    id: secondaryMetrics
    font.family: root.fontFamily
    font.pixelSize: Style.font.bodySmall
  }

  // ---- UI ----

  PanelWindow {
    id: panel
    visible: root.opened && !chooser.running
    screen: root.targetScreen
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "youromalauncher"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Rectangle {
      anchors.fill: parent
      color: root.scrim
    }

    // A click outside closes the launcher, but never throws away a half-filled form.
    MouseArea {
      anchors.fill: parent
      onClicked: {
        if (root.menuOpen) root.closeMenu()
        else if (root.page === "list") root.close()
      }
    }

    BorderSurface {
      id: card
      width: root.cardWidth
      // Tall enough for the confirmation dialog even when the list is short.
      height: Math.max(card.contentTopInset + card.contentBottomInset + content.implicitHeight,
                       root.pendingLaunch || root.pendingDelete ? Style.space(200) : 0)
      radius: root.cornerRadius
      anchors.horizontalCenter: parent.horizontalCenter
      // The top edge stays put while the list grows and shrinks with typing: it sits where a full
      // list would be centered on the upper third.
      y: {
        var full = card.contentTopInset + card.contentBottomInset + root.headerHeight + root.visibleRowCount * root.rowHeight
          + root.rowHeight * 2 + root.contentSpacing * 3
        return Math.max(Style.gapsOut, Math.round(parent.height / 3 - full / 2))
      }
      color: root.background
      borderSpec: root.borderSpec
      padding: root.contentMargin

      MouseArea { anchors.fill: parent; onClicked: {} }

      Item {
        id: keyCatcher
        anchors.fill: parent
        z: root.pendingLaunch || root.pendingDelete ? 20 : 0
        focus: true

        Keys.priority: Keys.BeforeItem
        Keys.onPressed: function(event) {
          if (root.handleKey(event)) event.accepted = true
        }

        ConfirmDialog {
          id: confirm
          anchors.fill: parent
          opened: root.pendingLaunch !== null || root.pendingDelete !== null
          z: 10
          message: root.pendingLaunch ? "Launch “" + root.pendingLaunch.name + "”?"
            : root.pendingDelete ? Editing.deletePrompt(root.pendingDelete) : ""
          confirmText: root.pendingDelete ? "Delete" : "Launch"
          selectedIndex: 1
          // Enter launches, but never deletes: for a delete, Cancel is the default.
          background: root.background
          foreground: root.foreground
          scrim: root.scrim
          selectedBackground: root.selectedBackground
          selectedText: root.selectedText
          fontFamily: root.fontFamily
          cornerRadius: root.cornerRadius
          onOpenedChanged: if (opened) selectedIndex = root.pendingDelete ? 0 : 1
          onCanceled: {
            root.pendingLaunch = null
            root.pendingDelete = null
          }
          onConfirmed: {
            var node = root.pendingLaunch
            var doomed = root.pendingDelete
            root.pendingLaunch = null
            root.pendingDelete = null
            if (node) root.launch(node)
            if (doomed) root.deleteNode(doomed)
          }
        }
      }

      Column {
        id: content
        x: card.contentLeftInset
        y: card.contentTopInset
        width: card.width - card.contentLeftInset - card.contentRightInset
        spacing: root.contentSpacing

        // Search text, or a placeholder; the folder path on the right.
        Item {
          width: parent.width
          height: root.headerHeight
          visible: root.page === "list"

          Text {
            id: breadcrumbText
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            width: Math.min(implicitWidth, parent.width * 0.45)
            visible: !root.searching && text.length > 0
            textFormat: Text.PlainText
            text: Listing.breadcrumb(root.folderPath)
            color: root.muted
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            elide: Text.ElideLeft
          }

          Text {
            anchors.left: parent.left
            anchors.right: breadcrumbText.visible ? breadcrumbText.left : parent.right
            anchors.rightMargin: breadcrumbText.visible ? Style.space(12) : 0
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: root.filterText || "Search…"
            color: root.foreground
            opacity: root.filterText ? 1 : 0.58
            font.family: root.fontFamily
            font.pixelSize: Style.font.heading
            elide: Text.ElideLeft
          }
        }

        Item {
          id: listArea
          width: parent.width
          visible: root.page === "list"
          height: root.rows.length === 0 ? root.rowHeight * 3 : Math.min(list.contentHeight, root.visibleRowCount * root.rowHeight)

          // Right-click on empty space: the folder's own menu (new item, paste, settings).
          MouseArea {
            anchors.fill: parent
            acceptedButtons: Qt.RightButton
            onClicked: function(mouse) { root.openMenu(null, mapToItem(card, mouse.x, mouse.y)) }
          }

          ListView {
            id: list
            anchors.fill: parent
            model: root.rows
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            interactive: contentHeight > height

            delegate: Item {
              id: rowItem
              required property int index
              required property var modelData
              readonly property bool selected: index === root.selectedIndex
              width: list.width
              height: modelData.separator ? root.separatorHeight : root.rowHeight
              opacity: root.cutId && modelData.node.id === root.cutId ? 0.45 : 1

              Rectangle {
                visible: rowItem.modelData.separator
                anchors.verticalCenter: parent.verticalCenter
                x: Style.space(12)
                width: parent.width - Style.space(24)
                height: Math.max(1, Style.normalBorderWidth)
                color: root.foreground
                opacity: 0.15
              }

              Rectangle {
                visible: !rowItem.modelData.separator
                anchors.fill: parent
                radius: root.cornerRadius
                color: rowItem.selected ? root.selectedBackground : "transparent"
              }

              NodeIcon {
                id: icon
                visible: !rowItem.modelData.separator
                node: rowItem.modelData.node
                size: root.iconSize
                color: rowItem.selected ? root.selectedText : root.foreground
                fontFamily: root.fontFamily
                env: root.env
                anchors.left: parent.left
                anchors.leftMargin: Style.space(10)
                anchors.verticalCenter: parent.verticalCenter
              }

              Text {
                id: nameText
                visible: !rowItem.modelData.separator
                anchors.left: icon.right
                anchors.leftMargin: Style.space(10)
                anchors.verticalCenter: parent.verticalCenter
                // The name has priority; the secondary text gets what's left.
                width: Math.min(implicitWidth, rowItem.width - icon.width - Style.space(40))
                textFormat: Text.StyledText
                text: Listing.highlight(rowItem.modelData.node.name, rowItem.modelData.positions, root.selectedText)
                color: rowItem.selected ? root.selectedText : root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.subtitle
                elide: Text.ElideRight
              }

              Text {
                id: noteMark
                visible: !rowItem.modelData.separator && !!rowItem.modelData.reviewNote
                anchors.left: nameText.right
                anchors.leftMargin: Style.space(6)
                anchors.verticalCenter: parent.verticalCenter
                text: Listing.GLYPHS.warning
                color: root.warning
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
              }

              Text {
                id: secondaryText
                visible: !rowItem.modelData.separator
                anchors.left: noteMark.visible ? noteMark.right : nameText.right
                anchors.leftMargin: Style.space(16)
                anchors.right: parent.right
                anchors.rightMargin: Style.space(12)
                anchors.verticalCenter: parent.verticalCenter
                horizontalAlignment: Text.AlignRight
                textFormat: Text.PlainText
                // Folder paths lose whole leading folders first, so the most specific part stays.
                text: rowItem.modelData.result
                  ? PathTrimmer.trimStart(rowItem.modelData.secondary, width, function(s) { return secondaryMetrics.advanceWidth(s) })
                  : rowItem.modelData.secondary
                color: root.muted
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                elide: Text.ElideRight
              }

              // Separators can't be selected, so right-clicking one is how to move or delete it.
              MouseArea {
                anchors.fill: parent
                acceptedButtons: Qt.LeftButton | Qt.RightButton
                onClicked: function(mouse) {
                  if (!rowItem.modelData.separator) root.select(rowItem.index)
                  if (mouse.button === Qt.RightButton)
                    root.openMenu(rowItem.modelData.node, mapToItem(card, mouse.x, mouse.y))
                }
                onDoubleClicked: function(mouse) {
                  if (rowItem.modelData.separator || mouse.button !== Qt.LeftButton) return
                  root.select(rowItem.index)
                  root.activate(rowItem.modelData)
                }
              }
            }
          }

          Column {
            anchors.centerIn: parent
            width: parent.width
            spacing: Style.space(6)
            visible: root.rows.length === 0 && store.loaded

            Text {
              width: parent.width
              horizontalAlignment: Text.AlignHCenter
              textFormat: Text.PlainText
              text: root.searching ? "No matches for “" + root.filterText.trim() + "”"
                : store.readOnly ? "Your config file needs fixing"
                : root.folderPath.length === 1 ? "Your launcher is empty" : "This folder is empty. Ctrl+N adds an item."
              color: root.foreground
              opacity: 0.75
              font.family: root.fontFamily
              font.pixelSize: Style.font.title
            }

            Text {
              width: parent.width
              visible: !root.searching && root.folderPath.length === 1
              horizontalAlignment: Text.AlignHCenter
              wrapMode: Text.Wrap
              textFormat: Text.PlainText
              text: store.readOnly
                ? "Fix " + store.configPath + " and it reloads by itself, or restore the backup."
                : "Press Ctrl+N to add your first item, or edit " + store.configPath + "."
              color: root.muted
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
            }
          }
        }

        TypePicker {
          id: typePicker
          width: parent.width
          visible: root.page === "type"
          onPicked: function(type) { root.startNew(type) }
          onCanceled: root.showPage("list")
        }

        EditorPage {
          id: editor
          width: parent.width
          visible: root.page === "editor"
          onSaveRequested: function(form) { root.saveEditor(form) }
          onCanceled: root.showPage("list")
          onBrowseRequested: function(field, directory) { root.browse(field, directory) }
          onChooseAppRequested: {
            appPicker.open(editor.form.desktopId)
            root.showPage("apps")
          }
        }

        AppPicker {
          id: appPicker
          width: parent.width
          visible: root.page === "apps"
          onPicked: function(desktopId, name) {
            editor.setApp(desktopId, name)
            root.showPage("editor")
          }
          onCanceled: root.showPage("editor")
        }

        IconPage {
          id: iconPage
          width: parent.width
          visible: root.page === "icon"
          env: root.env
          onSaveRequested: function(icon) { root.saveIcon(icon) }
          onCanceled: root.showPage("list")
          onBrowseRequested: root.browse("icon", false, "Choose an image", "png svg jpg jpeg webp")
        }

        SettingsPage {
          id: settingsPage
          width: parent.width
          visible: root.page === "settings"
          settings: root.settings
          configPath: store.configPath
          onChanged: function(key, value) { root.changeSetting(key, value) }
          onClosed: root.showPage("list")
          onImportExportRequested: root.startTransfer()
          onOpenConfigRequested: {
            Quickshell.execDetached(["uwsm-app", "--", "omarchy-launch-editor", store.configPath])
            root.close()
          }
        }

        ImportPage {
          id: importPage
          width: parent.width
          visible: root.page === "transfer"
          onImportSource: function(source) { root.importSource(source) }
          onImportHtml: root.browse("bookmarksHtml", false, "Choose a bookmarks file", "html htm")
          onImportConfig: root.browse("config", false, "Choose a launcher config file", "json")
          onExportConfig: root.browse("export", true, "Choose where to save the export")
          onMergeConfig: root.finishConfigImport(false)
          onReplaceConfig: root.finishConfigImport(true)
          onClosed: root.showPage("list")
        }

        Text {
          width: parent.width
          visible: root.statusText.length > 0 && (root.page === "list" || root.page === "transfer" || store.readOnly)
          textFormat: Text.PlainText
          text: root.statusText
          wrapMode: Text.Wrap
          maximumLineCount: 3
          elide: Text.ElideRight
          color: root.statusIsWarning ? root.warning : root.muted
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
        }

        Text {
          width: parent.width
          visible: root.settings.showHintBar && root.page === "list"
          textFormat: Text.PlainText
          text: root.hintText
          color: root.muted
          opacity: 0.8
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          elide: Text.ElideRight
        }
      }

      MouseArea {
        anchors.fill: parent
        z: 29
        visible: root.menuOpen
        acceptedButtons: Qt.LeftButton | Qt.RightButton
        onClicked: root.closeMenu()
      }

      ContextMenu {
        id: menu
        z: 30
        visible: root.menuOpen
        onChosen: function(action) { root.menuChosen(action) }
        onClosed: root.closeMenu()
      }
    }
  }
}
