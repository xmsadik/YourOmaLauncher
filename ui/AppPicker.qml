import Quickshell
import QtQuick
import qs.Commons
import qs.Ui
import "../lib/TextNormalizer.js" as TextNormalizer

// Choose an installed app (a .desktop entry). Type to filter, ↑↓ to move, Enter to pick, Esc back.
FocusScope {
  id: root

  property string currentId: ""
  property int index: 0
  property var entries: []

  signal picked(string desktopId, string name)
  signal canceled()

  implicitHeight: column.implicitHeight

  function takeFocus() { search.forceActiveFocus() }

  function open(desktopId) {
    root.currentId = desktopId || ""
    search.text = ""
    root.refilter()
  }

  function entryIcon(entry) {
    var icon = entry && entry.icon ? String(entry.icon) : ""
    if (!icon) return ""
    return icon.charAt(0) === "/" ? Util.fileUrl(icon) : Quickshell.iconPath(icon, true)
  }

  function refilter() {
    var q = TextNormalizer.normalize(search.text).trim()
    var all = (DesktopEntries.applications.values || []).filter(function(e) { return e && !e.noDisplay })
    var out = all.filter(function(e) {
      if (!q) return true
      return TextNormalizer.normalize([e.name, e.genericName, e.id].join(" ")).indexOf(q) >= 0
    })
    out.sort(function(a, b) { return TextNormalizer.compareTurkish(a.name, b.name) })
    root.entries = out
    var at = 0
    for (var i = 0; i < out.length; i++) if (out[i].id === root.currentId) { at = i; break }
    root.index = q ? 0 : at
    list.positionViewAtIndex(root.index, ListView.Center)
  }

  Keys.onPressed: function(event) {
    if (event.key === Qt.Key_Escape) root.canceled()
    else if (event.key === Qt.Key_Up) root.index = Math.max(0, root.index - 1)
    else if (event.key === Qt.Key_Down) root.index = Math.min(root.entries.length - 1, root.index + 1)
    else if (event.key === Qt.Key_PageUp) root.index = Math.max(0, root.index - 8)
    else if (event.key === Qt.Key_PageDown) root.index = Math.min(root.entries.length - 1, root.index + 8)
    else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
      var e = root.entries[root.index]
      if (e) root.picked(e.id, e.name)
    } else return
    list.positionViewAtIndex(root.index, ListView.Contain)
    event.accepted = true
  }

  Column {
    id: column
    width: parent.width
    spacing: Style.spacing.md

    Text {
      text: "Choose an app"
      textFormat: Text.PlainText
      color: Color.menu.text
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.heading
    }

    TextField {
      id: search
      width: parent.width
      placeholderText: "Filter installed apps…"
      foreground: Color.menu.text
      accent: Color.menu.selectedText
      font.family: Style.font.menuFamily
      onTextChanged: root.refilter()
      onAccepted: {
        var e = root.entries[root.index]
        if (e) root.picked(e.id, e.name)
      }
    }

    ListView {
      id: list
      width: parent.width
      height: Math.max(Style.space(38), Style.font.subtitle + Style.space(16)) * 8
      clip: true
      model: root.entries
      boundsBehavior: Flickable.StopAtBounds

      delegate: Rectangle {
        id: row
        required property var modelData
        required property int index
        readonly property bool selected: row.index === root.index
        width: list.width
        height: Math.max(Style.space(38), Style.font.subtitle + Style.space(16))
        radius: Style.cornerRadius
        color: selected ? Color.menu.selectedBackground : "transparent"

        Image {
          id: icon
          anchors.left: parent.left
          anchors.leftMargin: Style.space(10)
          anchors.verticalCenter: parent.verticalCenter
          width: Math.round(Style.font.subtitle * 1.6)
          height: width
          sourceSize.width: width * 2
          sourceSize.height: height * 2
          source: root.entryIcon(row.modelData)
          asynchronous: true
          fillMode: Image.PreserveAspectFit
        }

        Text {
          id: name
          anchors.left: icon.right
          anchors.leftMargin: Style.space(10)
          anchors.verticalCenter: parent.verticalCenter
          text: row.modelData.name
          textFormat: Text.PlainText
          color: row.selected ? Color.menu.selectedText : Color.menu.text
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.subtitle
        }

        Text {
          anchors.left: name.right
          anchors.leftMargin: Style.space(12)
          anchors.right: parent.right
          anchors.rightMargin: Style.space(12)
          anchors.verticalCenter: parent.verticalCenter
          horizontalAlignment: Text.AlignRight
          elide: Text.ElideLeft
          text: row.modelData.id
          textFormat: Text.PlainText
          color: Util.alpha(Color.menu.text, 0.45)
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.bodySmall
        }

        MouseArea {
          anchors.fill: parent
          onClicked: root.index = row.index
          onDoubleClicked: root.picked(row.modelData.id, row.modelData.name)
        }
      }
    }

    Text {
      text: root.entries.length + " apps   ↑↓ choose   ↵ pick   Esc back"
      color: Util.alpha(Color.menu.text, 0.45)
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.caption
    }
  }
}
