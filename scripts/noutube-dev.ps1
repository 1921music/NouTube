#Requires -Version 5.1
<#
.SYNOPSIS
Creates, builds in, opens, or removes the NouTube WSL development environment.
.DESCRIPTION
Use -Create to install the Linux tools, -Build to sync the Windows checkout and
copy the resulting APKs to android-apk, and -Shell to run Linux tools such as adb.
These actions share a six-CPU, 12 GiB systemd slice inside noutube_dev.
Use -Remove -WhatIf to preview removal of the environment and its VHDX.
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High', DefaultParameterSetName = 'Create')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Create')][switch]$Create,
    [Parameter(Mandatory, ParameterSetName = 'Build')][switch]$Build,
    [Parameter(Mandatory, ParameterSetName = 'Remove')][switch]$Remove,
    [Parameter(Mandatory, ParameterSetName = 'Shell')][switch]$Shell
)

$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$distro = 'noutube_dev'
$installDir = Join-Path $repo 'WSL_image\wasm_jjazzlab_dev'
$disk = Join-Path $installDir 'ext4.vhdx'
$ownerFile = Join-Path $installDir '.noutube_dev'
$registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss'
$registrations = @(Get-ItemProperty -Path "$registry\*" -ErrorAction SilentlyContinue | Where-Object { $_.DistributionName })

function Get-DiskPath($registration) {
    $base = $registration.BasePath -replace '^\\\\\?\\', ''
    $file = $registration.VhdFileName
    if (-not $file) { $file = 'ext4.vhdx' }
    return [IO.Path]::GetFullPath((Join-Path $base $file))
}

function Invoke-Wsl {
    & wsl.exe @args
    if ($LASTEXITCODE -ne 0) { throw "WSL exited with code $LASTEXITCODE ($($args[0]))." }
}

foreach ($path in @((Split-Path $installDir), $installDir, $disk, $ownerFile)) {
    if ((Test-Path -LiteralPath $path) -and ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "WSL storage path is a reparse point: $path"
    }
}

$registered = $registrations | Where-Object DistributionName -eq $distro
foreach ($registration in $registrations) {
    if ($registration.Version -eq 2 -and (Get-DiskPath $registration) -eq $disk -and $registration.DistributionName -ne $distro) {
        throw "The VHDX belongs to $($registration.DistributionName): $disk"
    }
}
if ($registered -and ($registered.Version -ne 2 -or (Get-DiskPath $registered) -ne $disk)) {
    throw "$distro is registered with a different WSL version or VHDX location."
}

if ($Remove) {
    if (-not $registered -and -not (Test-Path -LiteralPath $disk)) { return }
    if (-not $registered -and ((-not (Test-Path -LiteralPath $ownerFile)) -or (Get-Content -LiteralPath $ownerFile -Raw).Trim() -ne $disk)) {
        throw "Cannot verify ownership of $disk."
    }
    if ($PSCmdlet.ShouldProcess("$distro and $disk", 'Permanently delete the WSL environment')) {
        if ($registered) { Invoke-Wsl --unregister $distro }
        if (Test-Path -LiteralPath $disk -PathType Leaf) { Remove-Item -LiteralPath $disk }
        if (Test-Path -LiteralPath $ownerFile -PathType Leaf) { Remove-Item -LiteralPath $ownerFile }
    }
    return
}

if ($Create -and -not $registered) {
    if (Test-Path -LiteralPath $disk) { throw "A VHDX already exists at $disk." }
    if ($WhatIfPreference) { return }
    New-Item -ItemType Directory -Path (Split-Path $installDir) -Force | Out-Null
    Invoke-Wsl --install Ubuntu-24.04 --name $distro --location $installDir --version 2 --no-launch
    if (-not (Test-Path -LiteralPath $disk -PathType Leaf)) { throw "WSL did not create $disk." }
}
elseif (-not $registered) {
    throw "Run $PSCommandPath -Create first."
}
if ($WhatIfPreference) { return }

$linuxRepo = (& wsl.exe -d $distro -u root --exec wslpath -u ($repo.Replace('\', '/')) | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $linuxRepo.StartsWith('/')) { throw "Cannot locate $repo in WSL." }
$helper = "$linuxRepo/scripts/noutube-dev.sh"
# Let Bash read a stable copy even if the Windows checkout changes during a build.
$runHelper = 'set -e; snapshot=$(mktemp /tmp/noutube-dev.XXXXXXXX.sh); trap ''rm -f -- "$snapshot"'' EXIT; cp -- "$1" "$snapshot"; chmod 0644 "$snapshot"; shift; bash "$snapshot" "$@"'
if ($Create) {
    Set-Content -LiteralPath $ownerFile -Value $disk -Encoding Unicode
    Invoke-Wsl -d $distro -u root --exec bash -c $runHelper noutube-dev $helper provision
    Invoke-Wsl --manage $distro --set-default-user noutube
}
elseif ($Shell) {
    Invoke-Wsl -d $distro -u root --exec systemd-run --quiet --scope --slice=noutube.slice runuser -l noutube
}
else {
    Invoke-Wsl -d $distro -u root --exec systemd-run --quiet --scope --slice=noutube.slice runuser -u noutube -- bash -c $runHelper noutube-dev $helper build $linuxRepo
}
