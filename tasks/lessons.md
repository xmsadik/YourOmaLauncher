# Lessons

Rules learned the hard way, here and in the Windows version of this launcher.

## Real data stays out of the repo
- Never copy real user data (bookmark, folder or file names, paths, account names) into repo files,
  tests, fixtures or commit messages. Describe results with counts and neutral examples
  (`example.com`, `/home/u`).
- Before the repo goes public, scan the files *and* the full history (`git log -p --all`). In the
  Windows project, names from real bookmarks leaked into a todo, a comment and a fixture; fixing it
  took a history rewrite and a new repo, because force-pushed-away commits stay reachable by SHA.

## An empty result from real data is a red flag
- If a sanity run against real data returns nothing for something the user surely has, check the
  source before reporting: list the directory, look for sibling files, check sizes. (Signed-in Chrome
  keeps its bookmarks in `AccountBookmarks`, not `Bookmarks`; an import once reported 0.)
- For third-party file formats, check the layout on disk on this machine rather than trusting old docs.

## Live tests act on the user's real launcher
- Testing in the running shell (`wtype` keys into the panel) edits `~/.config/youromalauncher`, and
  the user adds items between sessions. Snapshot the whole folder right before a run, look at the
  first screenshot before sending editing keys, and restore afterwards by copying the files back
  (`cp -a snapshot/. ~/.config/youromalauncher/`). Deleting the folder first doesn't work: the open
  launcher recreates it at once.

## The shell is not Node
- omarchy-shell runs Qt's V4 engine, 20–50× slower than Node, with gaps (no position in JSON.parse
  errors). Anything on the search path, and any new library, gets a check in `npm run test:qml`.
- Changed plugin code only loads after `omarchy restart shell` (`npm run reload`), never on a rescan.
