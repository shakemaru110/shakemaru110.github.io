param([switch]$Test)
$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'Metronome.csproj'
$output = Join-Path $PSScriptRoot 'artifacts/win-x64'
$env:DOTNET_CLI_HOME = Join-Path $PSScriptRoot '.dotnet'
$env:NUGET_PACKAGES = Join-Path $PSScriptRoot '.packages'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
$env:DOTNET_NOLOGO = '1'
& dotnet publish $project -c Release -r win-x64 --self-contained true -o $output
if ($LASTEXITCODE -ne 0) { throw 'Publish failed.' }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Destination (Join-Path $output 'README.md')
$licenses = Join-Path $output 'licenses'
New-Item -ItemType Directory -Path $licenses -Force | Out-Null
$assets = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'obj/project.assets.json') -Raw | ConvertFrom-Json
$notices = @(
  @{ Package = 'Microsoft.Web.WebView2'; File = 'LICENSE.txt'; Name = 'WebView2-LICENSE.txt' },
  @{ Package = 'Microsoft.Web.WebView2'; File = 'NOTICE.txt'; Name = 'WebView2-NOTICE.txt' },
  @{ Package = 'Microsoft.NETCore.App.Runtime.win-x64'; File = 'LICENSE.TXT'; Name = 'dotnet-LICENSE.txt' },
  @{ Package = 'Microsoft.NETCore.App.Runtime.win-x64'; File = 'THIRD-PARTY-NOTICES.TXT'; Name = 'dotnet-THIRD-PARTY-NOTICES.txt' },
  @{ Package = 'Microsoft.WindowsDesktop.App.Runtime.win-x64'; File = 'LICENSE'; Name = 'WindowsDesktop-LICENSE.txt' }
)
foreach ($notice in $notices) {
  $package = $assets.libraries.PSObject.Properties | Where-Object { $_.Name.StartsWith($notice.Package + '/', [StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
  if ($package) {
    $packageDirectory = Join-Path $env:NUGET_PACKAGES $package.Name.ToLowerInvariant()
  } else {
    $download = $assets.project.frameworks.PSObject.Properties | ForEach-Object { $_.Value.downloadDependencies } | Where-Object { $_.name -eq $notice.Package } | Select-Object -First 1
    if (-not $download) { throw "Missing package for notice: $($notice.Package)" }
    $version = $download.version.Trim('[]').Split(',')[0].Trim()
    $packageDirectory = Join-Path $env:NUGET_PACKAGES ($notice.Package.ToLowerInvariant() + '/' + $version)
  }
  Copy-Item -LiteralPath (Join-Path $packageDirectory $notice.File) -Destination (Join-Path $licenses $notice.Name)
}
if ($Test) {
  $report = Join-Path $PSScriptRoot 'artifacts/smoke-report.json'
  $process = Start-Process -FilePath (Join-Path $output 'Metronome.exe') -ArgumentList @('--self-test', ('"' + $report + '"')) -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit(60000)) { Stop-Process -Id $process.Id; throw 'App self-test timed out.' }
  Get-Content -LiteralPath $report -Encoding utf8
  if ($process.ExitCode -ne 0) { throw 'App self-test failed.' }
}
$archive = Join-Path $PSScriptRoot 'artifacts/Metronome-win-x64.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$temporaryArchive = Join-Path $PSScriptRoot ('artifacts/Metronome-' + [guid]::NewGuid().ToString('N') + '.zip')
try {
  [IO.Compression.ZipFile]::CreateFromDirectory($output, $temporaryArchive, [IO.Compression.CompressionLevel]::Optimal, $false)
  Move-Item -LiteralPath $temporaryArchive -Destination $archive -Force
} finally {
  if (Test-Path -LiteralPath $temporaryArchive) { Remove-Item -LiteralPath $temporaryArchive }
}
Write-Output "EXE: $(Join-Path $output 'Metronome.exe')"
Write-Output "ZIP: $archive"
