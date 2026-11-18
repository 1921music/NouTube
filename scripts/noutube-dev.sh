#!/usr/bin/env bash
set -euo pipefail

provision() {
    cat > /etc/systemd/system/noutube.slice <<'EOF'
[Slice]
AllowedCPUs=0-5
CPUQuota=600%
MemoryMax=12G
EOF
    systemctl daemon-reload
    systemd-run --quiet --scope --slice=noutube.slice bash "$0" setup
}

setup() {
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y ca-certificates curl git rsync unzip xz-utils openjdk-17-jdk-headless python3 libglu1-mesa
    if ! id noutube >/dev/null 2>&1; then
        useradd --create-home --shell /bin/bash noutube
    fi
    runuser -u noutube -- bash "$0" tools
}

tools() {
    local archive arch temporary
    temporary=$(mktemp -d)
    trap "rm -rf -- ${temporary@Q}" EXIT
    case $(uname -m) in
        x86_64) arch=x64 ;;
        aarch64) arch=arm64 ;;
        *) echo 'Unsupported Linux architecture' >&2; exit 1 ;;
    esac
    mkdir -p "$HOME/.local" "$HOME/Android/sdk"
    if [[ ! -x "$HOME/.local/node/bin/node" ]]; then
        local node_base=https://nodejs.org/dist/latest-v22.x
        curl -fsSL "$node_base/SHASUMS256.txt" -o "$temporary/SHASUMS256.txt"
        archive=$(awk -v suffix="-linux-$arch.tar.xz" '$2 ~ suffix "$" {print $2}' "$temporary/SHASUMS256.txt")
        curl -fsSL "$node_base/$archive" -o "$temporary/$archive"
        (cd "$temporary"; grep -F "  $archive" SHASUMS256.txt | sha256sum -c)
        tar -xJf "$temporary/$archive" -C "$temporary"
        mv "$temporary/${archive%.tar.xz}" "$HOME/.local/node"
    fi
    if [[ ! -x "$HOME/.bun/bin/bun" ]]; then
        curl -fsSL https://bun.sh/install -o "$temporary/install-bun.sh"
        bash "$temporary/install-bun.sh"
    fi
    local sdk="$HOME/Android/sdk"
    if [[ ! -x "$sdk/cmdline-tools/latest/bin/sdkmanager" ]]; then
        curl -fsSL https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip -o "$temporary/android.zip"
        unzip -q "$temporary/android.zip" -d "$temporary"
        mkdir -p "$sdk/cmdline-tools"
        mv "$temporary/cmdline-tools" "$sdk/cmdline-tools/latest"
    fi
    cat > "$HOME/.noutube-env" <<'EOF'
export ANDROID_HOME="$HOME/Android/sdk"
export PATH="$HOME/.local/node/bin:$HOME/.bun/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
EOF
    if ! grep -Fxq 'source "$HOME/.noutube-env"' "$HOME/.bashrc"; then
        printf '\nsource "$HOME/.noutube-env"\n' >> "$HOME/.bashrc"
    fi
    source "$HOME/.noutube-env"
    sdkmanager --licenses < <(yes)
    sdkmanager platform-tools
}

sync_sources() {
    local source=$1 destination=$2
    # Honour Git's tracking and ignore rules, including the tracked Android Gradle file.
    git -C "$source" -c safe.directory="$source" ls-files -z --cached --others --exclude-standard |
        python3 -c '
import sys
from pathlib import Path, PurePosixPath

source = Path(sys.argv[1])
protected = [b"node_modules", b"desktop/node_modules", b"extension/node_modules", b"android", b"assets/scripts", b".expo"]
rules = [b"P /" + path + b"/***" for path in protected]
paths = set()
for name in sys.stdin.buffer.read().split(b"\0"):
    if not name or name.split(b"/")[0] in {b".git", b"WSL_image", b"android-apk"}:
        continue
    relative = PurePosixPath(name.decode(errors="surrogateescape"))
    if not (source / relative).is_file() and not (source / relative).is_symlink():
        continue
    paths.add(name)
    paths.update(str(parent).encode(errors="surrogateescape") + b"/" for parent in relative.parents if parent.name)
for name in sorted(paths):
    escaped = name
    if any(char in name for char in (b"*", b"?", b"[")):
        for char in (b"\\", b"*", b"?", b"["):
            escaped = escaped.replace(char, b"\\" + char)
    rules.append(b"S /" + escaped)
sys.stdout.buffer.write(b"\0".join([*rules, b"H *", b""]))
' "$source" |
        rsync -rlt --checksum --delete --from0 --filter='merge /dev/stdin' "$source/" "$destination/"
}

build() {
    local source=$1 checkout="$HOME/noutube" output
    source "$HOME/.noutube-env"
    mkdir -p "$checkout" "$source/android-apk"
    exec 9>"$HOME/.noutube-build.lock"
    flock 9
    sync_sources "$source" "$checkout"
    cd "$checkout"
    bun link
    bun install --frozen-lockfile
    bun bundle:es
    bun expo prebuild -p android --clean --no-install
    (cd android; ./gradlew assembleFullRelease -Pandroid.injected.signing.store.file="$checkout/android/app/debug.keystore" \
        -Pandroid.injected.signing.store.password=android -Pandroid.injected.signing.key.alias=androiddebugkey \
        -Pandroid.injected.signing.key.password=android)
    output=android/app/build/outputs/apk/full/release
    for apk in "$output"/*.apk; do
        cp -- "$apk" "$source/android-apk/"
        printf 'APK: %s\n' "$source/android-apk/${apk##*/}"
    done
}

case ${1:-} in
    provision) provision ;;
    setup) setup ;;
    tools) tools ;;
    build) build "$2" ;;
    *) exit 2 ;;
esac
