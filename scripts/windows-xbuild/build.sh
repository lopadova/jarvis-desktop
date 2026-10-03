#!/usr/bin/env bash
# Runs inside the container. Two modes:
#  - /xwin-sdk mounted (an `xwin splat` output: crt/ + sdk/): plain cargo + clang-cl + lld-link, no downloads;
#  - otherwise: cargo-xwin, which downloads the Microsoft CRT/SDK itself.
set -euo pipefail
PROFILE="${1:-release}"
FLAGS=(--target x86_64-pc-windows-msvc --features custom-protocol)
[ "$PROFILE" = "release" ] && FLAGS+=(--release)

if [ -d /xwin-sdk/crt ] && [ -d /xwin-sdk/sdk ]; then
  X=/opt/xwin
  if [ ! -f "$X/.ready" ] || [ ! -d "$X/sdk/include" ]; then
    # $X may be a volume mount point: clear its contents, not the directory itself.
    mkdir -p "$X"
    find "$X" -mindepth 1 -delete
    cp -r /xwin-sdk/crt /xwin-sdk/sdk "$X/"
    # Windows is case-insensitive; Linux isn't. Add lowercase aliases (Windows.h → windows.h, Kernel32.Lib → kernel32.lib).
    find "$X" -depth -type f | while read -r f; do
      d=$(dirname "$f"); b=$(basename "$f"); l=$(echo "$b" | tr 'A-Z' 'a-z')
      if [ "$b" != "$l" ] && [ ! -e "$d/$l" ]; then ln -s "$b" "$d/$l"; fi
      # Linker directives also ask for UPPERCASE stems (LIBCMT.lib, OLDNAMES.lib).
      case "$b" in *.lib|*.Lib|*.LIB)
        u="$(echo "${b%.*}" | tr 'a-z' 'A-Z').lib"
        if [ "$b" != "$u" ] && [ ! -e "$d/$u" ]; then ln -s "$b" "$d/$u"; fi ;;
      esac
    done
    # Mixed-case names some crates link verbatim.
    for pair in "pathcch.lib:PathCch.lib" "shlwapi.lib:ShLwApi.lib" "version.lib:Version.lib"; do
      src="${pair%%:*}"; dst="${pair##*:}"
      for dir in "$X"/sdk/lib/um/x86_64; do
        if [ -e "$dir/$src" ] && [ ! -e "$dir/$dst" ]; then ln -s "$src" "$dir/$dst"; fi
      done
    done
    touch "$X/.ready"
  fi
  LLVM=$(ls -d /usr/lib/llvm-*/bin | sort -V | tail -1)
  # Debian's LLVM ships no `clang-cl` alias: clang behaves as clang-cl when invoked under that name.
  mkdir -p /opt/xbin && ln -sf "$LLVM/clang" /opt/xbin/clang-cl
  export PATH="/opt/xbin:$LLVM:$PATH"
  inc=(crt/include sdk/include/ucrt sdk/include/um sdk/include/shared sdk/include/winrt)
  CL="-Wno-unused-command-line-argument -fuse-ld=lld-link"
  for i in "${inc[@]}"; do CL="$CL /imsvc $X/$i"; done
  export CC_x86_64_pc_windows_msvc=clang-cl CXX_x86_64_pc_windows_msvc=clang-cl AR_x86_64_pc_windows_msvc=llvm-lib
  export CFLAGS_x86_64_pc_windows_msvc="$CL" CXXFLAGS_x86_64_pc_windows_msvc="$CL /EHsc"
  export RC_x86_64_pc_windows_msvc=llvm-rc
  export CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER=lld-link
  export CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS="-Lnative=$X/crt/lib/x86_64 -Lnative=$X/sdk/lib/um/x86_64 -Lnative=$X/sdk/lib/ucrt/x86_64"
  # llvm-rc needs the SDK headers for the Tauri resource file.
  export INCLUDE="$X/crt/include;$X/sdk/include/ucrt;$X/sdk/include/um;$X/sdk/include/shared"
  cargo build "${FLAGS[@]}"
else
  build() { cargo xwin build "${FLAGS[@]}"; }
  if ! build; then
    # The Windows SDK ships PathCch.lib but some crates link `pathcch.lib`; Linux filesystems are case-sensitive.
    for dir in "$HOME"/.cache/cargo-xwin/xwin/sdk/lib/um/x86_64; do
      [ -f "$dir/PathCch.lib" ] && ln -sf PathCch.lib "$dir/pathcch.lib"
    done
    build
  fi
fi
mkdir -p /out
cp "/target/x86_64-pc-windows-msvc/$PROFILE/jarvis-desktop.exe" /out/
echo "Built /out/jarvis-desktop.exe"
