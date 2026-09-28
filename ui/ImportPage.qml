import QtQuick
import qs.Commons

// Import and export. A list of actions, ↑↓ and Enter (or a click): each browser profile found with
// bookmarks, a bookmarks HTML file, a launcher config file, and exporting yours. After choosing a
// config file the list turns into its two ways in: merge or replace. Esc goes back a step.
FocusScope {
  id: root

  property string folderName: ""        // where bookmarks go; "" = the top level
  property var sources: []              // Bookmarks.sources(), or null while still looking
  property var previousImports: ({})    // sourceKey → name of the folder a re-import would update
  property var pendingConfig: null      // { fileName, count, notes } of a config file waiting for merge/replace
  property int index: 0

  signal importSource(var source)
  signal importHtml()
  signal importConfig()
  signal exportConfig()
  signal mergeConfig()
  signal replaceConfig()
  signal closed()

  implicitHeight: column.implicitHeight

  readonly property string where: root.folderName ? "“" + root.folderName + "”" : "the top level"

  // { header } rows are titles; the rest are { action, label, detail, source? }.
  readonly property var rows: {
    var out = []
    if (root.pendingConfig) {
      var c = root.pendingConfig
      out.push({ header: c.fileName + ": " + c.count + (c.count === 1 ? " item" : " items")
                 + (c.notes > 0 ? ", " + c.notes + " to look at after the move from Windows" : "") })
      out.push({ action: "merge", label: "Add to my launcher", detail: "Its items go after yours, at the top level." })
      out.push({ action: "replace", label: "Replace my launcher with it", detail: "Your settings stay. The current tree is kept in config.backup.json until your next change." })
      return out
    }
    out.push({ header: "Bookmarks, into " + root.where })
    if (root.sources === null) out.push({ action: "", label: "Looking for browsers…", detail: "" })
    else root.sources.forEach(function(s) {
      var previous = root.previousImports[s.sourceKey]
      out.push({ action: "source", source: s, label: s.displayName,
                 detail: previous ? "Updates “" + previous + "”" : "Adds a folder" })
    })
    out.push({ action: "html", label: "A bookmarks file (HTML)…", detail: "Firefox, Chrome and most browsers can export one" })
    out.push({ header: "Launcher config" })
    out.push({ action: "config", label: "Import a config file…", detail: "From this launcher or the Windows version" })
    out.push({ action: "export", label: "Export my config…", detail: "Saves a copy into a folder you choose" })
    return out
  }

  function takeFocus() {
    root.forceActiveFocus()
    if (!isAction(root.index)) root.index = step(-1, 1)
  }

  function isAction(i) { return i >= 0 && i < root.rows.length && !!root.rows[i].action }

  // The next action row from index (exclusive) in direction dir; stays put if there is none.
  function step(from, dir) {
    for (var i = from + dir; i >= 0 && i < root.rows.length; i += dir) if (isAction(i)) return i
    return root.index
  }

  function activate(row) {
    if (!row || !row.action) return
    if (row.action === "source") root.importSource(row.source)
    else if (row.action === "html") root.importHtml()
    else if (row.action === "config") root.importConfig()
    else if (row.action === "export") root.exportConfig()
    else if (row.action === "merge") root.mergeConfig()
    else if (row.action === "replace") root.replaceConfig()
  }

  onRowsChanged: if (!isAction(root.index)) root.index = step(-1, 1)

  Keys.onPressed: function(event) {
    if (event.key === Qt.Key_Escape) {
      if (root.pendingConfig) root.pendingConfig = null
      else root.closed()
    } else if (event.key === Qt.Key_Up) root.index = step(root.index, -1)
    else if (event.key === Qt.Key_Down || event.key === Qt.Key_Tab) root.index = step(root.index, 1)
    else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) root.activate(root.rows[root.index])
    else return
    event.accepted = true
  }

  Column {
    id: column
    width: parent.width
    spacing: Style.space(2)

    Text {
      text: "Import and export"
      textFormat: Text.PlainText
      color: Color.menu.text
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.heading
      bottomPadding: Style.spacing.md
    }

    Repeater {
      model: root.rows

      delegate: Item {
        id: row
        required property var modelData
        required property int index
        readonly property bool selected: row.index === root.index && !!row.modelData.action
        width: column.width
        height: row.modelData.header ? header.implicitHeight + Style.space(10)
          : Math.max(Style.space(34), Style.font.subtitle + Style.space(14))

        Text {
          id: header
          visible: !!row.modelData.header
          anchors.bottom: parent.bottom
          anchors.bottomMargin: Style.space(4)
          width: parent.width
          elide: Text.ElideRight
          text: row.modelData.header || ""
          textFormat: Text.PlainText
          color: Util.alpha(Color.menu.text, 0.55)
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.caption
          font.bold: true
        }

        Rectangle {
          visible: !row.modelData.header
          anchors.fill: parent
          radius: Style.cornerRadius
          color: row.selected ? Color.menu.selectedBackground : "transparent"

          Text {
            id: label
            anchors.left: parent.left
            anchors.leftMargin: Style.space(10)
            anchors.verticalCenter: parent.verticalCenter
            text: row.modelData.label || ""
            textFormat: Text.PlainText
            color: row.selected ? Color.menu.selectedText : Color.menu.text
            opacity: row.modelData.action ? 1 : 0.6
            font.family: Style.font.menuFamily
            font.pixelSize: Style.font.subtitle
          }

          Text {
            anchors.left: label.right
            anchors.leftMargin: Style.space(16)
            anchors.right: parent.right
            anchors.rightMargin: Style.space(12)
            anchors.verticalCenter: parent.verticalCenter
            horizontalAlignment: Text.AlignRight
            elide: Text.ElideRight
            text: row.modelData.detail || ""
            textFormat: Text.PlainText
            color: Util.alpha(Color.menu.text, 0.45)
            font.family: Style.font.menuFamily
            font.pixelSize: Style.font.bodySmall
          }

          MouseArea {
            anchors.fill: parent
            enabled: !!row.modelData.action
            onClicked: {
              root.index = row.index
              root.activate(row.modelData)
            }
          }
        }
      }
    }

    Text {
      topPadding: Style.spacing.md
      text: root.pendingConfig ? "↑↓ choose   ↵ do it   Esc back" : "↑↓ choose   ↵ open   Esc back"
      color: Util.alpha(Color.menu.text, 0.45)
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.caption
    }
  }
}
