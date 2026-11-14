#!/usr/bin/env bash
# skills/db-read/scripts の Windows と Linux の exe を、Linux の上で作り直す。ソース（src・Cargo.toml・Cargo.lock・build.rs）を
# 変えたら走らせ、exe もコミットする（古い exe は test/db-read.test.mjs が指紋の食い違いで赤にする）。
# Mac の exe はここでは作れない（依存が Mac の framework を要るため）。PR に push すると Actions の
# db-read の mac-build が走るので、できた exe（artifact の db-read-mac-arm64）を skills/db-read/scripts/mac-arm64/ に置いてコミットする。
# 要るもの：rustup の target（x86_64-pc-windows-gnu・x86_64-unknown-linux-musl）、mingw-w64（Windows 用のリンカー）、musl-tools。
# Windows の WSL（Ubuntu 24.04）では、WSL の中で次を入れ、WSL の中に clone したリポジトリで走らせる
# （まっさらな Ubuntu 24.04 で、この手順だけで通るのを確かめた。2026-11-04。WSL の実機では確かめていない）。
#   sudo apt-get update && sudo apt-get install -y curl build-essential mingw-w64 musl-tools
#   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal && . "$HOME/.cargo/env"
#   rustup target add x86_64-pc-windows-gnu x86_64-unknown-linux-musl
set -euo pipefail
cd "$(dirname "$0")"
out=../../skills/db-read/scripts
CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc cargo build --release --target x86_64-pc-windows-gnu
cargo build --release --target x86_64-unknown-linux-musl
mkdir -p "$out/windows-x64" "$out/linux-x64"
cp target/x86_64-pc-windows-gnu/release/db-read.exe "$out/windows-x64/db-read.exe"
cp target/x86_64-unknown-linux-musl/release/db-read "$out/linux-x64/db-read"
chmod +x "$out/linux-x64/db-read"
"$out/linux-x64/db-read" --version
