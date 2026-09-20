param([Parameter(Mandatory=$true)][string]$ShortcutPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
if (-not [IO.Path]::IsPathRooted($ShortcutPath) -or [IO.Path]::GetExtension($ShortcutPath) -notin @('.lnk','.exe')) { throw 'Provide the absolute .lnk or SketchUp.exe path supplied by the user; do not guess an executable.' }
function Read-Sha256([string]$FilePath) {
 $stream=[IO.File]::OpenRead($FilePath);$hash=[Security.Cryptography.SHA256]::Create()
 try { return ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant() } finally { $stream.Dispose();$hash.Dispose() }
}
$item=Get-Item -LiteralPath $ShortcutPath
if ($item.PSIsContainer) { throw 'Shortcut must be a file.' }
$arguments=''; $workingDirectory=''
if ($item.Extension -ieq '.lnk') {
 $shell=New-Object -ComObject WScript.Shell
 $link=$shell.CreateShortcut($item.FullName)
 $target=[Environment]::ExpandEnvironmentVariables([string]$link.TargetPath)
 $arguments=[string]$link.Arguments; $workingDirectory=[string]$link.WorkingDirectory
} else { $target=$item.FullName; $workingDirectory=$item.DirectoryName }
if (-not [IO.Path]::IsPathRooted($target) -or [IO.Path]::GetFileName($target) -ine 'SketchUp.exe') { throw 'Shortcut must directly target SketchUp.exe. For a wrapper/launcher, inspect it with the user and adapt explicitly; never execute it to guess.' }
$exe=Get-Item -LiteralPath $target
if ($exe.PSIsContainer) { throw 'Target is not a file.' }
$v=$exe.VersionInfo
if ($v.ProductName -notmatch 'SketchUp') { throw 'Executable product metadata does not identify SketchUp; investigate before binding.' }
$major=[int]$v.ProductMajorPart
if ($major -eq 0) { $major=[int]$v.FileMajorPart }
$year=if ($major -ge 2000) { $major } elseif ($major -gt 0) { 2000+$major } else { 0 }
[pscustomobject]@{
 shortcut_path=$item.FullName; shortcut_sha256=(Read-Sha256 $item.FullName);
 executable=$exe.FullName; executable_sha256=(Read-Sha256 $exe.FullName);
 arguments=$arguments; working_directory=$workingDirectory;
 product_name=$v.ProductName; product_version=$v.ProductVersion; file_version=$v.FileVersion; version_year=$year;
 support_scope= $(if ($year -in @(2018,2019)) {'supported_target_version'} else {'adaptation_required'});
 runtime_test_status='not_tested_by_shortcut_inspection'; launched=$false
} | ConvertTo-Json -Depth 5 -Compress
