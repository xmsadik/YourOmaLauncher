import QtQml
import "../../lib/Model.js" as Model
import "../../lib/TextNormalizer.js" as TextNormalizer
import "../../lib/FuzzyScorer.js" as FuzzyScorer
import "../../lib/SearchEngine.js" as SearchEngine
import "../../lib/ConfigSerializer.js" as ConfigSerializer
import "../../lib/TreeOps.js" as TreeOps
import "../../lib/Usage.js" as Usage
import "../../lib/LaunchPlan.js" as LaunchPlan
import "../../lib/TargetName.js" as TargetName
import "../../lib/PathTrimmer.js" as PathTrimmer

// Runs the libraries inside Qt's V4 engine, the one omarchy-shell uses, since the Node tests can't
// prove V4 accepts the same code. Checks a sample of behaviors against the Node test expectations and
// times search over 5,000 nodes. Run with tests/qml/run.sh; exits non-zero on any failure.
QtObject {
  id: smoke

  property int failures: 0
  property int checks: 0

  function check(name, actual, expected) {
    checks++
    var a = JSON.stringify(actual)
    var e = JSON.stringify(expected)
    if (a !== e) {
      failures++
      console.log("FAIL " + name + "\n  expected: " + e + "\n  actual:   " + a)
    }
  }

  function readFile(relative) {
    var xhr = new XMLHttpRequest()
    xhr.open("GET", Qt.resolvedUrl(relative), false)
    xhr.send()
    return xhr.responseText
  }

  function buildTree(total) {
    var names = ["Visual Studio Code", "Şifre Yöneticisi", "Haftalık Rapor", "SAP Dev System", "Build & Deploy",
      "Notepad", "Documents", "Downloads", "Anthropic", "Google Chrome", "İzmir Şube", "Işık Ayarları",
      "Docker Desktop", "Git Bash", "Configuration", "Backup Script"]
    var s = 42
    function random() { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
    var root = Model.createRoot()
    var folders = [root]
    for (var id = 1; id <= total; id++) {
      var parent = folders[Math.floor(random() * folders.length)]
      var name = names[Math.floor(random() * names.length)] + " " + id
      if (folders.length < total / 4 && random() < 0.25) {
        var f = Model.createNode("folder", { id: "f" + id, name: name })
        parent.children.push(f)
        folders.push(f)
      } else {
        parent.children.push(Model.createNode(["app", "path", "command", "url"][id % 4],
          { id: "n" + id, name: name, target: "/x", command: "echo hi" }))
      }
    }
    return root
  }

  Component.onCompleted: {
    try {
      check("normalize", TextNormalizer.normalize("İzmir IŞIK ÜÖÇĞ"), "izmir isik uocg")
      check("normalize keeps length", TextNormalizer.normalize("İİ").length, 2)
      check("turkish sort", ["Dosya", "Çanta", "Can", "ılık", "ilik", "Işık", "İlk"].sort(TextNormalizer.compareTurkish),
        ["Can", "Çanta", "Dosya", "ılık", "Işık", "ilik", "İlk"])

      var visco = FuzzyScorer.score("visco", "visual studio code")
      check("visco tier", visco.tier, FuzzyScorer.WORD_START)
      check("visco positions", visco.positions, [0, 1, 2, 14, 15])
      check("camelCase", FuzzyScorer.score("vci", "vscodeinsiders", FuzzyScorer.computeWordStarts("VsCodeInsiders")).tier, FuzzyScorer.WORD_START)

      var root = Model.createRoot()
      root.children = [
        Model.createNode("app", { id: "basic", name: "Visual Basic", target: "x" }),
        Model.createNode("app", { id: "vscode", name: "Visual Studio Code", target: "x" }),
        Model.createNode("path", { id: "notes", name: "vscode-notes.txt", target: "x" }),
        Model.createNode("folder", { id: "f", name: "Sub", children: [Model.createNode("url", { id: "deep", name: "Haftalık Rapor", target: "x" })] })
      ]
      var index = SearchEngine.buildIndex(root)
      check("vsc order", SearchEngine.search(index, "vsc").map(function(r) { return r.node.id }), ["notes", "vscode", "basic"])
      var rapor = SearchEngine.search(index, "rapor")[0]
      check("rapor", [rapor.node.id, rapor.breadcrumb, rapor.namePositions], ["deep", "Sub", [9, 10, 11, 12, 13]])

      var example = ConfigSerializer.deserialize(readFile("../../config.example.json"))
      check("example loads", [example.ok, example.error, example.notes.length], [true, null, 0])
      var again = ConfigSerializer.deserialize(ConfigSerializer.serialize(example.config))
      check("example round trip", JSON.stringify(again.config), JSON.stringify(example.config))

      var windows = ConfigSerializer.deserialize(readFile("../fixtures/windows-config.example.json"))
      check("windows migrates", [windows.ok, windows.config.version, windows.notes.length > 0], [true, 2, true])

      var dup = TreeOps.duplicate(root, root.children[3])
      check("duplicate", [dup.name, dup.id !== "f", root.children.length], ["Sub (copy)", true, 5])
      check("moveTo", TreeOps.moveTo(root, root.children[0], dup), TreeOps.MOVED)

      var usage = Usage.create()
      Usage.record(usage, "a", new Date())
      check("usage", Usage.score(usage, "a", new Date()), 4)

      var env = { HOME: "/home/u", SHELL: "/bin/bash" }
      check("shellWords", LaunchPlan.shellWords("--in '$HOME' \"$HOME/x y\" ~", env).words, ["--in", "$HOME", "/home/u/x y", "/home/u"])
      check("command plan", LaunchPlan.planFor(Model.createNode("command", { name: "B", command: "make" }), Model.defaultSettings(), env).argv,
        ["uwsm-app", "--", "xdg-terminal-exec", "--title=B", "-e", "bash", "-l", "-c", "make\nexec bash"])
      check("url plan", LaunchPlan.planFor(Model.createNode("url", { target: "github.com" }), Model.defaultSettings(), env).argv,
        ["omarchy", "launch", "browser", "https://github.com"])
      check("target name", TargetName.suggestName("https://www.anthropic.com/x", null), "www.anthropic.com")
      check("path trim", PathTrimmer.trimStart("abc › abcdefghij", 5, function(s) { return s.length }), "…ghij")
      check("newId", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(Model.newId()), true)

      // Timing in V4 itself.
      var t0 = Date.now()
      var big = SearchEngine.buildIndex(buildTree(5000))
      var buildMs = Date.now() - t0
      var queries = ["a", "vs", "sap", "rapor", "izmir", "docker", "şube", "isik", "build", "sd", "vsc", "sap dev", "git bash", "conf", "z"]
      queries.forEach(function(q) { SearchEngine.search(big, q) })
      var timings = queries.map(function(q) {
        var start = Date.now()
        SearchEngine.search(big, q)
        return Date.now() - start
      }).sort(function(a, b) { return a - b })
      var median = timings[Math.floor(timings.length / 2)]
      console.log("V4 timing, 5000 nodes: index build " + buildMs + " ms; search median " + median +
        " ms, max " + timings[timings.length - 1] + " ms")
      check("5000-node median under 16 ms", median < 16, true)
    } catch (e) {
      failures++
      console.log("EXCEPTION " + e + (e.stack ? "\n" + e.stack : ""))
    }
    console.log((failures === 0 ? "OK" : "FAILED") + ": " + (checks - failures) + "/" + checks + " checks passed in V4")
    Qt.exit(failures === 0 ? 0 : 1)
  }
}
