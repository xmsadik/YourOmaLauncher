import QtQuick
import qs.Commons
import "../lib/Editing.js" as Editing

// "New item": pick a type with ↑↓ and Enter, by its letter (F A P C U S), or by clicking.
FocusScope {
  id: root

  property string folderName: ""
  property int index: 0

  signal picked(string type)
  signal canceled()

  implicitHeight: column.implicitHeight

  function takeFocus() { root.forceActiveFocus() }

  function open(inFolder) {
    root.folderName = inFolder
    root.index = 0
  }

  Keys.onPressed: function(event) {
    var n = Editing.TYPES.length
    if (event.key === Qt.Key_Escape) root.canceled()
    else if (event.key === Qt.Key_Up) root.index = (root.index - 1 + n) % n
    else if (event.key === Qt.Key_Down || event.key === Qt.Key_Tab) root.index = (root.index + 1) % n
    else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) root.picked(Editing.TYPES[root.index].type)
    else {
      var letter = String(event.text || "").toUpperCase()
      var hit = Editing.TYPES.filter(function(t) { return t.key === letter })
      if (hit.length === 0 || (event.modifiers & (Qt.ControlModifier | Qt.AltModifier))) return
      root.picked(hit[0].type)
    }
    event.accepted = true
  }

  Column {
    id: column
    width: parent.width
    spacing: Style.spacing.md

    Text {
      text: root.folderName ? "New item in “" + root.folderName + "”" : "New item"
      textFormat: Text.PlainText
      color: Color.menu.text
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.heading
    }

    Repeater {
      model: Editing.TYPES

      delegate: Rectangle {
        id: row
        required property var modelData
        required property int index
        readonly property bool selected: row.index === root.index
        width: column.width
        height: Math.max(Style.space(34), Style.font.subtitle + Style.space(14))
        radius: Style.cornerRadius
        color: selected ? Color.menu.selectedBackground : "transparent"

        Text {
          id: glyph
          anchors.left: parent.left
          anchors.leftMargin: Style.space(10)
          anchors.verticalCenter: parent.verticalCenter
          width: Style.space(24)
          text: row.modelData.glyph
          color: row.selected ? Color.menu.selectedText : Color.menu.text
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.title
        }

        Text {
          anchors.left: glyph.right
          anchors.leftMargin: Style.space(10)
          anchors.verticalCenter: parent.verticalCenter
          text: row.modelData.label
          textFormat: Text.PlainText
          color: row.selected ? Color.menu.selectedText : Color.menu.text
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.subtitle
        }

        Text {
          anchors.right: parent.right
          anchors.rightMargin: Style.space(12)
          anchors.verticalCenter: parent.verticalCenter
          text: row.modelData.key
          color: Util.alpha(Color.menu.text, 0.55)
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.body
        }

        MouseArea {
          anchors.fill: parent
          onClicked: root.picked(row.modelData.type)
        }
      }
    }

    Text {
      text: "↑↓ choose   ↵ or letter pick   Esc cancel"
      color: Util.alpha(Color.menu.text, 0.45)
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.caption
    }
  }
}
