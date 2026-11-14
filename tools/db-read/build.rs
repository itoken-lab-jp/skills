// ソースの指紋を exe に焼き込む。skills/db-read/scripts の exe がソースと食い違っていないかを、
// test/db-read.test.mjs が同じ計算で確かめる（計算を変えるときは両方を直す）。
use std::fs;
use std::path::Path;

fn fnv1a(hash: &mut u64, bytes: &[u8]) {
    for b in bytes {
        *hash ^= *b as u64;
        *hash = hash.wrapping_mul(0x100000001b3);
    }
}

fn main() {
    let mut files = vec!["Cargo.toml".to_string(), "Cargo.lock".to_string(), "build.rs".to_string()];
    let mut src: Vec<String> = fs::read_dir("src")
        .unwrap()
        .map(|e| format!("src/{}", e.unwrap().file_name().to_string_lossy()))
        .collect();
    src.sort();
    files.extend(src);
    // 手直ししたクレートの、変えたファイル（vendor/README.md）
    files.push("vendor/mysql/src/io/tls/rustls_io.rs".to_string());
    let mut hash: u64 = 0xcbf29ce484222325;
    for f in &files {
        println!("cargo:rerun-if-changed={f}");
        let text = fs::read_to_string(Path::new(f)).unwrap().replace("\r\n", "\n");
        fnv1a(&mut hash, f.as_bytes());
        fnv1a(&mut hash, &[0]);
        fnv1a(&mut hash, text.as_bytes());
        fnv1a(&mut hash, &[0]);
    }
    println!("cargo:rustc-env=SOURCE_HASH={hash:016x}");
}
