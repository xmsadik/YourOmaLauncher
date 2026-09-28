import Quickshell
import QtQuick
import qs.Commons
import "../lib/Listing.js" as Listing
import "../lib/EnvExpander.js" as EnvExpander

// A node's icon: its own icon if it has one (a theme icon name, an image file, a Nerd Font glyph or an
// emoji); otherwise, for apps, the installed app's icon; otherwise a glyph for the node type. Any image
// that fails to load falls back to that glyph.
Item {
  id: root

  property var node: null
  property int size: 24
  property color color: "white"
  property string fontFamily: ""
  property var env: null

  width: size
  height: size

  function entryIconSource(entry) {
    var icon = entry && entry.icon ? String(entry.icon) : ""
    if (!icon) return ""
    if (icon.charAt(0) === "/") return Util.fileUrl(icon)
    return Quickshell.iconPath(icon, true)
  }

  function desktopEntry(n) {
    if (n.desktopId) {
      var id = String(n.desktopId)
      if (id.slice(-8) === ".desktop") id = id.slice(0, -8)
      return DesktopEntries.byId(id)
    }
    // A program on its own ("gimp", "/usr/bin/gimp"): its launcher entry, if one matches.
    var target = String(n.target || "")
    var base = target.substring(target.lastIndexOf("/") + 1)
    return base ? DesktopEntries.heuristicLookup(base) : null
  }

  readonly property var icon: node ? node.icon : null
  readonly property string textIcon: icon && (icon.kind === "glyph" || icon.kind === "emoji") ? icon.value : ""
  readonly property string imageSource: {
    if (!node) return ""
    if (icon && icon.kind === "icon") return Quickshell.iconPath(icon.value, true)
    if (icon && icon.kind === "file") {
      var path = EnvExpander.expand(icon.value, root.env)
      return path ? Util.fileUrl(path) : ""
    }
    if (!icon && node.type === "app") return entryIconSource(desktopEntry(node))
    return ""
  }

  Image {
    id: image
    anchors.fill: parent
    source: root.imageSource
    sourceSize.width: root.size * 2
    sourceSize.height: root.size * 2
    fillMode: Image.PreserveAspectFit
    asynchronous: true
    smooth: true
    cache: false   // copied icons keep their path when replaced
    visible: status === Image.Ready
  }

  Text {
    anchors.centerIn: parent
    visible: !image.visible
    text: root.textIcon || (root.node ? Listing.fallbackGlyph(root.node) : "")
    color: root.color
    font.family: root.fontFamily
    font.pixelSize: Math.round(root.size * (root.icon && root.icon.kind === "emoji" ? 0.8 : 0.9))
  }
}
