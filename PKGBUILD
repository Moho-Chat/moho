# Maintainer: Salastil <salastil@cock.li>
#
# Builds moho from source the way an AUR VCS package does: compile the Rust
# daemon, build the renderer, then assemble an unpacked Electron tree and
# install it under /opt.
#
# Deliberately NOT the AppImage: an AppImage is a self-contained blob that
# needs libfuse2 at runtime and integrates with nothing. `npm run pack` still
# produces one for portable use; this is the path for installing it properly.

pkgname=moho-git
pkgver=r1.268751e
pkgrel=1
pkgdesc="Unified desktop chat client for IRC, Discord, Sneedchat and Matrix"
arch=('x86_64')
url="https://git.salastil.com/Salastil/moho"
license=('GPL3' 'AGPL3')
# Electron ships its own copy of Chromium, but still links against the
# system's GTK/NSS/audio stack at runtime.
depends=('gtk3' 'nss' 'alsa-lib' 'libxss' 'libnotify')
makedepends=('git' 'cargo' 'nodejs' 'npm')
provides=('moho')
conflicts=('moho')
# The daemon lives in its own repository and is pulled in as a submodule;
# makepkg does not recurse into submodules on its own, so prepare() does it.
source=("git+https://git.salastil.com/Salastil/moho.git")
sha256sums=('SKIP')
# The bundled Electron binaries are already stripped and have their own debug
# handling; letting makepkg reprocess ~150MB of them wastes minutes and can
# corrupt the ASAR integrity checks.
options=(!strip !debug !lto)

pkgver() {
  cd "$srcdir/moho"
  printf "r%s.%s" "$(git rev-list --count HEAD)" "$(git rev-parse --short HEAD)"
}

prepare() {
  cd "$srcdir/moho"
  git submodule update --init --recursive
  # `npm ci` respects the allowScripts entries in package.json, so the
  # electron and esbuild postinstalls that fetch their platform binaries are
  # permitted without any interactive approval.
  npm ci
}

build() {
  cd "$srcdir/moho"
  # The daemon is bundled from the submodule's build output, so it has to
  # exist before electron-builder assembles the tree.
  cargo build --release --locked --manifest-path nobilis/Cargo.toml
  npm run build
  npx --no-install electron-builder --linux dir
}

check() {
  cd "$srcdir/moho"
  cargo test --release --locked --manifest-path nobilis/Cargo.toml
  npm run typecheck
}

package() {
  cd "$srcdir/moho"

  install -dm755 "$pkgdir/opt/moho"
  cp -a dist/linux-unpacked/. "$pkgdir/opt/moho/"

  # Electron's setuid sandbox helper: without the setuid bit, Chromium either
  # refuses to start or falls back to running unsandboxed.
  chmod 4755 "$pkgdir/opt/moho/chrome-sandbox"

  install -dm755 "$pkgdir/usr/bin"
  ln -s /opt/moho/moho "$pkgdir/usr/bin/moho"

  # Written here rather than shipped as a source file: this PKGBUILD builds
  # from a plain git clone, so keeping it inline means there is nothing extra
  # to keep in sync between the repo and the package.
  install -dm755 "$pkgdir/usr/share/applications"
  cat > "$pkgdir/usr/share/applications/moho.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=moho
Comment=Unified desktop chat client for IRC, Discord, Sneedchat and Matrix
Exec=/opt/moho/moho %U
Icon=moho
Terminal=false
Categories=Network;InstantMessaging;
StartupWMClass=moho
DESKTOP
  chmod 644 "$pkgdir/usr/share/applications/moho.desktop"
  install -Dm644 resources/icons/moho.png \
    "$pkgdir/usr/share/icons/hicolor/512x512/apps/moho.png"
  install -Dm644 README.md "$pkgdir/usr/share/doc/moho/README.md"
}
