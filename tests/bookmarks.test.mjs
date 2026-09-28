import { test } from "node:test"
import assert from "node:assert/strict"
import { load } from "./qmljs.mjs"

const Model = load("Model")
const Bookmarks = load("Bookmarks")

const names = folder => folder.children.map(c => c.name)
const wrap = ({ bar = [], other = [], synced = [] } = {}) =>
  JSON.stringify({ roots: { bookmark_bar: { children: bar }, other: { children: other }, synced: { children: synced } } })
const url = (name, u) => ({ type: "url", name, url: u })
const chromium = (texts, name = "Chrome bookmarks") => {
  const r = Bookmarks.parseChromium(Array.isArray(texts) ? texts : [texts], name)
  assert.equal(r.ok, true, r.error)
  return r.folder
}
const netscape = (html, name = "Bookmarks (export)") => {
  const r = Bookmarks.parseNetscape(html, name)
  assert.equal(r.ok, true, r.error)
  return r.folder
}

// ---- Chromium ----

test("chromium: a link lands under Bookmarks bar", () => {
  const result = chromium(wrap({ bar: [url("Example", "https://example.com")] }))
  assert.equal(result.name, "Chrome bookmarks")
  assert.deepEqual(names(result), ["Bookmarks bar"])
  const link = result.children[0].children[0]
  assert.equal(link.type, "url")
  assert.equal(link.name, "Example")
  assert.equal(link.target, "https://example.com")
})

test("chromium: nested folders keep their order", () => {
  const result = chromium(wrap({ bar: [url("First", "https://a.example"),
    { type: "folder", name: "Dev", children: [url("GitHub", "https://github.com"), url("GitLab", "https://gitlab.com")] },
    url("Last", "https://b.example")] }))
  const bar = result.children[0]
  assert.deepEqual(names(bar), ["First", "Dev", "Last"])
  assert.deepEqual(names(bar.children[1]), ["GitHub", "GitLab"])
})

test("chromium: empty roots are all dropped", () => {
  assert.deepEqual(chromium(wrap()).children, [])
})

test("chromium: other and synced roots get fixed names", () => {
  const result = chromium(wrap({ other: [url("O", "https://o.example")], synced: [url("S", "https://s.example")] }))
  assert.deepEqual(names(result), ["Other bookmarks", "Mobile bookmarks"])
})

test("chromium: bookmarklets and links without a URL are skipped", () => {
  assert.deepEqual(chromium(wrap({ bar: [url("B", "javascript:alert(1)"), url("J", "JavaScript:void(0)")] })).children, [])
  assert.deepEqual(chromium(wrap({ bar: [{ type: "url", name: "No target" }] })).children, [])
})

test("chromium: an empty title becomes the host, or the URL without one", () => {
  const bar = chromium(wrap({ bar: [url("", "https://example.com/page"), url("", "about:blank"),
    url("", "http://user@host.example:8080/x")] })).children[0]
  assert.deepEqual(names(bar), ["example.com", "about:blank", "host.example"])
})

test("chromium: an empty folder name becomes (unnamed); empty folders are pruned recursively", () => {
  const named = chromium(wrap({ bar: [{ type: "folder", name: "", children: [url("X", "https://x.example")] }] }))
  assert.equal(named.children[0].children[0].name, "(unnamed)")
  const pruned = chromium(wrap({ bar: [{ type: "folder", name: "Dev", children: [{ type: "folder", name: "Empty", children: [] }] }] }))
  assert.deepEqual(pruned.children, [])
})

test("chromium: unknown node types and non-object children are skipped", () => {
  const bar = chromium(wrap({ bar: [null, "x", 42, { type: "trash", name: "W" }, url("Kept", "https://kept.example")] })).children[0]
  assert.deepEqual(names(bar), ["Kept"])
})

test("chromium: malformed files fail with a message, never throw", () => {
  for (const text of ["{ not valid json", "{}", "null", "[]", "\"text\"", JSON.stringify({ roots: [] })]) {
    const r = Bookmarks.parseChromium([text], "X")
    assert.equal(r.ok, false, text)
    assert.match(r.error, /Could not parse the bookmarks file/)
  }
})

