# Open a folder from the command line

Date: 2026-09-29 · Branch: `cli-open`

## Goal

Open a local folder in Remora from a terminal, like VS Code's `code .`:

```sh
remora            # current folder
remora ~/code/foo
```

A folder opened this way that is not already a project lands in an **Opened** section at the
bottom of the sidebar, outside every group. It stays there (across restarts) until the user
removes it or moves it into a group.

## Decisions

| Question | Decision |
|---|---|
| How long does an opened project live? | Persisted in `config.json` until the user removes or moves it. No size cap. |
| Local or remote? | Local folders only. No `host:path` syntax. |
| Folder already a `local` project in a group? | Select that project; nothing is added. |
| Folder already in Opened? | Select it and move it to the top of Opened. |
| How is `remora` installed? | Shell script bundled in `Remora.app`; `mise run install:app` symlinks it into `~/.local/bin`. |
| How does the path reach the app? | macOS "open documents" Apple Event: the script runs `open -a Remora <dir>`, Rust receives `RunEvent::Opened`. No new plugin, no URL scheme. |
| Where is the section? | Last in the sidebar, after every group. |

Rejected: a `remora://` URL scheme via `tauri-plugin-deep-link` (only needed for remote paths,
and any web page could invoke it); the single-instance plugin with argv (arguments from `open`
never reach a running instance on macOS).

## Config

Two new top-level fields, both left out of the JSON when empty/false so existing configs load
unchanged:

- `opened: Project[]`, newest first.
- `openedCollapsed: boolean`, folds the Opened section.

Rust `Config::projects()` and TS `flatProjects()` yield the opened projects **after** every
group, matching the sidebar. Everything built on them then covers opened projects with no
further change: backend lookup by id (`ConfigStore::project`), host/root validation, the
duplicate-id check, ⌘P, ⌘1…9 (bookmarks, then groups, then Opened) and bookmarks.

`configOps` changes:

- `updateProject` and `removeProject` also apply to `opened`.
- `moveProject(c, id, toGroupId, beforeId)` also takes a project out of `opened`.
- New `openLocalFolder(c, path): { config, id }`:
  1. Normalize `path` (strip trailing `/`, except for `/` itself).
  2. A `local` project in a group with that path → return `c` unchanged and its id.
  3. A project in `opened` with that path → move it to the front of `opened`, return its id.
  4. Otherwise prepend `{ id: newId(), name: basename(path), host: 'local', path }` to `opened`.
- New `toggleOpened(c)` flips `openedCollapsed`.
- `sortByName` leaves `opened` alone: it is always newest first, whatever the Order setting.

## Sidebar

- An **Opened** section after the last group, shown only when `opened` is not empty.
  Its label collapses it like Bookmarks does (chevron, `openedCollapsed`).
- Rows lead with a folder icon and show the host badge, like group rows.
- Right-click shows the existing project menu: Bookmark, Rename…, Edit path…, Move to *each
  group*, Remove. "Move to …" is how an opened project is kept in a group.
- Opened rows do not drag and do not take drops (no `data-row`); moving goes through the menu.
- "No projects yet" shows only when there are no groups **and** `opened` is empty.

## Receiving the path (Rust)

- `lib.rs` switches from `.run(generate_context!())` to `.build(...)` + `.run(|app, event| …)`.
- On `RunEvent::Opened { urls }` (macOS): a pure function turns `file://` URLs into paths and
  keeps only existing directories. Each is pushed onto `AppState.pending_opens:
  Mutex<Vec<String>>`, an `open-folders` event carries them to the frontend, and the main window
  is shown and focused.
- New command `take_pending_opens() -> Vec<String>` returns and clears the queue.
- The frontend subscribes to `open-folders` first, then calls `take_pending_opens` once the
  config is loaded, so a folder that arrives while the app is still starting is not lost. Handling
  the same path twice is harmless: the second time just selects it.
- For each path the frontend applies `openLocalFolder` through `updateConfig`, then selects the
  returned id.

**Spike first:** check that `open -a Remora <folder>` delivers `RunEvent::Opened`. If it does
not, add `src-tauri/Info.plist` declaring `CFBundleDocumentTypes` with `LSItemContentTypes =
[public.folder]`, `CFBundleTypeRole = Viewer`, `LSHandlerRank = None` (so Finder never picks
Remora as the default for folders). If that still fails, stop and revisit the approach before
building more.

## The `remora` command

`src-tauri/bin/remora`, POSIX sh, bundled through `bundle.resources` into
`Remora.app/Contents/Resources/bin/remora`:

- `remora [path]`, default `.`.
- A path that is not a directory: message on stderr, exit 1.
- Otherwise `open -a Remora "$(cd "$p" && pwd -P)"`.

It always opens the installed app, never a `pnpm tauri dev` build.

`mise run install:app` adds, after copying the app: `chmod +x` on the bundled script (in case
bundling drops the mode), `mkdir -p ~/.local/bin`, `ln -sf` it to `~/.local/bin/remora`.
The README gets a short "Command line" section, including the manual symlink for installs
without mise.

## Testing

- Rust: `projects()` includes `opened` after the groups; the duplicate-id check spans opened and
  groups; `opened` / `openedCollapsed` are skipped when empty and round-trip when set; the
  URL → directory filter (non-file URL, missing path, file, directory).
- TS `configOps`: `openLocalFolder` for a path already in a group, already in opened (moved to
  front), new, and with a trailing slash; `updateProject` / `removeProject` / `moveProject` on
  an opened project; `flatProjects` order; `sortByName` keeps `opened` order.
- Manual, after `mise run install:app`: `remora .` with the app closed and with it open;
  `remora` on a folder already in a group; `remora some-file.md` prints an error.
