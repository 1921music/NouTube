# Contributing

Thank you for your interest in contributing to [NouTube](https://github.com/nonbili/NouTube) !

Please read this guide before submitting changes.

## Before you start

Knowledge of JavaScript/TypeScript, React and ReactNative makes it easier to contribute to the project.

## Installation

Here you will find instructions to install NouTube.

### Prerequisites

- [bun](https://bun.com/docs/installation)
- [Android SDK](https://developer.android.com/studio): if you want to build the android app
- [Expo Go](https://play.google.com/store/apps/details?id=host.exp.exponent): if you want to use Expo Go on your phone

### Installing the project

- Clone the project:

```shell
git clone https://github.com/nonbili/NouTube.git 
```

- Install all dependencies:

```shell
bun install
```

- Build in dev mode:

```shell
bun dev
```

- Build the android app:

```shell
bun android
```

### Troubleshooting

#### "Failed to resolve the Android SDK path..."

Make sure that you have the android SDK installed and the environment variable set with the SDK location.

```shell
export ANDROID_HOME=/home/john/Android/sdk
```

## Build and test the Android transpose fork on Windows

Use PowerShell in the root of the Windows checkout with a version of WSL that supports custom distro names and install locations. The [development script](scripts/noutube-dev.ps1) creates `noutube_dev` from Ubuntu 24.04 LTS under WSL 2 and installs Node.js 22, JDK 17, Bun, Android SDK tools, and `adb` inside it.

```powershell
git clone --branch transpose https://github.com/1921music/NouTube.git
cd NouTube
.\scripts\noutube-dev.ps1 -Create
.\scripts\noutube-dev.ps1 -Build
```

Edit the source in the Windows checkout and rerun `-Build`. The script synchronizes the working files to `~/noutube` on the WSL filesystem, runs Expo prebuild and Gradle, then writes `transpose-app-full-<ABI>-release.apk` files to `android-apk/`. The APK includes the JavaScript bundle and runs without Metro. The WSL disk is `WSL_image/wasm_jjazzlab_dev/ext4.vhdx`, and the script runs development commands in a WSL-local systemd slice with six CPUs and a 12 GiB memory limit.

After the first build, open the WSL development shell to run the tests.

```powershell
.\scripts\noutube-dev.ps1 -Shell
```

```sh
cd ~/noutube
bun test
```

For wireless testing, enable **Wireless debugging** on the Android device and open **Pair device with pairing code**. In the same WSL shell, use the pairing port with `adb pair` and the separate port shown on the main Wireless debugging screen with `adb connect`. The examples use the arm64 APK and a checkout on `C:`. Adjust the APK path and ABI for your machine and device.

```sh
mkdir -p ~/.android
export ADB_SERVER_SOCKET="localfilesystem:$HOME/.android/noutube-adb.sock"
adb pair PHONE_IP:PAIRING_PORT
adb connect PHONE_IP:DEBUG_PORT
adb -s PHONE_IP:DEBUG_PORT shell getprop ro.product.cpu.abilist
adb -s PHONE_IP:DEBUG_PORT install -r /mnt/c/path/to/NouTube/android-apk/transpose-app-full-arm64-v8a-release.apk
```

Open a video or track and change **Key** to check that the playback speed stays steady and that the key resets when the track changes. Use `-Remove -WhatIf` to preview deleting `noutube_dev` and its VHDX.

## Pull requests

1. Use a dedicated branch for your work.
2. Ensure that your code passes the lint check.
3. Maintainers may request changes before merging.

## Style guidelines

### Commits

Your commits must:

- Be meaningful
- Refer the issue (if you are fixing an issue)

Example: android(0.4.3): support sponsor block, fix #7

## Labels

Prefix your issues and PRs with labels to indicate their type such as:
`[bug]`, `[enhancement]`, `[question]` etc...