test("chromium: every node gets a fresh id", () => {
  const result = chromium(wrap({ bar: [url("A", "https://a.example"), url("B", "https://b.example")] }))
  const bar = result.children[0]
  const ids = [result.id, bar.id, ...bar.children.map(c => c.id)]
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.every(id => typeof id === "string" && id.length > 0))
})

test("chromium: AccountBookmarks and Bookmarks merge under the same roots, in file order", () => {
  const account = wrap({ bar: [url("Account", "https://a.example")] })
  const local = wrap({ bar: [url("Local", "https://l.example")], other: [url("Other", "https://o.example")] })
  const result = chromium([account, local])
  assert.deepEqual(names(result), ["Bookmarks bar", "Other bookmarks"])
  assert.deepEqual(names(result.children[0]), ["Account", "Local"])
  assert.deepEqual(chromium([wrap(), wrap()]).children, [])
})

// ---- Netscape HTML ----

test("netscape: top-level links go straight into the result folder", () => {
  const result = netscape(`<!DOCTYPE NETSCAPE-Bookmark-file-1>
    <H1>Bookmarks</H1>
    <DL><p>
      <DT><A HREF="https://example.com" ADD_DATE="1">Example</A>
    </DL><p>`)
  assert.equal(result.name, "Bookmarks (export)")
  assert.deepEqual(names(result), ["Example"])
  assert.equal(result.children[0].target, "https://example.com")
})

test("netscape: folders nest, and order is kept", () => {
  const result = netscape(`<DL><p>
      <DT><A HREF="https://first.example">First</A>
      <DT><H3 ADD_DATE="1">Dev</H3>
      <DL><p>
        <DT><A HREF="https://github.com">GitHub</A>
        <DT><A HREF="https://gitlab.com">GitLab</A>
      </DL><p>
      <DT><A HREF="https://last.example">Last</A>
    </DL><p>`)
  assert.deepEqual(names(result), ["First", "Dev", "Last"])
  assert.deepEqual(names(result.children[1]), ["GitHub", "GitLab"])
})

test("netscape: H1 is ignored and tags are case-insensitive", () => {
  const result = netscape(`<h1>My Bookmarks Menu</h1><dl><p><dt><a href="https://example.com">Example</a></dl><p>`)
  assert.deepEqual(names(result), ["Example"])
})

test("netscape: entities are decoded in names and hrefs", () => {
  const link = netscape(`<DL><p><DT><A HREF="https://example.com/?a=1&amp;b=2">Tom &amp; Jerry &#8211; &#x1F680; &lt;3</A></DL>`).children[0]
  assert.equal(link.name, "Tom & Jerry – 🚀 <3")
  assert.equal(link.target, "https://example.com/?a=1&b=2")
})

test("netscape: bookmarklets and links without HREF are skipped", () => {
  const result = netscape(`<DL><p>
    <DT><A HREF="javascript:alert(1)">Bookmarklet</A>
    <DT><A>No href</A>
    <DT><A HREF="https://kept.example">Kept</A>
    </DL>`)
  assert.deepEqual(names(result), ["Kept"])
})

test("netscape: empty title → host; empty folder name → (unnamed)", () => {
  assert.deepEqual(names(netscape(`<DL><p><DT><A HREF="https://example.com/page"></A></DL>`)), ["example.com"])
  assert.deepEqual(names(netscape(`<DL><p><DT><H3></H3><DL><p><DT><A HREF="https://x.example">X</A></DL><p></DL>`)), ["(unnamed)"])
})

test("netscape: nothing but empty folders, or nothing at all, is an error naming the file", () => {
  const empty = Bookmarks.parseNetscape(`<DL><p><DT><H3>Dev</H3><DL><p><DT><H3>Empty</H3><DL><p></DL><p></DL><p></DL>`, "X")
  assert.equal(empty.ok, false)
  const none = Bookmarks.parseNetscape("<H1>Bookmarks</H1><DL><p></DL><p>", "Bookmarks (myfile)")
  assert.equal(none.ok, false)
  assert.match(none.error, /Bookmarks \(myfile\)/)
  assert.equal(Bookmarks.parseNetscape("not html at all", "X").ok, false)
})

