//! Folders handed to the app by macOS (`open -a Remora <dir>`, which the `remora` command runs).

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State, Url};

use crate::local_fs::is_local;
use crate::AppState;

/// Folders received but not yet taken by the frontend. Managed on the builder, so it exists
/// before `setup` runs and a folder that arrives during launch is kept until the UI is ready.
#[derive(Default)]
pub struct PendingOpens(pub Mutex<Vec<String>>);

/// The existing directories among `urls`, as absolute paths without a trailing `/` (but `/` stays).
pub fn folders_from_urls(urls: &[Url]) -> Vec<String> {
    urls.iter()
        .filter_map(|u| u.to_file_path().ok())
        .filter(|p| p.is_dir())
        .map(|p| {
            let s = p.to_string_lossy();
            let trimmed = s.trim_end_matches('/');
            if trimmed.is_empty() { "/".to_string() } else { trimmed.to_string() }
        })
        .collect()
}

/// Each folder as the path of the stored local project it resolves to, if any: macOS hands over the
/// resolved path (`/private/tmp/x`), while a project may be stored through a symlink (`/tmp/x`).
pub fn prefer_stored_paths(folders: Vec<String>, stored: &[String]) -> Vec<String> {
    let resolved: Vec<(PathBuf, &String)> =
        stored.iter().filter_map(|s| std::fs::canonicalize(s).ok().map(|c| (c, s))).collect();
    folders
        .into_iter()
        .map(|folder| {
            let Ok(canonical) = std::fs::canonicalize(&folder) else { return folder };
            resolved.iter().find(|(c, _)| *c == canonical).map_or(folder, |(_, s)| (*s).clone())
        })
        .collect()
}

/// Queues the folders among `urls`, tells the frontend to take them, and brings the window forward.
pub fn receive(app: &AppHandle, urls: &[Url]) {
    let folders = folders_from_urls(urls);
    if folders.is_empty() {
        return;
    }
    app.state::<PendingOpens>().0.lock().unwrap().extend(folders);
    let _ = app.emit("open-folders", ());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The folders received since the last call; the only way they reach the frontend.
#[tauri::command]
pub fn take_pending_opens(pending: State<'_, PendingOpens>, state: State<'_, AppState>) -> Vec<String> {
    let folders = std::mem::take(&mut *pending.0.lock().unwrap());
    let local: Vec<String> =
        state.config.get().projects().filter(|p| is_local(&p.host)).map(|p| p.path.clone()).collect();
    prefer_stored_paths(folders, &local)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::Url;

    #[test]
    fn keeps_only_existing_directories_from_file_urls() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("Kế hoạch dự án");
        std::fs::create_dir(&folder).unwrap();
        let file = dir.path().join("note.md");
        std::fs::write(&file, "x").unwrap();
        let urls = vec![
            Url::from_directory_path(&folder).unwrap(), // trailing '/', percent-encoded
            Url::from_file_path(&file).unwrap(),
            Url::from_file_path(dir.path().join("missing")).unwrap(),
            Url::parse("https://example.com/x").unwrap(),
        ];
        assert_eq!(folders_from_urls(&urls), vec![folder.to_string_lossy().into_owned()]);
    }

    #[test]
    fn a_folder_reached_through_a_symlink_maps_to_the_stored_project_path() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real");
        std::fs::create_dir(&real).unwrap();
        let via = dir.path().join("via");
        std::os::unix::fs::symlink(&real, &via).unwrap();
        let other = dir.path().join("other");
        std::fs::create_dir(&other).unwrap();
        // macOS hands over the resolved path; the project was stored through the symlink.
        let received = std::fs::canonicalize(&real).unwrap().to_string_lossy().into_owned();
        let stored = vec![via.to_string_lossy().into_owned(), "/missing/project".to_string()];
        let other_s = other.to_string_lossy().into_owned();
        assert_eq!(
            prefer_stored_paths(vec![received, other_s.clone()], &stored),
            vec![via.to_string_lossy().into_owned(), other_s]
        );
    }

    #[test]
    fn root_stays_a_single_slash() {
        assert_eq!(folders_from_urls(&[Url::parse("file:///").unwrap()]), vec!["/".to_string()]);
    }
}
