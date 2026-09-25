//! Runs only when REMORA_TEST_HOST is set, e.g. `REMORA_TEST_HOST=devbox cargo test --test remote`.
use std::fs;
use std::sync::Arc;
use std::time::Duration;

use remora_lib::error::AppError;
use remora_lib::paths::sq;
use remora_lib::remote_fs;
use remora_lib::ssh::SshPool;
use remora_lib::transfer;
use remora_lib::watcher::Poller;

fn setup() -> (String, SshPool) {
    let host =
        std::env::var("REMORA_TEST_HOST").expect("REMORA_TEST_HOST must be set for remote tests");
    let ssh_dir = dirs::home_dir().unwrap().join(".ssh");
    (host, SshPool::new(ssh_dir, Arc::new(|_| {})))
}

#[tokio::test]
#[cfg_attr(not(remora_remote_tests), ignore = "set REMORA_TEST_HOST to run")]
async fn remote_roundtrip_with_awkward_names() {
    let (host, pool) = setup();
    let dir = format!("/tmp/remora-it-{}", std::process::id());
    let file = format!("{dir}/a b's Kế.md");
    pool.run_ok(
        &host,
        &format!(
            "mkdir -p {} && printf 'hello' > {}",
            sq(&format!("{dir}/sub")),
            sq(&file)
        ),
    )
    .await
    .unwrap();

    let entries = remote_fs::list_dir(&pool, &host, &dir).await.unwrap();
    let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, ["sub", "a b's Kế.md"]);

    let content = remote_fs::read_file(&pool, &host, &file).await.unwrap();
    assert_eq!(content.content, "hello");

    let missing = remote_fs::read_file(&pool, &host, &format!("{dir}/nope.md")).await;
    assert!(
        matches!(missing, Err(AppError::NotFound(_))),
        "got {missing:?}"
    );

    let files = remote_fs::list_files(&pool, &host, &dir, &["sub".to_string()]).await.unwrap();
    assert_eq!(files, vec!["a b's Kế.md".to_string()]);

    pool.run_ok(&host, &format!("rm -rf {}", sq(&dir)))
        .await
        .unwrap();
}

#[tokio::test]
#[cfg_attr(not(remora_remote_tests), ignore = "set REMORA_TEST_HOST to run")]
async fn upload_then_download_roundtrip_never_overwrites() {
    let (host, pool) = setup();
    let dir = format!("/tmp/remora-xfer-{}", std::process::id());
    pool.run_ok(&host, &format!("rm -rf {0} && mkdir -p {0}", sq(&dir))).await.unwrap();

    let local = tempfile::tempdir().unwrap();
    let folder = local.path().join("in it's Kế");
    fs::create_dir_all(folder.join("sub")).unwrap();
    fs::write(folder.join("sub/a b.md"), "hello").unwrap();
    std::os::unix::fs::symlink("sub/a b.md", folder.join("link.md")).unwrap();
    fs::write(local.path().join("-dash.txt"), "d").unwrap();
    let paths = vec![
        folder.to_str().unwrap().to_string(),
        local.path().join("-dash.txt").to_str().unwrap().to_string(),
    ];

    let existing = remote_fs::list_dir(&pool, &host, &dir).await.unwrap();
    let first = transfer::upload_remote(&pool, &host, &dir, &existing, transfer::check_sources(&paths).unwrap()).unwrap();
    assert_eq!(first, ["in it's Kế", "-dash.txt"]);
    let existing = remote_fs::list_dir(&pool, &host, &dir).await.unwrap();
    let second = transfer::upload_remote(&pool, &host, &dir, &existing, transfer::check_sources(&paths).unwrap()).unwrap();
    assert_eq!(second, ["in it's Kế (1)", "-dash (1).txt"]);

    let names: Vec<_> = remote_fs::list_dir(&pool, &host, &dir).await.unwrap().into_iter().map(|e| e.name).collect();
    assert_eq!(names, ["in it's Kế", "in it's Kế (1)", "-dash (1).txt", "-dash.txt"]);
    let body = remote_fs::read_file(&pool, &host, &format!("{dir}/in it's Kế/sub/a b.md")).await.unwrap();
    assert_eq!(body.content, "hello");
    let link = pool.run_ok(&host, &format!("readlink {}", sq(&format!("{dir}/in it's Kế/link.md")))).await.unwrap();
    assert_eq!(String::from_utf8_lossy(&link).trim(), "sub/a b.md");

    let downloads = tempfile::tempdir().unwrap();
    let saved = transfer::download_remote(&pool, &host, &format!("{dir}/in it's Kế"), downloads.path()).unwrap();
    assert_eq!(saved, downloads.path().join("in it's Kế"));
    assert_eq!(fs::read_to_string(saved.join("sub/a b.md")).unwrap(), "hello");
    assert_eq!(fs::read_link(saved.join("link.md")).unwrap(), std::path::PathBuf::from("sub/a b.md"));
    let again = transfer::download_remote(&pool, &host, &format!("{dir}/in it's Kế"), downloads.path()).unwrap();
    assert_eq!(again, downloads.path().join("in it's Kế (1)"));

    let missing_dest = transfer::upload_remote(&pool, &host, &format!("{dir}/nope"), &[], transfer::check_sources(&paths).unwrap());
    assert!(matches!(missing_dest, Err(AppError::NotFound(_))), "got {missing_dest:?}");
    let missing_src = transfer::download_remote(&pool, &host, &format!("{dir}/nope.md"), downloads.path());
    assert!(matches!(missing_src, Err(AppError::NotFound(_))), "got {missing_src:?}");
    let leftovers = pool.run_ok(&host, &format!("find {} -name '.remora-upload.*'", sq(&dir))).await.unwrap();
    assert!(leftovers.is_empty(), "staging dirs left behind");

    pool.run_ok(&host, &format!("rm -rf {}", sq(&dir))).await.unwrap();
}

