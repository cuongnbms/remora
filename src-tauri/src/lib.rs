pub mod config;
pub mod error;
pub mod fonts;
pub mod local_fs;
pub mod paths;
pub mod remote_fs;
pub mod ssh;
pub mod ssh_config;
pub mod transfer;
pub mod watch_manager;
pub mod watcher;

use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, State, Wry};

use config::{Config, ConfigStore};
use error::{AppError, AppResult};
use remote_fs::{Entry, FileContent};
use ssh::{HostStatus, SshPool, StatusSink};
use watch_manager::{ChangeSink, WatcherManager};
use watcher::Change;

pub struct AppState {
    config: ConfigStore,
    pool: Arc<SshPool>,
    watcher: WatcherManager,
    config_warning: Mutex<Option<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadedConfig {
    config: Config,
    warning: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FsChanged {
    project_id: String,
    changes: Vec<Change>,
}

/// Run blocking local filesystem work off the async runtime.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| AppError::Other(e.to_string()))?
}

#[tauri::command]
fn load_config(state: State<'_, AppState>) -> LoadedConfig {
    LoadedConfig { config: state.config.get(), warning: state.config_warning.lock().unwrap().take() }
}

#[tauri::command]
fn save_config(state: State<'_, AppState>, config: Config) -> AppResult<()> {
    state.config.save(config)
}

#[tauri::command]
async fn list_fonts() -> Vec<fonts::FontFamily> {
    // Enumerating every family takes a moment; keep it off the main thread.
    tauri::async_runtime::spawn_blocking(fonts::list_families).await.unwrap_or_default()
}

#[tauri::command]
fn list_ssh_hosts() -> Vec<String> {
    dirs::home_dir().map(|home| ssh_config::list_hosts(&home)).unwrap_or_default()
}

#[tauri::command]
async fn list_remote_dir(state: State<'_, AppState>, host: String, path: String) -> AppResult<Vec<Entry>> {
    paths::validate_host(&host)?;
    paths::validate_root(&path)?;
    if local_fs::is_local(&host) {
        return blocking(move || local_fs::list_dir(&path)).await;
    }
    remote_fs::list_dir(&state.pool, &host, &path).await
}

#[tauri::command]
async fn list_dir(state: State<'_, AppState>, project_id: String, rel: String) -> AppResult<Vec<Entry>> {
    let p = state.config.project(&project_id)?;
    let abs = paths::resolve(&p.path, &rel)?;
    if local_fs::is_local(&p.host) {
        return blocking(move || local_fs::list_dir(&abs)).await;
    }
    remote_fs::list_dir(&state.pool, &p.host, &abs).await
}

#[tauri::command]
async fn read_file(state: State<'_, AppState>, project_id: String, rel: String) -> AppResult<FileContent> {
    let p = state.config.project(&project_id)?;
    let abs = paths::resolve(&p.path, &rel)?;
    if local_fs::is_local(&p.host) {
        return blocking(move || local_fs::read_file(&abs)).await;
    }
    remote_fs::read_file(&state.pool, &p.host, &abs).await
}

#[tauri::command]
async fn read_image(state: State<'_, AppState>, project_id: String, rel: String) -> AppResult<String> {
    let p = state.config.project(&project_id)?;
    let abs = paths::resolve(&p.path, &rel)?;
    if local_fs::is_local(&p.host) {
        return blocking(move || local_fs::read_image(&abs)).await;
    }
    remote_fs::read_image(&state.pool, &p.host, &abs).await
}

#[tauri::command]
async fn list_files(state: State<'_, AppState>, project_id: String) -> AppResult<Vec<String>> {
    let p = state.config.project(&project_id)?;
    let excludes = state.config.get().settings.excludes;
    if local_fs::is_local(&p.host) {
        return blocking(move || local_fs::list_files(&p.path, &excludes)).await;
    }
    remote_fs::list_files(&state.pool, &p.host, &p.path, &excludes).await
}

#[tauri::command]
async fn upload(state: State<'_, AppState>, project_id: String, dest_rel: String, sources: Vec<String>) -> AppResult<Vec<String>> {
    let p = state.config.project(&project_id)?;
    let dest = paths::resolve(&p.path, &dest_rel)?;
    let sources = transfer::check_sources(&sources)?;
    if local_fs::is_local(&p.host) {
        return blocking(move || transfer::upload_local(std::path::Path::new(&dest), &sources)).await;
    }
    // A missing or unreadable dest fails here with NotFound / InvalidPath before anything is sent.
    // If dest is a file, list_dir succeeds with an empty listing instead; the failure then comes
    // later, from the remote `mktemp` ("Not a directory" -> InvalidPath) after the stream has started.
    let existing = remote_fs::list_dir(&state.pool, &p.host, &dest).await?;
    let pool = state.pool.clone();
    blocking(move || transfer::upload_remote(&pool, &p.host, &dest, &existing, sources)).await
}

#[tauri::command]
async fn download(state: State<'_, AppState>, project_id: String, rel: String) -> AppResult<String> {
    let p = state.config.project(&project_id)?;
    let abs = transfer::download_target(&p.path, &rel)?;
    let downloads = transfer::downloads_dir()?;
    let saved = if local_fs::is_local(&p.host) {
        blocking(move || transfer::download_local(std::path::Path::new(&abs), &downloads)).await?
    } else {
        let pool = state.pool.clone();
        blocking(move || transfer::download_remote(&pool, &p.host, &abs, &downloads)).await?
    };
    Ok(saved.to_string_lossy().into_owned())
}

#[tauri::command]
fn watch_project(app: AppHandle, state: State<'_, AppState>, project_id: String) -> AppResult<()> {
    let project = state.config.project(&project_id)?;
    let sink: ChangeSink = Arc::new(move |project_id, changes| {
        let _ = app.emit("fs-changed", FsChanged { project_id, changes });
    });
    state.watcher.start(state.pool.clone(), project, state.config.get().settings.excludes, sink);
    Ok(())
}

#[tauri::command]
fn unwatch(state: State<'_, AppState>) {
    state.watcher.stop();
}

#[tauri::command]
fn host_statuses(state: State<'_, AppState>) -> Vec<HostStatus> {
    state.pool.statuses()
}

/// A minimal menu: no "Close Window" so ⌘W reaches the webview (close tab), but keep Copy/Select All.
fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let app_menu = Submenu::with_items(
        app,
        "Remora",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[&PredefinedMenuItem::copy(app, None)?, &PredefinedMenuItem::select_all(app, None)?],
    )?;
    Menu::with_items(app, &[&app_menu, &edit_menu])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let status_sink: StatusSink = Arc::new(move |status| {
                let _ = handle.emit("host-status", status);
            });
            let home = dirs::home_dir().ok_or("cannot find home directory")?;
            let ssh_dir = home.join(".ssh");
            std::fs::create_dir_all(&ssh_dir)?;
            let data_dir = dirs::data_dir().ok_or("cannot find data directory")?.join("remora");
            let (config, warning) = ConfigStore::load(data_dir.join("config.json"));
            app.manage(AppState {
                config,
                pool: Arc::new(SshPool::new(ssh_dir, status_sink)),
                watcher: WatcherManager::default(),
                config_warning: Mutex::new(warning),
            });
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            list_ssh_hosts,
            list_fonts,
            list_remote_dir,
            list_dir,
            read_file,
            read_image,
            list_files,
            upload,
            download,
            watch_project,
            unwatch,
            host_statuses
        ])
        .run(tauri::generate_context!())
        .expect("error while running Remora");
}
