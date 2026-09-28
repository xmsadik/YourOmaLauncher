import QtQuick
import qs.Commons
import qs.Ui
import "../lib/Editing.js" as Editing

// Change an item's icon: automatic, a theme icon name, an image file, a Nerd Font glyph or an emoji.
// The preview updates as you type. Enter saves, Esc cancels, Tab moves between the kind and the value;
// in the row of kinds ←→ move and Space picks (the kit's ButtonGroup convention).
FocusScope {
  id: root

  property var node: null
  property var env: null
  property string kind: node && node.icon ? node.icon.kind : "auto"
  property string value: node && node.icon ? node.icon.value : ""

  signal saveRequested(var icon)       // null = automatic
  signal canceled()
  signal browseRequested()             // the launcher calls setFile() with the chosen path

  implicitHeight: column.implicitHeight

  // What the preview draws: the node as it would look with this icon.
  readonly property var previewNode: {
    if (!root.node) return null
    var copy = JSON.parse(JSON.stringify(root.node))
    copy.children = []
    copy.icon = Editing.iconFrom(root.kind, root.value)
    return copy
  }

  function takeFocus() { kinds.forceActiveFocus() }

  function open(forNode) {
    root.node = forNode
    root.kind = forNode && forNode.icon ? forNode.icon.kind : "auto"
    root.value = forNode && forNode.icon ? forNode.icon.value : ""
    valueField.text = root.value
  }

  function setFile(path) {
    root.kind = "file"
    root.value = path
    valueField.text = path
  }

  function save() { root.saveRequested(Editing.iconFrom(root.kind, root.value)) }

  Keys.onPressed: function(event) {
    if (event.key === Qt.Key_Escape) root.canceled()
    else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) root.save()
    else return
    event.accepted = true
  }

  Column {
    id: column
    width: parent.width
    spacing: Style.spacing.md

    Row {
      spacing: Style.space(12)
      NodeIcon {
        node: root.previewNode
        size: Style.font.heading * 2
        color: Color.menu.selectedText
        fontFamily: Style.font.menuFamily
        env: root.env
        anchors.verticalCenter: parent.verticalCenter
      }
      Text {
        anchors.verticalCenter: parent.verticalCenter
        text: "Icon for “" + (root.node ? root.node.name : "") + "”"
        textFormat: Text.PlainText
        color: Color.menu.text
        font.family: Style.font.menuFamily
        font.pixelSize: Style.font.heading
      }
    }

    ButtonGroup {
      id: kinds
      options: Editing.ICON_KINDS
      value: root.kind
      foreground: Color.menu.text
      fontFamily: Style.font.menuFamily
      onChanged: function(v) {
        if (v !== root.kind) { root.value = ""; valueField.text = "" }
        root.kind = v
      }
    }

    Row {
      width: parent.width
      spacing: Style.space(6)
      visible: root.kind !== "auto"
      TextField {
        id: valueField
        width: parent.width - (browse.visible ? browse.width + parent.spacing : 0)
        text: root.value
        placeholderText: root.kind === "icon" ? "A theme icon name, e.g. firefox or utilities-terminal"
          : root.kind === "file" ? "~/Pictures/logo.png (PNG, SVG, JPG)"
          : root.kind === "glyph" ? "Pick one below or paste a Nerd Font glyph"
          : "Paste an emoji"
        foreground: Color.menu.text
        accent: Color.menu.selectedText
        font.family: Style.font.menuFamily
        onTextEdited: root.value = text
        onAccepted: root.save()
      }
      Button {
        id: browse
        focusable: true
        visible: root.kind === "file"
        text: "Browse…"
        bordered: true
        foreground: Color.menu.text
        fontFamily: Style.font.menuFamily
        height: valueField.height
        onClicked: root.browseRequested()
      }
    }

    Text {
      width: parent.width
      visible: root.kind === "auto" || root.kind === "file"
      wrapMode: Text.Wrap
      textFormat: Text.PlainText
      text: root.kind === "auto"
        ? "Apps show their installed icon; everything else a glyph for its type."
        : "The image is copied next to your config, so it keeps working if the original moves."
      color: Util.alpha(Color.menu.text, 0.55)
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.body
    }

    Flow {
      width: parent.width
      spacing: Style.space(4)
      visible: root.kind === "glyph"
      Repeater {
        model: Editing.GLYPH_PALETTE
        delegate: Rectangle {
          id: cell
          required property string modelData
          width: Style.font.heading * 2
          height: width
          radius: Style.cornerRadius
          color: root.value === cell.modelData ? Color.menu.selectedBackground : "transparent"
          border.width: root.value === cell.modelData ? 1 : 0
          border.color: Color.menu.selectedText
          Text {
            anchors.centerIn: parent
            text: cell.modelData
            color: Color.menu.text
            font.family: Style.font.menuFamily
            font.pixelSize: Style.font.heading
          }
          MouseArea {
            anchors.fill: parent
            onClicked: { root.value = cell.modelData; valueField.text = cell.modelData }
            onDoubleClicked: { root.value = cell.modelData; root.save() }
          }
        }
      }
    }

    Item {
      width: parent.width
      height: saveButton.height
      Text {
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        text: "←→ Space kind   Tab value   ↵ save   Esc cancel"
        color: Util.alpha(Color.menu.text, 0.45)
        font.family: Style.font.menuFamily
        font.pixelSize: Style.font.caption
      }
      Row {
        anchors.right: parent.right
        spacing: Style.space(6)
        Button {
          text: "Cancel"
          bordered: true
          foreground: Color.menu.text
          fontFamily: Style.font.menuFamily
          onClicked: root.canceled()
        }
        Button {
          id: saveButton
          text: "Save"
          bordered: true
          selected: true
          foreground: Color.menu.text
          fontFamily: Style.font.menuFamily
          onClicked: root.save()
        }
      }
    }
  }
}