test("netscape: unclosed DT and P, and stray </DL>s, are tolerated", () => {
  assert.deepEqual(names(netscape(`<DL><p><DT><A HREF="https://a.example">A</A><DT><A HREF="https://b.example">B</A></DL><p></DL></DL>`)), ["A", "B"])
})

test("netscape: a link title with markup keeps only its text", () => {
  assert.deepEqual(names(netscape(`<DL><DT><A HREF="https://a.example"><b>Bold</b> link</A></DL>`)), ["Bold link"])
})

// ---- applying ----

const root = (...children) => Model.createNode("folder", { id: "root", name: "Root", children })
const folder = (id, name, ...children) => Model.createNode("folder", { id, name, children })
const link = (name, target) => Model.createNode("url", { name, target })
const CHROME = Bookmarks.importedFolderId("chrome/default")
const imported = (...children) => Model.createNode("folder", { name: "Chrome bookmarks", children })

test("apply: a first import is appended to the target folder with a deterministic id", () => {
  const r = root()
  const imp = imported(link("A", "https://a.example"), link("B", "https://b.example"))
  const res = Bookmarks.apply(r, r, imp, "chrome/default")
  assert.equal(res.replaced, false)
  assert.equal(res.count, 2)
  assert.equal(res.folder, imp)
  assert.equal(imp.id, CHROME)
  assert.deepEqual(r.children, [imp])
})

test("apply: the target can be any folder", () => {
  const sub = folder("sub", "Sub")
  const r = root(sub)
  const imp = imported(link("A", "https://a.example"))
  Bookmarks.apply(r, sub, imp, "chrome/default")
  assert.deepEqual(r.children, [sub])
  assert.deepEqual(sub.children, [imp])
})

test("apply: importing again replaces the contents in place, keeping name and position", () => {
  const existing = folder(CHROME, "My Renamed Bookmarks", link("Old", "https://old.example"))
  const r = root(existing, folder("sibling", "Sibling"))
  const res = Bookmarks.apply(r, r, imported(link("New", "https://new.example")), "chrome/default")
  assert.equal(res.replaced, true)
  assert.equal(res.count, 1)
  assert.equal(res.folder, existing)
  assert.equal(existing.name, "My Renamed Bookmarks")
  assert.deepEqual(names(existing), ["New"])
  assert.deepEqual(names(r), ["My Renamed Bookmarks", "Sibling"])
})

test("apply: the previous import is found even after being moved", () => {
  const moved = folder(CHROME, "Chrome bookmarks", link("Old", "https://old.example"))
  const r = root(folder("other", "Other", moved))
  const res = Bookmarks.apply(r, r, imported(link("New", "https://new.example")), "chrome/default")
  assert.equal(res.replaced, true)
  assert.equal(res.folder, moved)
  assert.equal(r.children.length, 1)
})

test("apply: another source doesn't match", () => {
  const r = root(folder(CHROME, "Chrome bookmarks", link("Old", "https://old.example")))
  const res = Bookmarks.apply(r, r, imported(link("New", "https://new.example")), "edge/default")
  assert.equal(res.replaced, false)
  assert.equal(r.children.length, 2)
  assert.equal(res.folder.id, Bookmarks.importedFolderId("edge/default"))
})

test("apply: counts only bookmarks, not folders", () => {
  const r = root()
  const imp = imported(link("A", "https://a.example"), folder("f", "Sub", link("B", "https://b.example"), link("C", "https://c.example")))
  assert.equal(Bookmarks.apply(r, r, imp, "chrome/default").count, 3)
})

test("apply: an id taken by a non-folder never gets duplicated", () => {
  const r = root(Model.createNode("url", { id: CHROME, name: "Hand-edited", target: "https://x.example" }))
  const res = Bookmarks.apply(r, r, imported(link("A", "https://a.example")), "chrome/default")
  assert.equal(res.replaced, false)
  assert.notEqual(res.folder.id, CHROME)
  assert.equal(r.children.length, 2)
})

