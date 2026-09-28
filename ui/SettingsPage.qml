import QtQuick
import qs.Commons
import qs.Ui

// Settings. Each change applies and saves at once; Esc goes back. Tab moves between controls,
// Enter/Space flips a toggle; in a row of choices ←→ move and Space picks.
FocusScope {
  id: root

  property var settings: ({})
  property string configPath: ""

  signal changed(string key, var value)
  signal closed()
  signal openConfigRequested()
  signal importExportRequested()

  implicitHeight: column.implicitHeight

  function takeFocus() { first.forceActiveFocus() }

  Keys.onPressed: function(event) {
    if (event.key === Qt.Key_Escape) {
      root.closed()
      event.accepted = true
    }
  }

  component Label: Text {
    textFormat: Text.PlainText
    color: Util.alpha(Color.menu.text, 0.55)
    font.family: Style.font.menuFamily
    font.pixelSize: Style.font.caption
    font.bold: true
  }

  Column {
    id: column
    width: parent.width
    spacing: Style.spacing.md

    Text {
      text: "Settings"
      textFormat: Text.PlainText
      color: Color.menu.text
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.heading
    }

    Toggle {
      id: first
      width: parent.width
      label: "Close after launching"
      description: "Otherwise the launcher stays open, e.g. to start several things in a row."
      checked: root.settings.closeAfterLaunch
      foreground: Color.menu.text
      fontFamily: Style.font.menuFamily
      onClicked: root.changed("closeAfterLaunch", !root.settings.closeAfterLaunch)
    }

    Toggle {
      width: parent.width
      label: "Remember the last folder"
      description: "Open where you left off instead of at the top."
      checked: root.settings.rememberLastLocation
      foreground: Color.menu.text
      fontFamily: Style.font.menuFamily
      onClicked: root.changed("rememberLastLocation", !root.settings.rememberLastLocation)
    }

    Toggle {
      width: parent.width
      label: "Show the hint line"
      description: "The key reminders at the bottom of the panel."
      checked: root.settings.showHintBar
      foreground: Color.menu.text
      fontFamily: Style.font.menuFamily
      onClicked: root.changed("showHintBar", !root.settings.showHintBar)
    }

    Column {
      width: parent.width
      spacing: Style.spacing.labelGap
      Label { text: "Visible rows" }
      NumberField {
        value: root.settings.maxVisibleItems
        from: 3
        to: 30
        foreground: Color.menu.text
        fontFamily: Style.font.menuFamily
        onModified: function(v) { root.changed("maxVisibleItems", v) }
      }
    }

    Column {
      width: parent.width
      spacing: Style.spacing.labelGap
      Label { text: "Shell for commands (items can choose their own)" }
      ButtonGroup {
        options: [{ value: "", label: "Login shell" }, { value: "bash", label: "bash" }, { value: "zsh", label: "zsh" },
                  { value: "fish", label: "fish" }, { value: "sh", label: "sh" }]
        value: root.settings.defaultShell || ""
        foreground: Color.menu.text
        fontFamily: Style.font.menuFamily
        onChanged: function(v) { root.changed("defaultShell", v || null) }
      }
    }

    Item {
      width: parent.width
      height: openButton.height
      Text {
        anchors.left: parent.left
        anchors.right: transferButton.left
        anchors.rightMargin: Style.space(8)
        anchors.verticalCenter: parent.verticalCenter
        elide: Text.ElideLeft
        textFormat: Text.PlainText
        text: root.configPath
        color: Util.alpha(Color.menu.text, 0.45)
        font.family: Style.font.menuFamily
        font.pixelSize: Style.font.caption
      }
      Button {
        id: transferButton
        focusable: true
        anchors.right: openButton.left
        anchors.rightMargin: Style.space(6)
        text: "Import and export…"
        bordered: true
        foreground: Color.menu.text
        fontFamily: Style.font.menuFamily
        onClicked: root.importExportRequested()
      }
      Button {
        id: openButton
        focusable: true
        anchors.right: parent.right
        text: "Open config file"
        bordered: true
        foreground: Color.menu.text
        fontFamily: Style.font.menuFamily
        onClicked: root.openConfigRequested()
      }
    }

    Text {
      text: "Tab next   ↵ toggle   ←→ Space choose   Esc back"
      color: Util.alpha(Color.menu.text, 0.45)
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.caption
    }
  }
}
