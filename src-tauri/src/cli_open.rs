//! Folders handed to the app by macOS (`open -a Remora <dir>`, which the `remora` command runs).

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State, Url};

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
pub fn take_pending_opens(pending: State<'_, PendingOpens>) -> Vec<String> {
    std::mem::take(&mut *pending.0.lock().unwrap())
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
    fn root_stays_a_single_slash() {
        assert_eq!(folders_from_urls(&[Url::parse("file:///").unwrap()]), vec!["/".to_string()]);
    }
}
