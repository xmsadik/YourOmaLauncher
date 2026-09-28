import QtQuick
import QtQuick.Controls as QQC
import qs.Commons
import qs.Ui
import "../lib/Editing.js" as Editing

// Add or edit one item. Works on a copy of the node's fields (`form`); nothing changes until Save.
// Keyboard: Tab / Shift+Tab between fields, Enter saves (Ctrl+Enter inside the command box),
// Esc cancels, Alt+A shows or hides the advanced fields.
FocusScope {
  id: root

  property var form: Editing.emptyForm("folder")
  property bool isNew: true
  property string appName: ""          // display name of form.desktopId
  property bool advanced: false
  property var errors: ({})
  property string lastSuggestion: ""   // the name we filled in, so we never overwrite a typed one

  signal saveRequested(var form)
  signal canceled()
  signal browseRequested(string field, bool directory)   // the launcher calls setField() with the result
  signal chooseAppRequested()

  readonly property var info: Editing.typeInfo(form.type)
  readonly property bool launchable: form.type !== "folder" && form.type !== "separator"
  readonly property color fg: Color.menu.text
  readonly property color muted: Util.alpha(Color.menu.text, 0.55)
  readonly property color accent: Color.menu.selectedText

  implicitHeight: column.implicitHeight

  // A new item starts at what it opens, so the name can be suggested from it.
  function takeFocus() {
    if (root.isNew && targetField.visible) targetField.forceActiveFocus()
    else if (root.isNew && appButton.visible) appButton.forceActiveFocus()
    else nameField.forceActiveFocus()
  }

  // Starts over on a new form. Fields that Browse… or a name suggestion wrote to directly no longer
  // follow `form`, so they're set here too.
  function open(newForm, creating, appDisplayName) {
    root.errors = ({})
    root.advanced = false
    root.isNew = creating
    root.appName = appDisplayName || ""
    root.lastSuggestion = ""
    root.form = newForm
    nameField.text = newForm.name
    targetField.text = newForm.target
    workingDirField.text = newForm.workingDirectory
  }

  function setApp(desktopId, name) {
    root.appName = name || ""
    root.setField("desktopId", desktopId)
  }

  function trySave() {
    root.errors = Editing.validate(root.form)
    for (var k in root.errors) return
    root.saveRequested(root.form)
  }

  // Called by the launcher after Browse… or the app picker.
  function setField(field, value) {
    root.form[field] = value
    if (field === "target") targetField.text = value
    if (field === "workingDirectory") workingDirField.text = value
    root.targetEdited()
    root.formChanged()
  }

  function targetEdited() {
    var auto = !root.form.name || root.form.name === root.lastSuggestion
    if (!auto) return
    var name = Editing.suggestedName(root.form, root.lastSuggestion, root.appName, null)
    root.lastSuggestion = name
    root.form.name = name
    nameField.text = name
  }

  function set(field, value) {
    root.form[field] = value
    root.formChanged()
  }

  Keys.onPressed: function(event) {
    if (event.key === Qt.Key_Escape) {
      root.canceled()
      event.accepted = true
    } else if (event.key === Qt.Key_A && (event.modifiers & Qt.AltModifier)) {
      root.advanced = !root.advanced
      event.accepted = true
    } else if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter) && (event.modifiers & Qt.ControlModifier)) {
      root.trySave()
      event.accepted = true
    }
  }

  component Label: Text {
    textFormat: Text.PlainText
    color: root.muted
    font.family: Style.font.menuFamily
    font.pixelSize: Style.font.caption
    font.bold: true
  }

  component ErrorText: Text {
    property string field
    visible: !!root.errors[field]
    text: root.errors[field] || ""
    textFormat: Text.PlainText
    color: Color.urgent
    font.family: Style.font.menuFamily
    font.pixelSize: Style.font.caption
  }

  component Field: TextField {
    width: parent.width
    foreground: root.fg
    accent: root.accent
    font.family: Style.font.menuFamily
    onAccepted: root.trySave()
  }

  Column {
    id: column
    width: parent.width
    spacing: Style.spacing.md

    Row {
      spacing: Style.space(10)
      Text {
        text: root.info ? root.info.glyph : ""
        color: root.accent
        font.family: Style.font.menuFamily
        font.pixelSize: Style.font.heading
      }
      Text {
        text: (root.isNew ? "New " : "Edit ") + (root.info ? root.info.label.toLowerCase() : "item")
        textFormat: Text.PlainText
        color: root.fg
        font.family: Style.font.menuFamily
        font.pixelSize: Style.font.heading
      }
    }

    // ---- name ----
    Column {
      width: parent.width
      spacing: Style.spacing.labelGap
      visible: root.form.type !== "separator"
      Label { text: "Name" }
      Field {
        id: nameField
        text: root.form.name
        placeholderText: root.form.type === "folder" ? "Folder name" : "What the launcher shows"
        onTextEdited: root.set("name", text)
      }
      ErrorText { field: "name" }
    }

    // ---- app ----
    Column {
      width: parent.width
      spacing: Style.spacing.labelGap
      visible: root.form.type === "app"
      Label { text: "Start" }
      ButtonGroup {
        options: [{ value: "desktop", label: "An installed app" }, { value: "program", label: "A program" }]
        value: root.form.appMode
        foreground: root.fg
        fontFamily: Style.font.menuFamily
        onChanged: function(v) { root.set("appMode", v); root.targetEdited() }
      }
    }

    Column {
      width: parent.width
      spacing: Style.spacing.labelGap
      visible: root.form.type === "app" && root.form.appMode === "desktop"
      Label { text: "App" }
      Button {
        id: appButton
        width: parent.width
        leftAlign: true
        bordered: true
        focusable: true
        activeFocusOnTab: true
        text: root.form.desktopId ? (root.appName || root.form.desktopId) + "   (" + root.form.desktopId + ")" : "Choose an app…"
        iconText: "󰀻"
        foreground: root.fg
        fontFamily: Style.font.menuFamily
        onClicked: root.chooseAppRequested()
        Keys.onReturnPressed: root.chooseAppRequested()
        Keys.onSpacePressed: root.chooseAppRequested()
      }
      ErrorText { field: "desktopId" }
    }

    // ---- target: program / path / url ----
    Column {
      width: parent.width
      spacing: Style.spacing.labelGap
      visible: (root.form.type === "app" && root.form.appMode === "program") || root.form.type === "path" || root.form.type === "url"
      Label {
        text: root.form.type === "url" ? "Address" : root.form.type === "path" ? "File or folder" : "Program (a path, or a name on your PATH)"
      }
      Row {
        width: parent.width
        spacing: Style.space(6)
        Field {
          id: targetField
          width: parent.width - (browseFile.visible ? browseFile.width + parent.spacing : 0)
                 - (browseDir.visible ? browseDir.width + parent.spacing : 0)
          text: root.form.target
          placeholderText: root.form.type === "url" ? "https://…" : root.form.type === "path" ? "~/Documents/report.ods" : "gimp"
          onTextEdited: { root.set("target", text); root.targetEdited() }
        }
        Button {
          id: browseFile
          focusable: true
          visible: root.form.type !== "url"
          text: "Browse…"
          bordered: true
          foreground: root.fg
          fontFamily: Style.font.menuFamily
          height: targetField.height
          onClicked: root.browseRequested("target", false)
        }
        Button {
          id: browseDir
          focusable: true
          visible: root.form.type === "path"
          text: "Folder…"
          bordered: true
          foreground: root.fg
          fontFamily: Style.font.menuFamily
          height: targetField.height
          onClicked: root.browseRequested("target", true)
        }
      }
      ErrorText { field: "target" }
    }

    Column {
      width: parent.width
      spacing: Style.spacing.labelGap
      visible: root.form.type === "app" && root.form.appMode === "program"
      Label { text: "Arguments" }
      Field {
        text: root.form.arguments
        placeholderText: "--new-window \"~/My file.txt\""
        onTextEdited: root.set("arguments", text)
      }
    }

    // ---- command ----
    Column {
      width: parent.width
      spacing: Style.spacing.labelGap
      visible: root.form.type === "command"
      Label { text: "Command (Ctrl+Enter saves; Enter adds a line)" }
      QQC.ScrollView {
        width: parent.width
        height: Math.max(Style.space(64), Math.min(Style.space(140), commandArea.implicitHeight))
        QQC.TextArea {
          id: commandArea
          text: root.form.command
          placeholderText: "git pull && make"
          wrapMode: TextEdit.Wrap
          color: root.fg
          placeholderTextColor: Qt.darker(root.fg, 1.6)
          selectionColor: Style.selectionFillFor(root.fg, root.accent)
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.body
          padding: Style.spacing.controlPaddingX
          activeFocusOnTab: true
          KeyNavigation.priority: KeyNavigation.BeforeItem
          Keys.onTabPressed: function(event) { nextItemInFocusChain(true).forceActiveFocus(); event.accepted = true }
          Keys.onBacktabPressed: function(event) { nextItemInFocusChain(false).forceActiveFocus(); event.accepted = true }
          onTextChanged: if (text !== root.form.command) root.form.command = text
          background: BorderSurface {
            color: Style.controlFill(commandArea.activeFocus, commandArea.hovered, root.fg, root.accent)
            borderSpec: Border.controlSpec(commandArea.activeFocus ? "focus" : "normal", root.fg, root.accent)
            radius: Style.cornerRadius
          }
        }
      }
      ErrorText { field: "command" }
    }

    Column {
      width: parent.width
      spacing: Style.spacing.labelGap
      visible: root.form.type === "command"
      Label { text: "Run" }
      ButtonGroup {
        options: [{ value: "terminal", label: "In a terminal" }, { value: "hidden", label: "In the background" }]
        value: root.form.window
        foreground: root.fg
        fontFamily: Style.font.menuFamily
        onChanged: function(v) { root.set("window", v) }
      }
    }

    Toggle {
      width: parent.width
      visible: root.form.type === "command" && root.form.window === "terminal"
      label: "Keep the terminal open afterwards"
      description: "Leaves you in a shell once the command finishes."
      checked: root.form.keepOpen
      foreground: root.fg
      fontFamily: Style.font.menuFamily
      onClicked: root.set("keepOpen", !root.form.keepOpen)
    }

    // ---- advanced ----
    Button {
      visible: root.form.type !== "separator"
      focusable: true
      text: (root.advanced ? "▾ " : "▸ ") + "Advanced"
      foreground: root.muted
      fontFamily: Style.font.menuFamily
      onClicked: root.advanced = !root.advanced
    }

    Column {
      width: parent.width
      spacing: Style.spacing.md
      visible: root.advanced && root.form.type !== "separator"

      Column {
        width: parent.width
        spacing: Style.spacing.labelGap
        visible: root.form.type === "command"
        Label { text: "Shell" }
        ButtonGroup {
          options: [{ value: "", label: "Default" }, { value: "bash", label: "bash" }, { value: "zsh", label: "zsh" },
                    { value: "fish", label: "fish" }, { value: "sh", label: "sh" }]
          value: root.form.shell
          foreground: root.fg
          fontFamily: Style.font.menuFamily
          onChanged: function(v) { root.set("shell", v) }
        }
      }

      Column {
        width: parent.width
        spacing: Style.spacing.labelGap
        visible: root.form.type === "app" || root.form.type === "command"
        Label { text: "Working directory (empty = your home folder)" }
        Row {
          width: parent.width
          spacing: Style.space(6)
          Field {
            id: workingDirField
            width: parent.width - browseWd.width - parent.spacing
            text: root.form.workingDirectory
            placeholderText: "~/Work"
            onTextEdited: root.set("workingDirectory", text)
          }
          Button {
            id: browseWd
            focusable: true
            text: "Folder…"
            bordered: true
            foreground: root.fg
            fontFamily: Style.font.menuFamily
            height: workingDirField.height
            onClicked: root.browseRequested("workingDirectory", true)
          }
        }
      }

      Column {
        width: parent.width
        spacing: Style.spacing.labelGap
        Label { text: "Keywords (comma-separated, found by search)" }
        Field {
          text: root.form.keywords
          placeholderText: "editor, code"
          onTextEdited: root.set("keywords", text)
        }
      }

      Column {
        width: parent.width
        spacing: Style.spacing.labelGap
        Label { text: "Description (shown on the right, found by search)" }
        Field {
          text: root.form.description
          onTextEdited: root.set("description", text)
        }
      }

      Toggle {
        width: parent.width
        visible: root.launchable
        label: "Ask before launching"
        description: "For things like power off or restart."
        checked: root.form.confirmLaunch
        foreground: root.fg
        fontFamily: Style.font.menuFamily
        onClicked: root.set("confirmLaunch", !root.form.confirmLaunch)
      }
    }

    Item {
      width: parent.width
      height: saveButton.height

      Text {
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        text: "↵ save   Tab next   Alt+A advanced   Esc cancel"
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
          foreground: root.fg
          fontFamily: Style.font.menuFamily
          onClicked: root.canceled()
        }
        Button {
          id: saveButton
          text: root.isNew ? "Add" : "Save"
          bordered: true
          selected: true
          foreground: root.fg
          fontFamily: Style.font.menuFamily
          onClicked: root.trySave()
        }
      }
    }
  }
}