async fn inotify_running(pool: &SshPool, host: &str, dir: &str) -> bool {
    let out = pool.run(host, &format!("pgrep -f {}", sq(&format!("^inotifywait .*{dir}")))).await.unwrap();
    !out.stdout.is_empty()
}

#[tokio::test]
#[cfg_attr(not(remora_remote_tests), ignore = "set REMORA_TEST_HOST to run")]
async fn inotify_watcher_dies_with_its_ssh_session() {
    let (host, pool) = setup();
    let dir = format!("/tmp/remora-inotify-{}", std::process::id());
    pool.run_ok(&host, &format!("mkdir -p {}", sq(&dir))).await.unwrap();

    let mut child = remora_lib::watch_manager::spawn_inotify(&pool, &host, &dir, &[]).unwrap();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while !inotify_running(&pool, &host, &dir).await {
        assert!(tokio::time::Instant::now() < deadline, "inotifywait never started");
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    // While the session is open the watcher stays up and reports events.
    let mut lines = tokio::io::AsyncBufReadExt::lines(tokio::io::BufReader::new(child.stdout.take().unwrap()));
    tokio::time::sleep(Duration::from_millis(1500)).await;
    pool.run_ok(&host, &format!("touch {}", sq(&format!("{dir}/a.md")))).await.unwrap();
    let line = tokio::time::timeout(Duration::from_secs(5), lines.next_line()).await.expect("no event").unwrap();
    assert!(line.is_some_and(|l| l.ends_with(&format!("{dir}/a.md"))), "watcher stopped early");

    // Dropping the child kills the local ssh; nothing happens in `dir`, so only the
    // closed session can end the remote process.
    drop(child);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while inotify_running(&pool, &host, &dir).await {
        assert!(tokio::time::Instant::now() < deadline, "inotifywait outlived its ssh session");
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    pool.run_ok(&host, &format!("rm -rf {}", sq(&dir))).await.unwrap();
}

#[tokio::test]
#[cfg_attr(not(remora_remote_tests), ignore = "set REMORA_TEST_HOST to run")]
async fn inotify_watcher_puts_no_watches_in_excluded_dirs() {
    let (host, pool) = setup();
    let dir = format!("/tmp/remora-inotify-ex-{}", std::process::id());
    pool.run_ok(
        &host,
        &format!("mkdir -p {d}/src/a {d}/node_modules/x/y {d}/src/venv/lib {d}/sp\\ ace/.git/o", d = sq(&dir)),
    )
    .await
    .unwrap();
    let excludes = vec!["node_modules".to_string(), "venv".into(), ".git".into()];
    let mut child = remora_lib::watch_manager::spawn_inotify(&pool, &host, &dir, &excludes).unwrap();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while !inotify_running(&pool, &host, &dir).await {
        assert!(tokio::time::Instant::now() < deadline, "inotifywait never started");
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    tokio::time::sleep(Duration::from_millis(1500)).await;

    // Watched: the root, src, src/a and it's. Nothing under node_modules, venv or .git.
    let count = pool
        .run_ok(&host, &format!("cat /proc/$(pgrep -f {})/fdinfo/* | grep -c '^inotify'", sq(&format!("^inotifywait .*{dir}"))))
        .await
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&count).trim(), "4");

    let mut lines = tokio::io::AsyncBufReadExt::lines(tokio::io::BufReader::new(child.stdout.take().unwrap()));
    pool.run_ok(
        &host,
        &format!("touch {d}/node_modules/x/q {d}/src/venv/r; mkdir {d}/src/a/node_modules; touch {d}/src/a/node_modules/s {d}/src/a/t.md", d = sq(&dir)),
    )
    .await
    .unwrap();
    let mut seen = Vec::new();
    while let Ok(Ok(Some(line))) = tokio::time::timeout(Duration::from_secs(2), lines.next_line()).await {
        seen.push(line);
    }
    assert_eq!(
        seen,
        [format!("CREATE,ISDIR|{dir}/src/a/node_modules"), format!("CREATE|{dir}/src/a/t.md"), format!("CLOSE_WRITE,CLOSE|{dir}/src/a/t.md")],
    );

    drop(lines);
    drop(child);
    pool.run_ok(&host, &format!("rm -rf {}", sq(&dir))).await.unwrap();
}

#[tokio::test]
#[cfg_attr(not(remora_remote_tests), ignore = "set REMORA_TEST_HOST to run")]
async fn inotify_watcher_reports_why_it_exited() {
    let (host, pool) = setup();
    let mut child = remora_lib::watch_manager::spawn_inotify(&pool, &host, "/nonexistent/remora-nope", &[]).unwrap();
    let mut stdout = child.stdout.take().unwrap();
    let mut out = Vec::new();
    tokio::time::timeout(Duration::from_secs(10), tokio::io::AsyncReadExt::read_to_end(&mut stdout, &mut out))
        .await
        .expect("stdout never closed after inotifywait failed")
        .unwrap();
    let msg = remora_lib::watch_manager::exit_reason(&mut child).await;
    assert!(msg.contains("/nonexistent/remora-nope"), "{msg}");
}

#[tokio::test]
#[cfg_attr(not(remora_remote_tests), ignore = "set REMORA_TEST_HOST to run")]
async fn polling_sees_writes_and_deletes() {
    let (host, pool) = setup();
    let dir = format!("/tmp/remora-poll-{}", std::process::id());
    pool.run_ok(
        &host,
        &format!(
            "mkdir -p {d}/docs && printf x > {d}/docs/a.md",
            d = sq(&dir)
        ),
    )
    .await
    .unwrap();
    let now: i64 = String::from_utf8(pool.run_ok(&host, "date +%s").await.unwrap())
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    let mut poller = Poller::new(now);
    tokio::time::sleep(Duration::from_millis(1100)).await;

    pool.run_ok(
        &host,
        &format!("printf y >> {}", sq(&format!("{dir}/docs/a.md"))),
    )
    .await
    .unwrap();
    let out = pool
        .run(&host, &remora_lib::watcher::poll_cmd(&dir, poller.since(), &[]))
        .await
        .unwrap();
    let changes = poller.apply(&out.stdout);
    assert!(
        changes.iter().any(|c| c.path == "docs/a.md" && !c.is_dir),
        "{changes:?}"
    );

    tokio::time::sleep(Duration::from_millis(1100)).await;
    pool.run_ok(&host, &format!("rm {}", sq(&format!("{dir}/docs/a.md"))))
        .await
        .unwrap();
    let out = pool
        .run(&host, &remora_lib::watcher::poll_cmd(&dir, poller.since(), &[]))
        .await
        .unwrap();
    let changes = poller.apply(&out.stdout);
    assert!(
        changes.iter().any(|c| c.path == "docs" && c.is_dir),
        "{changes:?}"
    );

    pool.run_ok(&host, &format!("rm -rf {}", sq(&dir)))
        .await
        .unwrap();
}
