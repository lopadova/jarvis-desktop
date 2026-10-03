#!/usr/bin/env bash
# Runs inside the container: cargo xwin build, with the case-sensitivity alias xwin needs on Linux.
set -euo pipefail
PROFILE="${1:-release}"
FLAGS=(--target x86_64-pc-windows-msvc)
[ "$PROFILE" = "release" ] && FLAGS+=(--release)
build() { cargo xwin build "${FLAGS[@]}"; }
if ! build; then
  # The Windows SDK ships PathCch.lib but some crates link `pathcch.lib`; Linux filesystems are case-sensitive.
  for dir in "$HOME"/.cache/cargo-xwin/xwin/sdk/lib/um/x86_64; do
    [ -f "$dir/PathCch.lib" ] && ln -sf PathCch.lib "$dir/pathcch.lib"
  done
  build
fi
mkdir -p /out
cp "/target/x86_64-pc-windows-msvc/$PROFILE/jarvis-desktop.exe" /out/
echo "Built /out/jarvis-desktop.exe"
