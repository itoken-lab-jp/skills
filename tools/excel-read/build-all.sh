#!/usr/bin/env bash
# skills/excel-read/scripts の3つの exe を、Linux の上でまとめて作り直す。ソース（src・Cargo.toml・Cargo.lock・build.rs）を
# 変えたら走らせ、exe もコミットする（古い exe は test/excel-read.test.mjs が指紋の食い違いで赤にする）。
# 要るもの：rustup の target（x86_64-pc-windows-gnu・aarch64-apple-darwin・x86_64-unknown-linux-musl）、
# mingw-w64（Windows 用のリンカー）、zig と cargo-zigbuild（Mac 用。zig が ad-hoc の署名を入れる）。
# Cargo.lock を変えたら make-notices.py で skills/excel-read/THIRD_PARTY_NOTICES.md も作り直す。
set -euo pipefail
cd "$(dirname "$0")"
out=../../skills/excel-read/scripts
cargo zigbuild --release --target aarch64-apple-darwin
CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc cargo build --release --target x86_64-pc-windows-gnu
cargo build --release --target x86_64-unknown-linux-musl
mkdir -p "$out/mac-arm64" "$out/windows-x64" "$out/linux-x64"
cp target/aarch64-apple-darwin/release/excel-read "$out/mac-arm64/excel-read"
cp target/x86_64-pc-windows-gnu/release/excel-read.exe "$out/windows-x64/excel-read.exe"
cp target/x86_64-unknown-linux-musl/release/excel-read "$out/linux-x64/excel-read"
chmod +x "$out/mac-arm64/excel-read" "$out/linux-x64/excel-read"
"$out/linux-x64/excel-read" --version
