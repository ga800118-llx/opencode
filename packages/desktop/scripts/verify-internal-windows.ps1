[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$DeliveryDirectory,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Version,

  [string]$EvidenceDirectory = "",

  [ValidateRange(10, 900)]
  [int]$ReadyTimeoutSeconds = 180,

  [ValidateRange(10, 900)]
  [int]$OperationTimeoutSeconds = 180
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-Condition {
  param(
    [bool]$Condition,
    [string]$Message
  )

  if (-not $Condition) {
    throw $Message
  }
}

function Get-ExpectedVersionMetadata {
  param([string]$ExpectedVersion)

  $match = [regex]::Match(
    $ExpectedVersion,
    "^(?<major>0|[1-9][0-9]*)\.(?<minor>0|[1-9][0-9]*)\.(?<patch>0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$"
  )
  Assert-Condition $match.Success "Version must be a semantic version: $ExpectedVersion"

  $core = "$($match.Groups['major'].Value).$($match.Groups['minor'].Value).$($match.Groups['patch'].Value)"
  return [ordered]@{
    semantic = $ExpectedVersion
    core = $core
    windows = "$core.0"
  }
}

function Assert-ExecutableVersion {
  param(
    [string]$ExecutablePath,
    [System.Collections.IDictionary]$Expected
  )

  $versionInfo = (Get-Item -LiteralPath $ExecutablePath).VersionInfo
  $allowed = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  [void]$allowed.Add([string]$Expected.semantic)
  [void]$allowed.Add([string]$Expected.core)
  [void]$allowed.Add([string]$Expected.windows)

  foreach ($value in @($versionInfo.FileVersion, $versionInfo.ProductVersion)) {
    Assert-Condition (-not [string]::IsNullOrWhiteSpace($value)) "Executable version metadata is missing: $ExecutablePath"
    $normalized = ($value -replace ",\s*", ".") -replace "\s", ""
    Assert-Condition ($allowed.Contains($normalized)) "Executable version '$value' does not match $($Expected.semantic): $ExecutablePath"
  }
  Assert-Condition ($versionInfo.ProductName -eq "Guai Code Beta") "Unexpected executable product name '$($versionInfo.ProductName)'."

  return [ordered]@{
    fileVersion = $versionInfo.FileVersion
    productVersion = $versionInfo.ProductVersion
    productName = $versionInfo.ProductName
    expectedForms = @($Expected.semantic, $Expected.core, $Expected.windows)
  }
}

function Assert-ExactDeliveryFiles {
  param(
    [string]$Directory,
    [string[]]$ExpectedNames
  )

  $items = @(Get-ChildItem -LiteralPath $Directory -Force)
  $directories = @($items | Where-Object { $_.PSIsContainer })
  Assert-Condition ($directories.Count -eq 0) "Delivery directory contains unexpected directories: $($directories.Name -join ', ')"

  $actualNames = @($items | ForEach-Object { $_.Name })
  $actual = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  foreach ($name in $actualNames) {
    Assert-Condition ($actual.Add($name)) "Delivery directory contains a duplicate filename: $name"
  }

  Assert-Condition ($actual.Count -eq $ExpectedNames.Count) "Delivery directory must contain exactly $($ExpectedNames.Count) files; found $($actual.Count): $($actualNames -join ', ')"
  foreach ($name in $ExpectedNames) {
    Assert-Condition ($actual.Contains($name)) "Delivery directory is missing expected file: $name"
  }
}

function Get-VerifiedManifestEntries {
  param(
    [string]$Directory,
    [string]$ManifestPath,
    [string[]]$ExpectedNames
  )

  $entries = @()
  $names = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  foreach ($line in @(Get-Content -LiteralPath $ManifestPath -Encoding UTF8)) {
    if ([string]::IsNullOrWhiteSpace($line)) {
      continue
    }

    $match = [regex]::Match($line, "^(?<hash>[0-9A-Fa-f]{64})  (?<name>[^\\/]+)$")
    Assert-Condition $match.Success "Invalid SHA256SUMS.txt entry: $line"
    $name = $match.Groups["name"].Value
    Assert-Condition ($names.Add($name)) "Duplicate SHA256SUMS.txt entry: $name"
    $file = Join-Path -Path $Directory -ChildPath $name
    Assert-Condition (Test-Path -LiteralPath $file -PathType Leaf) "Manifest entry does not name a delivery file: $name"

    $expectedHash = $match.Groups["hash"].Value.ToLowerInvariant()
    $actualHash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Condition ($actualHash -eq $expectedHash) "SHA-256 mismatch for $name. Expected $expectedHash, received $actualHash."
    $entries += [ordered]@{
      name = $name
      sha256 = $actualHash
      sizeBytes = (Get-Item -LiteralPath $file).Length
    }
  }

  Assert-Condition ($names.Count -eq $ExpectedNames.Count) "SHA256SUMS.txt must contain exactly $($ExpectedNames.Count) entries; found $($names.Count)."
  foreach ($name in $ExpectedNames) {
    Assert-Condition ($names.Contains($name)) "SHA256SUMS.txt is missing expected entry: $name"
  }
  return @($entries)
}

function Invoke-BundledGitVersion {
  param([string]$GitPath)

  Assert-Condition (Test-Path -LiteralPath $GitPath -PathType Leaf) "Bundled Git executable is missing: $GitPath"
  $lines = @(& $GitPath --version 2>&1 | ForEach-Object { $_.ToString() })
  $exitCode = $LASTEXITCODE
  $output = ($lines -join [Environment]::NewLine).Trim()
  Assert-Condition ($exitCode -eq 0) "Bundled Git exited with code ${exitCode}: $output"
  Assert-Condition ($output.Contains("2.55.0.windows.3")) "Bundled Git version is not 2.55.0.windows.3: $output"
  return $output
}

function Expand-AndVerifyPortableZip {
  param(
    [string]$ZipPath,
    [string]$Destination,
    [string[]]$RequiredEntries,
    [System.Collections.IDictionary]$ExpectedVersion
  )

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    $entryNames = @($archive.Entries | ForEach-Object { $_.FullName.Replace("\", "/") })
    foreach ($required in $RequiredEntries) {
      Assert-Condition ($entryNames -ccontains $required) "Portable ZIP is missing required entry: $required"
    }
  }
  finally {
    $archive.Dispose()
  }

  [void][System.IO.Directory]::CreateDirectory($Destination)
  [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $Destination)
  foreach ($required in $RequiredEntries) {
    $expandedPath = Join-Path -Path $Destination -ChildPath ($required.Replace("/", [System.IO.Path]::DirectorySeparatorChar))
    Assert-Condition (Test-Path -LiteralPath $expandedPath -PathType Leaf) "Expanded portable ZIP is missing required file: $required"
  }

  $portableExecutable = Join-Path -Path $Destination -ChildPath "Guai Code Beta.exe"
  $metadata = Assert-ExecutableVersion -ExecutablePath $portableExecutable -Expected $ExpectedVersion
  $gitPath = Join-Path -Path $Destination -ChildPath "resources\mingit\cmd\git.exe"
  return [ordered]@{
    requiredEntries = @($RequiredEntries)
    executable = $metadata
    gitVersion = Invoke-BundledGitVersion -GitPath $gitPath
  }
}

function Wait-ApplicationReady {
  param(
    [string]$ApplicationPath,
    [string]$UserDataDirectory,
    [string]$EvidenceDirectoryPath,
    [string]$LaunchName,
    [int]$TimeoutSeconds,
    [ref]$ProcessReference,
    [ref]$LaunchEvidenceReference
  )

  $knownLogs = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  $logRoot = Join-Path -Path $UserDataDirectory -ChildPath "logs"
  if (Test-Path -LiteralPath $logRoot -PathType Container) {
    foreach ($log in @(Get-ChildItem -LiteralPath $logRoot -Filter "main.log" -File -Recurse -ErrorAction SilentlyContinue)) {
      [void]$knownLogs.Add($log.FullName)
    }
  }

  $startedAt = [DateTime]::UtcNow
  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $argument = '--user-data-dir="{0}"' -f $UserDataDirectory
  $process = Start-Process -FilePath $ApplicationPath -ArgumentList $argument -PassThru
  $ProcessReference.Value = $process
  $record = [ordered]@{
    name = $LaunchName
    pid = $process.Id
    startedAtUtc = $startedAt.ToString("o")
    readyAtUtc = $null
    readyMilliseconds = $null
    processAliveAtReady = $false
    bundledGitEnabled = $false
    serverReady = $false
    logPath = $null
    evidenceLog = $null
    logSha256 = $null
    stop = $null
  }
  $LaunchEvidenceReference.Value = @($LaunchEvidenceReference.Value) + @($record)

  $candidate = $null
  while ($stopwatch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
    $process.Refresh()
    if ($process.HasExited) {
      throw "Application exited before readiness during '$LaunchName' with code $($process.ExitCode)."
    }

    if (Test-Path -LiteralPath $logRoot -PathType Container) {
      $newLogs = @(
        Get-ChildItem -LiteralPath $logRoot -Filter "main.log" -File -Recurse -ErrorAction SilentlyContinue |
          Where-Object { -not $knownLogs.Contains($_.FullName) } |
          Sort-Object -Property LastWriteTimeUtc
      )
      if ($newLogs.Count -gt 0) {
        $candidate = $newLogs[-1]
        $record.logPath = $candidate.FullName
        try {
          $contents = Get-Content -LiteralPath $candidate.FullName -Raw -Encoding UTF8
          $record.bundledGitEnabled = $contents.Contains("bundled git enabled")
          $record.serverReady = [regex]::IsMatch($contents, "(?im)^(?!.*awaiting server ready).*server ready")
          if ($record.bundledGitEnabled -and $record.serverReady) {
            $process.Refresh()
            Assert-Condition (-not $process.HasExited) "Application exited as readiness was observed during '$LaunchName'."
            $stopwatch.Stop()
            $evidenceLog = "$LaunchName-main.log"
            $evidenceLogPath = Join-Path -Path $EvidenceDirectoryPath -ChildPath $evidenceLog
            Copy-Item -LiteralPath $candidate.FullName -Destination $evidenceLogPath -Force
            $record.readyAtUtc = [DateTime]::UtcNow.ToString("o")
            $record.readyMilliseconds = [Math]::Round($stopwatch.Elapsed.TotalMilliseconds)
            $record.processAliveAtReady = $true
            $record.evidenceLog = $evidenceLog
            $record.logSha256 = (Get-FileHash -LiteralPath $evidenceLogPath -Algorithm SHA256).Hash.ToLowerInvariant()
            return $process
          }
        }
        catch [System.IO.IOException] {
          # The logger can briefly hold the file while the next line is written.
        }
      }
    }
    Start-Sleep -Milliseconds 250
  }

  $stopwatch.Stop()
  $lastLog = if ($null -eq $candidate) { "none" } else { $candidate.FullName }
  throw "Timed out after $TimeoutSeconds seconds waiting for a new main.log with bundled Git and server readiness during '$LaunchName'. Last log: $lastLog"
}

function Stop-ApplicationProcess {
  param(
    [System.Diagnostics.Process]$Process,
    [string]$ApplicationPath,
    [int]$TimeoutSeconds
  )

  $Process.Refresh()
  Assert-Condition (-not $Process.HasExited) "Application process $($Process.Id) exited before Stop-Process."
  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  Stop-Process -Id $Process.Id -ErrorAction Stop
  Assert-Condition ($Process.WaitForExit($TimeoutSeconds * 1000)) "Application process $($Process.Id) did not exit after Stop-Process."
  while ((@(Get-InstalledApplicationProcesses -ApplicationPath $ApplicationPath)).Count -gt 0 -and $stopwatch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
    Start-Sleep -Milliseconds 250
  }
  Assert-Condition ((@(Get-InstalledApplicationProcesses -ApplicationPath $ApplicationPath)).Count -eq 0) "Application child processes remained after Stop-Process."
  $stopwatch.Stop()
  return [ordered]@{
    method = "Stop-Process"
    exitCode = $Process.ExitCode
    elapsedMilliseconds = [Math]::Round($stopwatch.Elapsed.TotalMilliseconds)
  }
}

function Get-InstalledApplicationProcesses {
  param([string]$ApplicationPath)

  $matches = @()
  foreach ($process in @(Get-Process -ErrorAction SilentlyContinue)) {
    try {
      if ([System.StringComparer]::OrdinalIgnoreCase.Equals($process.Path, $ApplicationPath)) {
        $matches += $process
      }
    }
    catch {
      continue
    }
  }
  return @($matches)
}

function Stop-InstalledApplicationProcesses {
  param(
    [string]$ApplicationPath,
    [int]$TimeoutSeconds
  )

  foreach ($process in @(Get-InstalledApplicationProcesses -ApplicationPath $ApplicationPath)) {
    $process.Refresh()
    if ($process.HasExited) {
      continue
    }
    Stop-Process -Id $process.Id -ErrorAction Stop
    Assert-Condition ($process.WaitForExit($TimeoutSeconds * 1000)) "Application process $($process.Id) did not exit during cleanup."
  }
}

function Get-ModelProfileState {
  param([string]$UserDataDirectory)

  $path = Join-Path -Path $UserDataDirectory -ChildPath "agent.model-profiles"
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    return [ordered]@{
      path = $path
      exists = $false
      topLevelKeys = @()
      statePresent = $false
      profilesPresent = $false
      profileCount = 0
    }
  }

  $raw = Get-Content -LiteralPath $path -Raw -Encoding UTF8
  Assert-Condition (-not [string]::IsNullOrWhiteSpace($raw)) "Model profile store is empty but present: $path"
  $store = $raw | ConvertFrom-Json
  $topLevelKeys = @($store.PSObject.Properties | ForEach-Object { $_.Name })
  $stateProperty = $store.PSObject.Properties["state"]
  $statePresent = $null -ne $stateProperty
  $profilesProperty = if ($statePresent -and $null -ne $stateProperty.Value) {
    $stateProperty.Value.PSObject.Properties["profiles"]
  }
  else {
    $null
  }
  $profilesPresent = $null -ne $profilesProperty
  $profileCount = if ($profilesPresent -and $null -ne $profilesProperty.Value) {
    @($profilesProperty.Value).Count
  }
  else {
    0
  }
  Assert-Condition ($profileCount -eq 0) "Isolated user data unexpectedly contains $profileCount model profile(s)."

  return [ordered]@{
    path = $path
    exists = $true
    sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    topLevelKeys = @($topLevelKeys)
    statePresent = $statePresent
    profilesPresent = $profilesPresent
    profileCount = $profileCount
  }
}

function Invoke-SilentUninstall {
  param(
    [string]$InstallDirectory,
    [int]$TimeoutSeconds
  )

  $uninstallers = @(Get-ChildItem -LiteralPath $InstallDirectory -Filter "*ninstall*.exe" -File -ErrorAction SilentlyContinue)
  Assert-Condition ($uninstallers.Count -eq 1) "Expected exactly one uninstaller in $InstallDirectory; found $($uninstallers.Count)."
  $uninstaller = $uninstallers[0]
  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $process = Start-Process -FilePath $uninstaller.FullName -ArgumentList "/S" -PassThru
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "Uninstaller timed out after $TimeoutSeconds seconds: $($uninstaller.FullName)"
  }
  Assert-Condition ($process.ExitCode -eq 0) "Uninstaller exited with code $($process.ExitCode): $($uninstaller.FullName)"

  while ((Test-Path -LiteralPath $InstallDirectory) -and $stopwatch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
    Start-Sleep -Milliseconds 250
  }
  $stopwatch.Stop()
  Assert-Condition (-not (Test-Path -LiteralPath $InstallDirectory)) "Install directory still exists after silent uninstall: $InstallDirectory"
  return [ordered]@{
    attempted = $true
    executable = $uninstaller.Name
    arguments = @("/S")
    exitCode = $process.ExitCode
    elapsedMilliseconds = [Math]::Round($stopwatch.Elapsed.TotalMilliseconds)
    installDirectoryRemoved = $true
  }
}

function Copy-DiagnosticLogs {
  param(
    [string]$UserDataDirectory,
    [string]$EvidenceDirectoryPath
  )

  $logRoot = Join-Path -Path $UserDataDirectory -ChildPath "logs"
  if (-not (Test-Path -LiteralPath $logRoot -PathType Container)) {
    return @()
  }

  $copied = @()
  $index = 0
  foreach ($log in @(Get-ChildItem -LiteralPath $logRoot -Filter "main.log" -File -Recurse -ErrorAction SilentlyContinue | Sort-Object -Property CreationTimeUtc)) {
    $index += 1
    $name = "diagnostic-main-$index.log"
    Copy-Item -LiteralPath $log.FullName -Destination (Join-Path -Path $EvidenceDirectoryPath -ChildPath $name) -Force
    $copied += $name
  }
  return @($copied)
}

$deliveryPath = [System.IO.Path]::GetFullPath($DeliveryDirectory)
$evidencePath = if ([string]::IsNullOrWhiteSpace($EvidenceDirectory)) {
  Join-Path -Path (Split-Path -Path $deliveryPath -Parent) -ChildPath "windows-smoke-evidence"
}
else {
  [System.IO.Path]::GetFullPath($EvidenceDirectory)
}
[void][System.IO.Directory]::CreateDirectory($evidencePath)
$evidenceFile = Join-Path -Path $evidencePath -ChildPath "internal-windows-smoke-evidence.json"
$startedAtUtc = [DateTime]::UtcNow
$temporaryRoot = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath "guai-code-windows-smoke-$([guid]::NewGuid().ToString('N'))"
$installDirectory = Join-Path -Path $temporaryRoot -ChildPath "Installed Guai Code Beta"
$portableDirectory = Join-Path -Path $temporaryRoot -ChildPath "Portable Guai Code Beta"
$userDataDirectory = Join-Path -Path $temporaryRoot -ChildPath "Isolated User Data"
$xdgRoot = Join-Path -Path $temporaryRoot -ChildPath "Isolated XDG"
$applicationPath = Join-Path -Path $installDirectory -ChildPath "Guai Code Beta.exe"
$guideName = "Guai-Code-Beta-Windows-$([char]0x8BD5)$([char]0x7528)$([char]0x8BF4)$([char]0x660E).md"
$installerName = "Guai-Code-Beta-$Version-win-x64.exe"
$portableName = "Guai-Code-Beta-$Version-win-x64-portable.zip"
$payloadNames = @(
  $installerName,
  $portableName,
  $guideName,
  "OpenCode-MIT-License.txt",
  "Git-for-Windows-License.txt"
)
$deliveryNames = @($payloadNames) + @("SHA256SUMS.txt")
$requiredPortableEntries = @(
  "Guai Code Beta.exe",
  "resources/mingit/cmd/git.exe",
  "resources/mingit/LICENSE.txt",
  "resources/licenses/OpenCode-MIT.txt"
)
$originalEnvironment = [ordered]@{
  XDG_DATA_HOME = [Environment]::GetEnvironmentVariable("XDG_DATA_HOME", "Process")
  XDG_CONFIG_HOME = [Environment]::GetEnvironmentVariable("XDG_CONFIG_HOME", "Process")
  XDG_CACHE_HOME = [Environment]::GetEnvironmentVariable("XDG_CACHE_HOME", "Process")
  XDG_STATE_HOME = [Environment]::GetEnvironmentVariable("XDG_STATE_HOME", "Process")
}
$evidence = [ordered]@{
  schemaVersion = 1
  success = $false
  version = $Version
  startedAtUtc = $startedAtUtc.ToString("o")
  completedAtUtc = $null
  runner = [ordered]@{
    machineName = [Environment]::MachineName
    userName = [Environment]::UserName
    osVersion = [Environment]::OSVersion.VersionString
    is64BitOperatingSystem = [Environment]::Is64BitOperatingSystem
    processArchitecture = $env:PROCESSOR_ARCHITECTURE
    powershellVersion = $PSVersionTable.PSVersion.ToString()
    powershellEdition = if ($PSVersionTable.ContainsKey("PSEdition")) { $PSVersionTable.PSEdition } else { "Desktop" }
    runnerOS = $env:RUNNER_OS
    imageOS = $env:ImageOS
    imageVersion = $env:ImageVersion
    githubRunId = $env:GITHUB_RUN_ID
    githubSha = $env:GITHUB_SHA
  }
  delivery = [ordered]@{
    directory = $deliveryPath
    files = @()
  }
  installer = $null
  portableZip = $null
  gitVersion = $null
  launches = @()
  modelState = $null
  uninstall = [ordered]@{
    attempted = $false
    installDirectoryRemoved = $false
  }
  diagnostics = [ordered]@{
    error = $null
    cleanupErrors = @()
    copiedLogs = @()
    temporaryRoot = $temporaryRoot
    evidenceDirectory = $evidencePath
  }
}
$activeProcess = $null
$launchEvidence = @()
$failure = $null
$cleanupErrors = @()
$installationStarted = $false

try {
  Assert-Condition ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) "Installed-package verification must run on Windows."
  Assert-Condition ([Environment]::Is64BitOperatingSystem) "Installed-package verification requires Windows x64."
  Assert-Condition (Test-Path -LiteralPath $deliveryPath -PathType Container) "Delivery directory does not exist: $deliveryPath"
  Assert-ExactDeliveryFiles -Directory $deliveryPath -ExpectedNames $deliveryNames

  $manifestPath = Join-Path -Path $deliveryPath -ChildPath "SHA256SUMS.txt"
  $evidence.delivery.files = Get-VerifiedManifestEntries -Directory $deliveryPath -ManifestPath $manifestPath -ExpectedNames $payloadNames
  $installerPath = Join-Path -Path $deliveryPath -ChildPath $installerName
  $portablePath = Join-Path -Path $deliveryPath -ChildPath $portableName
  $installerSignature = Get-AuthenticodeSignature -LiteralPath $installerPath
  $signatureStatus = $installerSignature.Status.ToString()
  Assert-Condition (@("NotSigned", "Valid") -contains $signatureStatus) "Installer Authenticode status must be NotSigned or Valid; received $signatureStatus."
  $evidence.installer = [ordered]@{
    name = $installerName
    sha256 = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
    sizeBytes = (Get-Item -LiteralPath $installerPath).Length
    authenticodeStatus = $signatureStatus
    fileVersion = $null
    productVersion = $null
    productName = $null
    installDirectory = $installDirectory
    installArguments = @("/S", "/D=$installDirectory")
    installExitCode = $null
  }
  $evidence.portableZip = [ordered]@{
    name = $portableName
    sha256 = (Get-FileHash -LiteralPath $portablePath -Algorithm SHA256).Hash.ToLowerInvariant()
    sizeBytes = (Get-Item -LiteralPath $portablePath).Length
    requiredEntries = @()
    executable = $null
    gitVersion = $null
  }

  [void][System.IO.Directory]::CreateDirectory($temporaryRoot)
  $expectedVersion = Get-ExpectedVersionMetadata -ExpectedVersion $Version
  $portableResult = Expand-AndVerifyPortableZip -ZipPath $portablePath -Destination $portableDirectory -RequiredEntries $requiredPortableEntries -ExpectedVersion $expectedVersion
  $evidence.portableZip.requiredEntries = $portableResult.requiredEntries
  $evidence.portableZip.executable = $portableResult.executable
  $evidence.portableZip.gitVersion = $portableResult.gitVersion

  $installationStarted = $true
  $installerProcess = Start-Process -FilePath $installerPath -ArgumentList @("/S", "/D=$installDirectory") -PassThru
  if (-not $installerProcess.WaitForExit($OperationTimeoutSeconds * 1000)) {
    Stop-Process -Id $installerProcess.Id -Force -ErrorAction SilentlyContinue
    throw "Installer timed out after $OperationTimeoutSeconds seconds."
  }
  $evidence.installer.installExitCode = $installerProcess.ExitCode
  Assert-Condition ($installerProcess.ExitCode -eq 0) "Installer exited with code $($installerProcess.ExitCode)."
  Assert-Condition (Test-Path -LiteralPath $applicationPath -PathType Leaf) "Installed application executable is missing: $applicationPath"

  $installedMetadata = Assert-ExecutableVersion -ExecutablePath $applicationPath -Expected $expectedVersion
  $evidence.installer.fileVersion = $installedMetadata.fileVersion
  $evidence.installer.productVersion = $installedMetadata.productVersion
  $evidence.installer.productName = $installedMetadata.productName
  foreach ($relativePath in @(
    "resources\licenses\OpenCode-MIT.txt",
    "resources\mingit\LICENSE.txt",
    "resources\mingit\cmd\git.exe"
  )) {
    Assert-Condition (Test-Path -LiteralPath (Join-Path -Path $installDirectory -ChildPath $relativePath) -PathType Leaf) "Installed package is missing: $relativePath"
  }
  $installedGitPath = Join-Path -Path $installDirectory -ChildPath "resources\mingit\cmd\git.exe"
  $evidence.gitVersion = Invoke-BundledGitVersion -GitPath $installedGitPath
  Assert-Condition ($evidence.gitVersion -eq $evidence.portableZip.gitVersion) "Installed and portable bundled Git versions differ."

  foreach ($directory in @(
    $userDataDirectory,
    (Join-Path -Path $xdgRoot -ChildPath "data"),
    (Join-Path -Path $xdgRoot -ChildPath "config"),
    (Join-Path -Path $xdgRoot -ChildPath "cache"),
    (Join-Path -Path $xdgRoot -ChildPath "state")
  )) {
    [void][System.IO.Directory]::CreateDirectory($directory)
  }
  $env:XDG_DATA_HOME = Join-Path -Path $xdgRoot -ChildPath "data"
  $env:XDG_CONFIG_HOME = Join-Path -Path $xdgRoot -ChildPath "config"
  $env:XDG_CACHE_HOME = Join-Path -Path $xdgRoot -ChildPath "cache"
  $env:XDG_STATE_HOME = Join-Path -Path $xdgRoot -ChildPath "state"

  $activeProcess = Wait-ApplicationReady -ApplicationPath $applicationPath -UserDataDirectory $userDataDirectory -EvidenceDirectoryPath $evidencePath -LaunchName "first-launch" -TimeoutSeconds $ReadyTimeoutSeconds -ProcessReference ([ref]$activeProcess) -LaunchEvidenceReference ([ref]$launchEvidence)
  $launchEvidence[-1].stop = Stop-ApplicationProcess -Process $activeProcess -ApplicationPath $applicationPath -TimeoutSeconds $OperationTimeoutSeconds
  $activeProcess = $null
  Start-Sleep -Milliseconds 1100

  $activeProcess = Wait-ApplicationReady -ApplicationPath $applicationPath -UserDataDirectory $userDataDirectory -EvidenceDirectoryPath $evidencePath -LaunchName "restart" -TimeoutSeconds $ReadyTimeoutSeconds -ProcessReference ([ref]$activeProcess) -LaunchEvidenceReference ([ref]$launchEvidence)
  $launchEvidence[-1].stop = Stop-ApplicationProcess -Process $activeProcess -ApplicationPath $applicationPath -TimeoutSeconds $OperationTimeoutSeconds
  $activeProcess = $null
  $evidence.modelState = Get-ModelProfileState -UserDataDirectory $userDataDirectory
}
catch {
  $failure = $_
  $evidence.diagnostics.error = $_.Exception.ToString()
}
finally {
  $evidence.launches = @($launchEvidence)

  try {
    if ($null -ne $activeProcess) {
      $activeProcess.Refresh()
      if (-not $activeProcess.HasExited) {
        Stop-Process -Id $activeProcess.Id -Force -ErrorAction Stop
        [void]$activeProcess.WaitForExit($OperationTimeoutSeconds * 1000)
      }
    }
    if (Test-Path -LiteralPath $applicationPath -PathType Leaf) {
      Stop-InstalledApplicationProcesses -ApplicationPath $applicationPath -TimeoutSeconds $OperationTimeoutSeconds
    }
  }
  catch {
    $cleanupErrors += "Process cleanup failed: $($_.Exception.Message)"
  }

  try {
    $evidence.diagnostics.copiedLogs = @(Copy-DiagnosticLogs -UserDataDirectory $userDataDirectory -EvidenceDirectoryPath $evidencePath)
  }
  catch {
    $cleanupErrors += "Diagnostic log copy failed: $($_.Exception.Message)"
  }

  try {
    if (Test-Path -LiteralPath $installDirectory -PathType Container) {
      $evidence.uninstall = Invoke-SilentUninstall -InstallDirectory $installDirectory -TimeoutSeconds $OperationTimeoutSeconds
    }
    elseif ($installationStarted) {
      $evidence.uninstall = [ordered]@{
        attempted = $false
        reason = "Install directory was already absent."
        installDirectoryRemoved = $true
      }
    }
    else {
      $evidence.uninstall = [ordered]@{
        attempted = $false
        reason = "Installation did not start."
        installDirectoryRemoved = $true
      }
    }
  }
  catch {
    $evidence.uninstall = [ordered]@{
      attempted = $true
      error = $_.Exception.ToString()
      installDirectoryRemoved = -not (Test-Path -LiteralPath $installDirectory)
    }
    $cleanupErrors += "Silent uninstall failed: $($_.Exception.Message)"
  }

  foreach ($name in @($originalEnvironment.Keys)) {
    [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], "Process")
  }

  try {
    if (Test-Path -LiteralPath $temporaryRoot) {
      Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
  }
  catch {
    $cleanupErrors += "Temporary directory cleanup failed: $($_.Exception.Message)"
  }

  $evidence.diagnostics.cleanupErrors = @($cleanupErrors)
  $evidence.completedAtUtc = [DateTime]::UtcNow.ToString("o")
  $evidence.success = ($null -eq $failure) -and ($cleanupErrors.Count -eq 0) -and [bool]$evidence.uninstall.installDirectoryRemoved
  try {
    $evidence | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $evidenceFile -Encoding UTF8
    Write-Host "Windows smoke evidence: $evidenceFile"
  }
  catch {
    $cleanupErrors += "Evidence write failed: $($_.Exception.Message)"
  }
}

if ($null -ne $failure) {
  throw $failure
}
if ($cleanupErrors.Count -gt 0) {
  throw ($cleanupErrors -join [Environment]::NewLine)
}
Assert-Condition $evidence.success "Installed-package verification did not complete successfully. Evidence: $evidenceFile"
Write-Host "Installed Windows package verification passed for version $Version."
