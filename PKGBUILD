pkgname=moho-git
pkgver=r1.268751e
pkgrel=1
pkgdesc="Unified desktop chat client for IRC, Discord, Sneedchat and Matrix"
arch=('x86_64')
url="https://github.com/Moho-Chat/moho"
license=('GPL3')
depends=('gtk3' 'nss' 'alsa-lib' 'libxss' 'libnotify')
makedepends=('git' 'cargo' 'nodejs' 'npm')
provides=('moho')
conflicts=('moho')
source=("git+https://github.com/Moho-Chat/moho.git")
sha256sums=('SKIP')
options=(!strip !debug !lto)

pkgver() {
  cd "$srcdir/moho"
  printf "%s.r%s.%s" \
    "$(sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json | sed -E 's/-([a-z]+)\.?([0-9]+)$/\1\2/')" \
    "$(git rev-list --count HEAD)" "$(git rev-parse --short HEAD)"
}

prepare() {
  cd "$srcdir/moho"
  git submodule update --init --recursive
  npm ci
}

build() {
  cd "$srcdir/moho"
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

  chmod 4755 "$pkgdir/opt/moho/chrome-sandbox"

  install -dm755 "$pkgdir/usr/bin"
  ln -s /opt/moho/moho "$pkgdir/usr/bin/moho"

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
