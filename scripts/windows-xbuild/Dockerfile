# Cross-compiles the Jarvis desktop shell for Windows (x86_64-pc-windows-msvc) from Linux.
# Use it when a local Windows toolchain can't run freshly compiled build scripts (e.g. Smart App Control).
# cargo-xwin downloads the Microsoft CRT + Windows SDK: building with it means accepting Microsoft's licence terms.
FROM rust:1.96-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends clang lld llvm cmake ninja-build \
 && rm -rf /var/lib/apt/lists/* \
 && rustup target add x86_64-pc-windows-msvc \
 && cargo install cargo-xwin --locked
ENV XWIN_ACCEPT_LICENSE=1 \
    CARGO_TARGET_DIR=/target
WORKDIR /src/apps/desktop/src-tauri
COPY build.sh /usr/local/bin/jarvis-xbuild
RUN chmod +x /usr/local/bin/jarvis-xbuild
ENTRYPOINT ["jarvis-xbuild"]
