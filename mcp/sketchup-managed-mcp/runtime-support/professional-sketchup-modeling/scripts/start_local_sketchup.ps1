param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$bindingPath=Join-Path $env:APPDATA 'SketchUpLiveMCP\runtime-target.json'
if (-not (Test-Path -LiteralPath $bindingPath)) { throw '首次配置请用户提供平时打开 SU 的 .lnk 快捷方式文件或绝对路径，通过 sketchup_runtime 绑定。禁止搜索并启动猜选的 SketchUp.exe。' }
$binding=Get-Content -Raw -Encoding UTF8 -LiteralPath $bindingPath | ConvertFrom-Json
$current=(& (Join-Path $PSScriptRoot 'inspect_sketchup_shortcut.ps1') -ShortcutPath $binding.shortcut_path) | ConvertFrom-Json
foreach ($key in @('shortcut_sha256','executable_sha256','executable','arguments','working_directory','version_year')) {
 if ($current.$key -cne $binding.$key) { throw "Bound shortcut/target changed ($key). Inspect and rebind the user-designated shortcut before starting." }
}
$profilePath=Join-Path $env:APPDATA 'SketchUpLiveMCP\runtime-render-profile.json'
$profile=if(Test-Path -LiteralPath $profilePath){Get-Content -Raw -Encoding UTF8 -LiteralPath $profilePath | ConvertFrom-Json}else{$null}
$profileMismatch=$false
if($profile -and $profile.runtime_directory){$profileMismatch=([IO.Path]::GetFullPath((Join-Path $profile.runtime_directory 'SketchUp.exe')) -ine [IO.Path]::GetFullPath($current.executable))}
$existing=@(Get-Process SketchUp -ErrorAction SilentlyContinue)
$reports=@()
foreach($processItem in $existing){
 $modules=@();$moduleError=$null
 try{$modules=@($processItem.Modules | Where-Object {$_.ModuleName -in @('opengl32.dll','libgallium_wgl.dll','nvoglv64.dll')} | ForEach-Object {$_.FileName})}catch{$moduleError=$_.Exception.Message}
 $reports += [pscustomobject]@{pid=$processItem.Id;path=$processItem.Path;title=$processItem.MainWindowTitle;responding=$processItem.Responding;matches_bound_executable=($processItem.Path -and ([IO.Path]::GetFullPath($processItem.Path) -ieq [IO.Path]::GetFullPath($current.executable)));renderer_modules=$modules;module_read_error=$moduleError}
}
$supported=$current.version_year -in @(2018,2019)
if($CheckOnly -or $existing.Count -gt 0){
 [pscustomobject]@{binding_path=$bindingPath;target=$current;supported_target_version=$supported;adaptation_required=(-not $supported);running=$reports;render_profile_present=[bool]$profile;render_profile_mismatch=$profileMismatch;capture_backend=$(if($profile){$profile.capture_backend}else{'window_print; needs target-machine verification'});launched=$false;next_action='Preserve open documents. Verify bound path, bridge PID/version/document and actual nonblank window capture. Other SU versions require Agent adaptation; do not switch versions.'} | ConvertTo-Json -Depth 7
 return
}
if(-not $supported){throw 'MCP declared support scope is SketchUp 2018/2019. Agent must adapt and validate this other version before enabling its launcher; no automatic version fallback.'}
if($profileMismatch){throw 'Render profile belongs to a different executable; preserve it and resolve mismatch instead of launching another SU.'}
$psi=[Diagnostics.ProcessStartInfo]::new()
$psi.FileName=$current.executable
$psi.Arguments=[string]$current.arguments
$psi.WorkingDirectory=if($current.working_directory){[string]$current.working_directory}else{Split-Path -Parent $current.executable}
$psi.UseShellExecute=$false
$psi.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
if($profile -and $profile.expected_renderer -eq 'software_opengl'){
 foreach($name in @('opengl32.dll','libgallium_wgl.dll')){if(-not(Test-Path -LiteralPath (Join-Path (Split-Path -Parent $current.executable) $name))){throw "Configured software renderer missing $name; no fallback."}}
 foreach($key in @('GALLIUM_DRIVER','LP_NUM_THREADS','MESA_GL_VERSION_OVERRIDE')){
  $value=[string]$profile.runtime_environment.$key;if(-not $value){throw "Missing configured renderer environment $key"};$psi.EnvironmentVariables[$key]=$value
 }
}
$started=[Diagnostics.Process]::Start($psi)
[pscustomobject]@{started_pid=$started.Id;executable=$current.executable;arguments_preserved=$true;live_compatibility='unverified';next_action='Run -CheckOnly, verify MCP ping/model binding and nonblank window capture before production. Process launch alone is not success.'} | ConvertTo-Json
