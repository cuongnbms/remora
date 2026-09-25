# ADR-0001: Tauri 2 + system `ssh` instead of Electron / an SSH library

- Date: 2026-09-25
- Status: Accepted

## Context

Remora is a read-only desktop app, open all day next to the terminal and agents, connecting to dev boxes over SSH.

## Decision

1. Use **Tauri 2** (Rust backend + React webview) instead of Electron.
2. Connect with the **system `ssh` binary** using `ControlMaster`, not an SSH library (russh/ssh2).

## Rationale

- The backend only spawns processes and streams output (a few hundred lines of Rust), so the cost of Rust is low; in return the bundle is ~10MB and RAM use is much lower than Electron.
- System `ssh` supports `~/.ssh/config` out of the box (aliases, ProxyJump, IdentityFile, agent, known_hosts), which a library would have to reimplement; with `ControlMaster` each command costs only a few tens of ms.

## Consequences

- The webview is WKWebView (Safari) on macOS: CSS/mermaid must be checked on Safari.
- No password login inside the app (`BatchMode=yes`); hosts must use a key/agent.
- Every operation is a shell command on the remote → paths must be quoted carefully.