test("source keys and folder ids", () => {
  // Source keys hold "/", spaces and file names; the folder id must still be a plain file name.
  for (const key of ["chrome/default", "chromium/profile 2", "html/my bookmarks.html", "html/../../x", "x".repeat(500)]) {
    const id = Bookmarks.importedFolderId(key)
    assert.ok(Model.isSafeId(id), id)
    assert.equal(id, Bookmarks.importedFolderId(key))           // stable, so a re-import finds it
  }
  assert.match(Bookmarks.importedFolderId("chrome/default"), /^bookmarks-chrome-default-[0-9a-f]{16}$/)
  assert.notEqual(Bookmarks.importedFolderId("html/a b.html"), Bookmarks.importedFolderId("html/a-b.html"))
  assert.equal(Bookmarks.htmlSourceKey("/home/u/Downloads/Bookmarks.html"), "html/bookmarks.html")
  assert.equal(Bookmarks.htmlSourceKey("/tmp/MY-EXPORT.HTM"), "html/my-export.htm")
})

// ---- finding browser profiles ----

const dirs = Bookmarks.userDataDirs("/c", "/h")
const byKey = key => dirs.find(d => d.key === key)

test("userDataDirs covers native and Flatpak installs", () => {
  assert.equal(byKey("chromium").path, "/c/chromium")
  assert.equal(byKey("brave").path, "/c/BraveSoftware/Brave-Browser")
  assert.equal(byKey("chrome-flatpak").path, "/h/.var/app/com.google.Chrome/config/google-chrome")
  assert.equal(byKey("opera").single, true)
  const argv = Bookmarks.findCommand(dirs)
  assert.equal(argv[0], "find")
  assert.ok(argv.includes("/c/google-chrome") && argv.includes("-maxdepth"))
})

test("sources: one profile is just the browser's name; files are account first", () => {
  const found = ["/c/google-chrome/Local State", "/c/google-chrome/Default/Bookmarks", "/c/google-chrome/Default/AccountBookmarks"]
  const s = Bookmarks.sources(dirs, found, {})
  assert.equal(s.length, 1)
  assert.equal(s[0].displayName, "Chrome")
  assert.equal(s[0].sourceKey, "chrome/default")
  assert.deepEqual(s[0].paths, ["/c/google-chrome/Default/AccountBookmarks", "/c/google-chrome/Default/Bookmarks"])
})

test("sources: several profiles are named from Local State, in profile order", () => {
  const found = ["/c/chromium/Profile 10/Bookmarks", "/c/chromium/Profile 2/Bookmarks", "/c/chromium/Default/Bookmarks",
    "/c/chromium/System Profile/Bookmarks", "/c/chromium/Default/Extensions/Bookmarks"]
  const localState = JSON.stringify({ profile: { info_cache: { "Default": { name: "Home" }, "Profile 2": { name: "Work" } } } })
  const s = Bookmarks.sources(dirs, found, { "/c/chromium": localState })
  assert.deepEqual(s.map(x => x.displayName), ["Chromium (Home)", "Chromium (Work)", "Chromium (Profile 10)"])
  assert.deepEqual(s.map(x => x.sourceKey), ["chromium/default", "chromium/profile 2", "chromium/profile 10"])
})

test("sources: profiles sharing a name are told apart by directory", () => {
  const found = ["/c/microsoft-edge/Default/Bookmarks", "/c/microsoft-edge/Profile 1/Bookmarks"]
  const localState = JSON.stringify({ profile: { info_cache: { "Default": { name: "Person 1" }, "Profile 1": { name: "Person 1" } } } })
  assert.deepEqual(Bookmarks.sources(dirs, found, { "/c/microsoft-edge": localState }).map(x => x.displayName),
    ["Edge (Person 1, Default)", "Edge (Person 1, Profile 1)"])
})

test("sources: Opera's single profile, Flatpaks, and a damaged Local State", () => {
  const found = ["/c/opera/Bookmarks", "/h/.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser/Default/Bookmarks",
    "/c/vivaldi/Default/Bookmarks"]
  const s = Bookmarks.sources(dirs, found, { "/c/vivaldi": "{ damaged" })
  assert.deepEqual(s.map(x => [x.displayName, x.sourceKey]),
    [["Brave (Flatpak)", "brave-flatpak/default"], ["Vivaldi", "vivaldi/default"], ["Opera", "opera/"]])
})

test("sources: nothing found, nothing listed", () => {
  assert.deepEqual(Bookmarks.sources(dirs, [], {}), [])
  assert.deepEqual(Bookmarks.sources(dirs, ["/c/chromium/Local State"], {}), [])
})
