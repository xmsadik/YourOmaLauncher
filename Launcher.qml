import Quickshell
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

// The launcher panel. Two modes:
// - nav: the search text is empty; the list is the current folder (folders first).
// - search: the list is ranked results from the whole tree, each with its folder path.
// Keyboard behavior follows the Windows app's spec §6.1/§6.2; see the hint bar and README.
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
  property var pendingLaunch: null     // node waiting for "Launch?" confirmation
  property var searchIndex: null       // rebuilt lazily after the tree changes
  property var usageScores: ({})
  property var pendingLocation: null   // folder ids to open once the config has loaded

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

  // ---- lifecycle ----

  function open(payloadJson) {
    root.opened = true
    root.filterText = ""
    root.message = ""
    root.pendingLaunch = null
    root.usageScores = store.usageScores()
    // The config usually arrives just after open(); until then only remember where to go.
    var ids = store.loaded && !root.settings.rememberLastLocation ? [] : store.lastLocation()
    if (store.loaded) root.folderPath = root.pathFromIds(root.settings.rememberLastLocation ? ids : [])
    else root.pendingLocation = ids
    root.refresh(null)
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function close() {
    if (root.settings.rememberLastLocation && !store.readOnly)
      store.setLastLocation(root.folderPath.slice(1).map(function(f) { return f.id }))
    root.pendingLaunch = null
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
    else root.message = "Launched “" + node.name + "”."
  }

  // ---- keyboard ----

  function handleKey(event) {
    var ctrl = (event.modifiers & Qt.ControlModifier) !== 0
    var shift = (event.modifiers & Qt.ShiftModifier) !== 0
    var key = event.key

    if (root.pendingLaunch) {
      if (!confirm.handleKey(event)) return false
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
  readonly property bool statusIsWarning: store.error.length > 0 || (root.message.length > 0 && root.message.indexOf("Launched") !== 0)
    || (!root.message && root.selectedRow !== null && !!root.selectedRow.reviewNote)

  readonly property string hintText: {
    if (store.readOnly) return "Ctrl+R reload   Ctrl+Shift+R restore backup   Esc close"
    if (root.searching) return "↵ open   Ctrl+↵ show in folder   ↑↓ select   Esc clear"
    return "↵ open   → enter   ← back   type to search   Esc close"
  }

  ConfigStore {
    id: store
    onConfigReplaced: root.onConfigReplaced()
  }

  FontMetrics {
    id: secondaryMetrics
    font.family: root.fontFamily
    font.pixelSize: Style.font.bodySmall
  }

  // ---- UI ----

  PanelWindow {
    id: panel
    visible: root.opened
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

    MouseArea {
      anchors.fill: parent
      onClicked: root.close()
    }

    BorderSurface {
      id: card
      width: root.cardWidth
      // Tall enough for the confirmation dialog even when the list is short.
      height: Math.max(card.contentTopInset + card.contentBottomInset + content.implicitHeight,
                       root.pendingLaunch ? Style.space(200) : 0)
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
        z: root.pendingLaunch ? 20 : 0
        focus: true

        Keys.priority: Keys.BeforeItem
        Keys.onPressed: function(event) {
          if (root.handleKey(event)) event.accepted = true
        }

        ConfirmDialog {
          id: confirm
          anchors.fill: parent
          opened: root.pendingLaunch !== null
          z: 10
          message: root.pendingLaunch ? "Launch “" + root.pendingLaunch.name + "”?" : ""
          confirmText: "Launch"
          selectedIndex: 1
          background: root.background
          foreground: root.foreground
          scrim: root.scrim
          selectedBackground: root.selectedBackground
          selectedText: root.selectedText
          fontFamily: root.fontFamily
          cornerRadius: root.cornerRadius
          onOpenedChanged: if (opened) selectedIndex = 1
          onCanceled: root.pendingLaunch = null
          onConfirmed: {
            var node = root.pendingLaunch
            root.pendingLaunch = null
            if (node) root.launch(node)
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
          height: root.rows.length === 0 ? root.rowHeight * 3 : Math.min(list.contentHeight, root.visibleRowCount * root.rowHeight)

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

              MouseArea {
                anchors.fill: parent
                enabled: !rowItem.modelData.separator
                onClicked: root.select(rowItem.index)
                onDoubleClicked: {
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
                : root.folderPath.length === 1 ? "Your launcher is empty" : "This folder is empty"
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
              text: "Add items to " + store.configPath + " (see config.example.json in the plugin folder)."
              color: root.muted
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
            }
          }
        }

        Text {
          width: parent.width
          visible: root.statusText.length > 0
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
          visible: root.settings.showHintBar
          textFormat: Text.PlainText
          text: root.hintText
          color: root.muted
          opacity: 0.8
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          elide: Text.ElideRight
        }
      }
    }
  }
}
