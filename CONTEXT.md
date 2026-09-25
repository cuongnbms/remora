# Remora — Glossary

- **Host**: a `Host` alias in `~/.ssh/config` (e.g. `devbox`). Remora stores no user/key/port; `ssh` reads all of that from the config.
- **Project**: a directory on a host, identified by `host` + an absolute `path`, with a display name. Every path in the app is relative to the project root.
- **Local project**: a project whose `host` is `local`: a directory on the Mac itself, read directly from the filesystem, not over SSH. This is why an SSH alias named `local` can't be used.
- **Group**: a group of projects in the left sidebar, for display organization only.
- **Watcher**: the file-change watch session for the selected project (remote: inotify if available, polling otherwise; local: FSEvents).
- **Transfer**: copying a file/folder between the Mac and a project, in two directions: Upload and Download. Never overwrites: a name clash is renamed Finder-style (`a (1).md`).
- **Upload**: a Transfer from the Mac into a project directory, by drag-and-drop onto the file tree. This is the only way Remora writes to a host (see ADR-0002). _Avoid_: "sync", "push".
- **Download**: a Transfer of a project file/folder to `~/Downloads` on the Mac. _Avoid_: "export", "pull".
