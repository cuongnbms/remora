# ADR-0002: Remora writes to a host only via Upload, and Upload never overwrites

- Date: 2026-09-25
- Status: Accepted

## Context

Remora is designed as a **read-only** app ([ADR-0001](./0001-tauri-and-system-ssh.md)): "editing files" is out of scope. But users need to hand input to agents (screenshots, documents, sample files) on a project on a dev box without opening a terminal and typing `scp`.

## Decision

Remora may write to a host, but **only** via Upload (drag-and-drop from Finder onto the file tree). Upload only creates new entries: a name clash is renamed Finder-style (`a (1).md`), and the final step uses `mv -n`, so even a race cannot overwrite anything. Editing, deleting, renaming, and moving files on the host remain out of scope.

Rationale: agents are working in the same directory, so a mistaken drag-and-drop must never destroy an agent's files. Create-only keeps the promise that "Remora never breaks anything on the dev box" while still covering the need to provide input.

## Consequences

- There is no "overwrite" or "replace" button. To replace a file, the user has to delete the old one outside Remora.
- An upload that fails midway can leave a hidden `.remora-upload.*` directory on the host if ssh hangs before the `trap` runs.

## Alternatives considered

| Option | Why not chosen |
|---|---|
| Ask to confirm Overwrite / Skip | Adds a dialog to a flow that should be fast; can still overwrite a file an agent is using. |
| Always overwrite | Can destroy a file an agent is writing, with no way to recover. |
| Also allow edit/delete/rename | Turns Remora into a file manager, far beyond the need, and breaks the "never breaks anything" promise. |
