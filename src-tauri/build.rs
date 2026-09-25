fn main() {
    println!("cargo:rustc-check-cfg=cfg(remora_remote_tests)");
    println!("cargo:rerun-if-env-changed=REMORA_TEST_HOST");
    if std::env::var_os("REMORA_TEST_HOST").is_some() {
        println!("cargo:rustc-cfg=remora_remote_tests");
    }
    tauri_build::build()
}
