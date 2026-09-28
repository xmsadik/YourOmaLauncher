import QtQuick
import qs.Commons
import qs.Ui

// A small menu for the selected row (right-click, or the Menu key / Shift+F10). Items are
// { action, label, shortcut, enabled, destructive, separatorBefore }. ↑↓ move (Home/End: first/last),
// Enter picks, Esc closes; a click outside closes too (the launcher handles that).
BorderSurface {
  id: root

  property var items: []
  property int index: 0

  signal chosen(string action)
  signal closed()

  readonly property int rowHeight: Math.max(Style.space(30), Style.font.body + Style.space(14))

  width: Style.space(260)
  height: column.implicitHeight + Style.space(8)
  radius: Style.cornerRadius
  color: Color.popups.background
  borderSpec: Border.localOrSurfaceSpec("popups", "border", Color.popups.border, Color.popups.border, Style.normalBorderWidth)
  focus: true

  function firstEnabled(from, step) {
    for (var i = from; i >= 0 && i < root.items.length; i += step) if (root.items[i].enabled !== false) return i
    return root.index
  }

  onItemsChanged: root.index = firstEnabled(0, 1)

  Keys.onPressed: function(event) {
    if (event.key === Qt.Key_Escape || event.key === Qt.Key_Menu) root.closed()
    else if (event.key === Qt.Key_Up) root.index = firstEnabled(root.index - 1, -1)
    else if (event.key === Qt.Key_Down || event.key === Qt.Key_Tab) root.index = firstEnabled(root.index + 1, 1)
    else if (event.key === Qt.Key_Home) root.index = firstEnabled(0, 1)
    else if (event.key === Qt.Key_End) root.index = firstEnabled(root.items.length - 1, -1)
    else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
      var item = root.items[root.index]
      if (item && item.enabled !== false) root.chosen(item.action)
    }
    event.accepted = true
  }

  Column {
    id: column
    x: Style.space(4)
    y: Style.space(4)
    width: root.width - Style.space(8)

    Repeater {
      model: root.items
      delegate: Column {
        id: entry
        required property var modelData
        required property int index
        width: column.width

        Rectangle {
          visible: !!entry.modelData.separatorBefore
          width: parent.width
          height: Style.space(7)
          color: "transparent"
          Rectangle {
            anchors.verticalCenter: parent.verticalCenter
            width: parent.width
            height: 1
            color: Color.popups.text
            opacity: 0.15
          }
        }

        Rectangle {
          readonly property bool enabledItem: entry.modelData.enabled !== false
          readonly property bool selected: entry.index === root.index && enabledItem
          width: parent.width
          height: root.rowHeight
          radius: Style.cornerRadius
          color: selected ? Color.menu.selectedBackground : "transparent"

          Text {
            anchors.left: parent.left
            anchors.leftMargin: Style.space(10)
            anchors.verticalCenter: parent.verticalCenter
            text: entry.modelData.label
            textFormat: Text.PlainText
            color: entry.modelData.destructive ? Color.urgent
              : parent.selected ? Color.menu.selectedText : Color.popups.text
            opacity: parent.enabledItem ? 1 : 0.4
            font.family: Style.font.menuFamily
            font.pixelSize: Style.font.body
          }

          Text {
            anchors.right: parent.right
            anchors.rightMargin: Style.space(10)
            anchors.verticalCenter: parent.verticalCenter
            text: entry.modelData.shortcut || ""
            color: Util.alpha(Color.popups.text, 0.45)
            font.family: Style.font.menuFamily
            font.pixelSize: Style.font.caption
          }

          MouseArea {
            anchors.fill: parent
            enabled: parent.enabledItem
            hoverEnabled: true
            onEntered: root.index = entry.index
            onClicked: root.chosen(entry.modelData.action)
          }
        }
      }
    }
  }
}
