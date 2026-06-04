// POSIX sh installer served verbatim at https://agent-paste.sh/install.sh.
// Run with: curl -fsSL https://agent-paste.sh/install.sh | sh
//
// It downloads the standalone CLI binary for the host OS/arch from the GitHub
// release, verifies it against SHA256SUMS, sets the exec bit (release assets
// download non-executable), and installs to ~/.local/bin with no sudo.
//
// Targets #!/bin/sh (not bash): piping to `sh` runs under dash/busybox on many
// systems, so the script stays POSIX — no [[ ]], no arrays, printf over echo.
// Resolves "latest" via the releases/latest/download/ redirect (no GitHub API,
// so no jq and no 60/hr rate limit). The redirect ignores draft/prerelease
// releases, so the target release must be published.

export const INSTALL_SH = `#!/bin/sh
# agent-paste CLI installer. https://agent-paste.sh/install.sh
set -eu

REPO="zaks-io/agent-paste"
BIN="agent-paste"
VERSION="\${AGENT_PASTE_VERSION:-latest}"
INSTALL_DIR="\${AGENT_PASTE_INSTALL_DIR:-$HOME/.local/bin}"

if [ -n "\${ZSH_VERSION:-}" ]; then
  echo "agent-paste: run this with sh, not zsh: curl -fsSL https://agent-paste.sh/install.sh | sh" >&2
  exit 1
fi

if [ -t 1 ]; then
  BOLD="$(printf '\\033[1m')"; RED="$(printf '\\033[31m')"; RESET="$(printf '\\033[0m')"
else
  BOLD=""; RED=""; RESET=""
fi

info() { printf '%s\\n' "$*"; }
err()  { printf '%sagent-paste: %s%s\\n' "$RED" "$*" "$RESET" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

detect_target() {
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Linux) os="linux" ;;
    Darwin) os="darwin" ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT)
      err "Windows detected. Install with PowerShell instead: irm https://agent-paste.sh/install.ps1 | iex" ;;
    *) err "unsupported OS: $os" ;;
  esac

  case "$arch" in
    x86_64|x86-64|x64|amd64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) err "unsupported architecture: $arch" ;;
  esac

  # uname -m reports x86_64 under Rosetta 2 on Apple Silicon; correct it so arm
  # Macs in a translated shell still get the native binary.
  if [ "$os" = "darwin" ] && [ "$arch" = "x64" ]; then
    if [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then
      arch="arm64"
    fi
  fi

  target="$os-$arch"
  case "$target" in
    darwin-arm64|linux-x64|linux-arm64) ;;
    *) err "no prebuilt binary for $target. See https://github.com/$REPO/releases" ;;
  esac
  printf '%s' "$target"
}

# Download $1 to $2. Fails loudly on any HTTP error so a 404 never lands as the
# binary (curl without --fail writes the error page and exits 0).
download() {
  url="$1"; out="$2"
  if have curl; then
    curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --output "$out" "$url"
  elif have wget; then
    wget --quiet --https-only --output-document="$out" "$url"
  else
    err "need curl or wget to download"
  fi
}

sha256_of() {
  if have sha256sum; then
    sha256sum "$1" | awk '{print $1}'
  elif have shasum; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif have openssl; then
    openssl dgst -sha256 "$1" | awk '{print $NF}'
  else
    return 1
  fi
}

verify() {
  file="$1"; asset="$2"; sums="$3"
  # SHA256SUMS lines are "<hash>  <file>" (text) or "<hash> *<file>" (binary).
  # Anchor on the filename end so agent-paste-linux-x64 does not also match a
  # longer name.
  want="$(grep " [* ]\\{0,1\\}\${asset}$" "$sums" | head -n1 | awk '{print $1}')"
  [ -n "$want" ] || err "no checksum for $asset in SHA256SUMS"
  got="$(sha256_of "$file")" || err "no sha256 tool (sha256sum, shasum, or openssl) found; refusing to install unverified binary"
  [ "$want" = "$got" ] || err "checksum mismatch for $asset
  expected $want
  got      $got"
}

add_to_path_hint() {
  case ":\${PATH}:" in
    *":\${INSTALL_DIR}:"*) return 0 ;;
  esac

  line="export PATH=\\"\${INSTALL_DIR}:\\$PATH\\""
  rc=""
  case "$(basename "\${SHELL:-}")" in
    zsh) rc="$HOME/.zshrc" ;;
    bash) [ -f "$HOME/.bashrc" ] && rc="$HOME/.bashrc" || rc="$HOME/.bash_profile" ;;
    fish) rc="$HOME/.config/fish/config.fish"; line="fish_add_path $INSTALL_DIR" ;;
  esac

  if [ -n "$rc" ] && { [ -w "$rc" ] || [ ! -e "$rc" ]; } && ! grep -qF "$INSTALL_DIR" "$rc" 2>/dev/null; then
    mkdir -p "$(dirname "$rc")"
    printf '\\n# agent-paste\\n%s\\n' "$line" >> "$rc"
    info ""
    info "Added \${INSTALL_DIR} to your PATH in \${rc}."
    info "Restart your shell or run: \${BOLD}source \${rc}\${RESET}"
  else
    info ""
    info "\${INSTALL_DIR} is not on your PATH. Add this to your shell config:"
    info "  \${BOLD}\${line}\${RESET}"
  fi
}

main() {
  target="$(detect_target)"
  asset="\${BIN}-\${target}"

  if [ "$VERSION" = "latest" ]; then
    base="https://github.com/\${REPO}/releases/latest/download"
  else
    base="https://github.com/\${REPO}/releases/download/\${VERSION}"
  fi

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT INT TERM

  info "Downloading \${BOLD}\${asset}\${RESET} (\${VERSION})..."
  download "\${base}/\${asset}" "$tmp/$asset"
  download "\${base}/SHA256SUMS" "$tmp/SHA256SUMS"

  info "Verifying checksum..."
  verify "$tmp/$asset" "$asset" "$tmp/SHA256SUMS"

  chmod +x "$tmp/$asset"
  mkdir -p "$INSTALL_DIR"
  mv -f "$tmp/$asset" "$INSTALL_DIR/$BIN"

  info "Installed \${BOLD}\${BIN}\${RESET} to \${INSTALL_DIR}/\${BIN}"
  add_to_path_hint
  info ""
  info "Verify with: \${BOLD}\${BIN} --version\${RESET}"
}

main "$@"
`;
