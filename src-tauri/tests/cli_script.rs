//! The `remora` shell script, run with a fake `open` that prints its arguments.

use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const SCRIPT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/bin/remora");

struct Setup {
    _tmp: tempfile::TempDir,
    root: PathBuf,
    /// ~/.local/bin/remora: a symlink to the script inside the bundle.
    link: PathBuf,
    fake_bin: PathBuf,
}

fn setup() -> Setup {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().to_path_buf();
    let bin = root.join("Remora.app/Contents/Resources/bin");
    std::fs::create_dir_all(&bin).unwrap();
    std::fs::copy(SCRIPT, bin.join("remora")).unwrap();
    std::fs::set_permissions(bin.join("remora"), std::fs::Permissions::from_mode(0o755)).unwrap();
    let local_bin = root.join("local/bin");
    std::fs::create_dir_all(&local_bin).unwrap();
    let link = local_bin.join("remora");
    symlink(bin.join("remora"), &link).unwrap();
    let fake_bin = root.join("fake");
    std::fs::create_dir_all(&fake_bin).unwrap();
    std::fs::write(fake_bin.join("open"), "#!/bin/sh\nprintf '%s\\n' \"$@\"\n").unwrap();
    std::fs::set_permissions(fake_bin.join("open"), std::fs::Permissions::from_mode(0o755)).unwrap();
    Setup { _tmp: tmp, root, link, fake_bin }
}

fn run(s: &Setup, args: &[&str], cwd: &Path) -> Output {
    let path = format!("{}:{}", s.fake_bin.display(), std::env::var("PATH").unwrap());
    Command::new(&s.link).args(args).current_dir(cwd).env("PATH", path).output().unwrap()
}

#[test]
fn opens_the_bundle_holding_the_script_with_the_folder_as_typed() {
    let s = setup();
    let real = s.root.join("real project");
    std::fs::create_dir(&real).unwrap();
    let via = s.root.join("via");
    symlink(&real, &via).unwrap();

    let out = run(&s, &[via.to_str().unwrap()], &s.root);
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let app = std::fs::canonicalize(s.root.join("Remora.app")).unwrap();
    assert_eq!(
        String::from_utf8(out.stdout).unwrap(),
        format!("-a\n{}\n{}\n", app.display(), via.display())
    );
}

#[test]
fn defaults_to_the_current_folder() {
    let s = setup();
    let out = run(&s, &[], &s.root);
    assert!(out.status.success());
    let lines: Vec<String> = String::from_utf8(out.stdout).unwrap().lines().map(String::from).collect();
    assert_eq!(std::fs::canonicalize(&lines[2]).unwrap(), std::fs::canonicalize(&s.root).unwrap());
}

#[test]
fn refuses_a_file_and_extra_arguments() {
    let s = setup();
    std::fs::write(s.root.join("note.md"), "x").unwrap();
    let file = run(&s, &["note.md"], &s.root);
    assert_eq!(file.status.code(), Some(1));
    assert_eq!(String::from_utf8_lossy(&file.stderr), "remora: not a folder: note.md\n");
    let extra = run(&s, &["a", "b"], &s.root);
    assert_eq!(extra.status.code(), Some(2));
    assert_eq!(String::from_utf8_lossy(&extra.stderr), "usage: remora [folder]\n");
}
