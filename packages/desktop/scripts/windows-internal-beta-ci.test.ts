import { describe, expect, test } from "bun:test"
import path from "node:path"

const verifierPath = path.join(import.meta.dir, "verify-internal-windows.ps1")
const workflowPath = path.join(import.meta.dir, "..", "..", "..", ".github", "workflows", "windows-internal-beta.yml")

function section(source: string, start: string, end: string) {
  const normalizedSource = source.replaceAll("\r\n", "\n")
  const startIndex = normalizedSource.indexOf(start)
  const endIndex = normalizedSource.indexOf(end, startIndex)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)
  return normalizedSource.slice(startIndex, endIndex)
}

describe("Windows internal beta CI safety contracts", () => {
  test("extracts sections from CRLF sources with LF markers", () => {
    const source = "before\r\nstart\r\nbody\r\nend\r\nafter"

    expect(section(source, "start\nbody", "\nend")).toBe("start\nbody")
  })

  test("stamps the Alpha 4 package build with the workflow source commit", async () => {
    const workflow = await Bun.file(workflowPath).text()
    const version = section(workflow, "      - name: Resolve internal beta version", "      - name: Setup Bun")
    const packageStep = section(
      workflow,
      "      - name: Package Windows internal beta",
      "      - name: Verify native safeStorage across processes",
    )
    const revisionAssignment = "$env:GUAI_CODE_BUILD_COMMIT = $env:GITHUB_SHA"
    const packageCommand = "bun run package:win:internal"

    expect(version).toContain('$version -cne "0.1.0-alpha.4"')
    expect(packageStep).toContain(revisionAssignment)
    expect(packageStep.indexOf(revisionAssignment)).toBeLessThan(packageStep.indexOf(packageCommand))
  })

  test("validates exact delivery contents without dereferencing an empty directory collection", async () => {
    const verifier = await Bun.file(verifierPath).text()
    const exactDelivery = section(
      verifier,
      "function Assert-ExactDeliveryFiles",
      "function Get-VerifiedManifestEntries",
    )

    expect(exactDelivery).toContain("Get-ChildItem -LiteralPath $Directory -Force")
    const unexpectedDirectories = section(exactDelivery, "if ($directories.Count -ne 0) {", "\n  }\n\n  $actualNames")
    expect(unexpectedDirectories).toContain("$directoryNames = @($directories | ForEach-Object { $_.Name })")
    expect(unexpectedDirectories).toContain(
      "throw \"Delivery directory contains unexpected directories: $($directoryNames -join ', ')\"",
    )
    expect(exactDelivery).not.toContain("$directories.Name")
    expect(exactDelivery).toContain("[System.StringComparer]::Ordinal")
    expect(exactDelivery).toContain("$actual.Count -eq $ExpectedNames.Count")
    expect(exactDelivery).toContain("$actual.Contains($name)")
  })

  test("uses one durable Electron profile and allowlisted safeStorage diagnostics", async () => {
    const workflow = await Bun.file(workflowPath).text()
    const electronRuntime = section(
      workflow,
      "      - name: Prepare Electron runtime",
      "      - name: Parse verifier with Windows PowerShell 5.1",
    )
    const smoke = section(
      workflow,
      "      - name: Verify native safeStorage",
      "      - name: Verify installed Windows package",
    )
    const readyIndex = smoke.indexOf("app.whenReady()")
    const userDataSetPath = 'app.setPath("userData", expectedProfilePath)'
    const sessionDataSetPath = 'app.setPath("sessionData", expectedProfilePath)'

    expect(electronRuntime).toContain('require.resolve("electron/package.json")')
    expect(electronRuntime).toContain('"ffmpeg.dll"')
    expect(electronRuntime).toContain('"icudtl.dat"')
    expect(electronRuntime).toContain('"resources\\default_app.asar"')
    expect(electronRuntime).toContain('Remove-Item -LiteralPath $electronDistDirectory -Recurse -Force')
    expect(electronRuntime).toContain('& node (Join-Path $electronPackageDirectory "install.js")')
    expect(electronRuntime).toContain('throw "Electron runtime is incomplete: $($missingRuntimeFiles -join \', \')"')
    expect(smoke).toContain(userDataSetPath)
    expect(smoke).toContain(sessionDataSetPath)
    expect(smoke.indexOf(userDataSetPath)).toBeLessThan(readyIndex)
    expect(smoke.indexOf(sessionDataSetPath)).toBeLessThan(readyIndex)
    expect(smoke).toContain('app.getPath("userData")')
    expect(smoke).toContain('app.getPath("sessionData")')
    expect(smoke).toContain("actualPathsMatched")
    expect(smoke).toContain('join(expectedProfilePath, "Local State")')
    expect(smoke).toContain("localStateExists")
    expect(smoke).toContain("localStateValid")
    expect(smoke).toContain("encryptedKeyPresent")
    expect(smoke).toContain("os_crypt")
    expect(smoke).toContain("encrypted_key")
    const durableLocalStateInvocation =
      "$localStateStatus = Wait-DurableLocalState -Path $localStatePath -TimeoutSeconds 15"
    expect(smoke).toContain(durableLocalStateInvocation)
    expect(smoke.indexOf(durableLocalStateInvocation)).toBeLessThan(
      smoke.indexOf('$env:GUAI_CODE_SAFE_STORAGE_MODE = "decrypt"'),
    )
    expect(smoke).toContain("app.quit()")
    expect(smoke).not.toContain("app.exit(")
    expect(smoke).toContain("failureStage")
    expect(smoke).toContain("failureCode")
    expect(smoke).toContain("errorName")
    expect(smoke).toContain("allowedFailureCodes.has(error?.safeCode)")
    expect(smoke).toContain("Select-AllowlistedDiagnostic")
    expect(smoke).not.toContain("error.message")
    expect(smoke).not.toContain("error.stack")
    expect(smoke).toContain("$process = Start-Process @startParameters")
    expect(smoke).toContain("FilePath = [System.IO.Path]::GetFullPath($ElectronPath)")
    expect(smoke).toContain("WorkingDirectory = [System.IO.Path]::GetFullPath($ApplicationPath)")
    expect(smoke.indexOf("$processId = $process.Id")).toBeLessThan(
      smoke.indexOf("$process.WaitForExit($TimeoutSeconds * 1000)"),
    )
    expect(smoke).toContain("processId = $processId")
    expect(smoke.indexOf("return $result")).toBeGreaterThan(smoke.indexOf("$process.Dispose()"))
    expect(smoke).toContain("safeStorage process diagnostic: operation=$operation")
    expect(smoke).toContain("nativeErrorCode=$nativeErrorCode")
    expect(smoke).not.toContain("$_.Exception.Message")
    expect(smoke).not.toContain("$_.Exception.StackTrace")

    const childFailure = section(smoke, "const writeFailure", "let startupError")
    expect(childFailure).not.toMatch(
      /\bmode,|plaintext|ciphertext|expectedProfilePath|localStateContents|encrypted_key/,
    )
    const parentFailure = section(smoke, "          catch {\n            $failureErrorName", "          finally {")
    expect(parentFailure).not.toMatch(
      /plaintext|ciphertext|profileDirectory|localStateContents|encrypted_key|\.Exception/,
    )

    for (const result of smoke.matchAll(/writeResult\(\{([\s\S]*?)\}\)/g)) {
      expect(result[1]).not.toMatch(/expectedProfilePath|userDataPath|localStateContents|encryptedKey\s*[:,]/)
    }

    const proof = section(smoke, '$failureStage = "verify-proof"', '$failureStage = "write-evidence"')
    expect(proof).toContain("$encryptResult.pid -eq $decryptResult.pid")
    expect(smoke).toContain("$encryptResult.pid -ne $encryptProcess.processId")
    expect(smoke).toContain("$decryptResult.pid -ne $decryptProcess.processId")
    expect(proof).toContain("$encryptResult.userIdentitySha256 -cne $decryptResult.userIdentitySha256")
    expect(proof).toContain("$encryptResult.plaintextSha256 -cne $decryptResult.plaintextSha256")
    expect(proof).toContain("$encryptResult.ciphertextSha256 -cne $decryptResult.ciphertextSha256")
    expect(smoke).toContain('if (encrypted.includes(plaintextBuffer)) fail("PLAINTEXT_IN_ENCRYPTED_BYTES")')
    expect(smoke).toContain('if (decodedPersisted.includes(plaintextBuffer)) fail("PLAINTEXT_IN_PERSISTED_CIPHERTEXT")')
    expect(proof).toContain("$encryptResult.plaintextPersisted")
    expect(smoke).toContain("unlinkSync(ciphertextPath)")
    expect(smoke).toContain('if (existsSync(ciphertextPath)) fail("CIPHERTEXT_NOT_DELETED")')
    expect(proof).toContain("-not $decryptResult.ciphertextDeleted")
    expect(proof).toContain("(Test-Path -LiteralPath $ciphertextPath)")

    const cleanupIndex = smoke.lastIndexOf("          finally {")
    expect(cleanupIndex).toBeGreaterThan(smoke.lastIndexOf("success = $false"))
    const cleanup = smoke.slice(cleanupIndex)
    expect(cleanup).toContain("$smokeRootRemaining = $true")
    expect(cleanup).toContain("Remove-Item -LiteralPath $smokeRoot -Recurse -Force -ErrorAction Stop")
    expect(cleanup).toContain("$smokeRootRemaining = Test-Path -LiteralPath $smokeRoot -ErrorAction Stop")
    expect(cleanup).toContain("if ($smokeRootRemaining)")
    expect(cleanup).toContain('throw "safeStorage smoke cleanup failed."')
    expect(cleanup).not.toContain("$safeStorageEvidence")
    expect(cleanup).not.toContain("Remove-Item -LiteralPath $smokeRoot -Recurse -Force -ErrorAction SilentlyContinue")
  })

  test("uploads only allowlisted evidence after safeStorage, verifier, and credential scan success", async () => {
    const workflow = await Bun.file(workflowPath).text()
    const scan = section(
      workflow,
      "      - name: Scan package and smoke evidence for credential canaries",
      "      - name: Prepare uploadable smoke evidence",
    )
    const prepare = section(
      workflow,
      "      - name: Prepare uploadable smoke evidence",
      "      - name: Prepare sanitized smoke evidence",
    )
    const upload = section(
      workflow,
      "      - name: Upload validated smoke evidence",
      "      - name: Upload sanitized smoke evidence",
    )
    const deliveryUpload = section(
      workflow,
      "      - name: Upload Windows delivery",
      "      - name: Upload validated smoke evidence",
    )

    expect(scan).toContain(
      "if: always() && steps.package.outcome == 'success' && steps.safe_storage.outcome == 'success' && steps.verifier.outcome == 'success'",
    )
    expect(scan).toContain('Where-Object { $_.Name -like "*main.log" }')
    expect(scan).toContain('throw "Smoke evidence does not contain a copied main.log."')
    expect(prepare).toContain("id: uploadable_evidence")
    expect(prepare).toContain("bun ./packages/desktop/scripts/windows-internal-evidence.ts")
    expect(prepare).toContain("$sourceDirectory")
    expect(prepare).toContain("$uploadDirectory")
    expect(prepare).not.toContain("main.log")
    expect(prepare).not.toContain("forbiddenKeys")
    expect(prepare).not.toContain("Assert-UploadableEvidence")
    expect(prepare).not.toContain("ConvertTo-Json")
    expect(prepare).not.toContain("Copy-Item")
    expect(deliveryUpload).toContain("if: success() && !inputs.safe_storage_diagnostic")
    expect(upload).toContain("steps.safe_storage.outcome == 'success'")
    expect(upload).toContain("steps.credential_scan.outcome == 'success'")
    expect(upload).toContain("steps.uploadable_evidence.outcome == 'success'")
    expect(upload).toContain("${{ runner.temp }}/guai-code-windows-internal-beta-uploadable-evidence")
    expect(upload).not.toContain("${{ runner.temp }}/guai-code-windows-internal-beta-smoke-evidence")
    expect(workflow).toContain("if: always() && steps.uploadable_evidence.outcome != 'success'")
  })

  test("serializes allowlisted verifier evidence without paths or exception details", async () => {
    const verifier = await Bun.file(verifierPath).text()
    const uploadable = section(verifier, "function Get-UploadableEvidence", "function New-EvidenceTarget")

    expect(uploadable).toContain("schemaVersion = 2")
    expect(uploadable).toContain("delivery = [ordered]@{")
    expect(uploadable).toContain("$installer = if ($null -eq $Evidence.installer)")
    expect(uploadable).toContain("installer = $installer")
    expect(uploadable).toContain("$portableZip = if ($null -eq $Evidence.portableZip)")
    expect(uploadable).toContain("portableZip = $portableZip")
    expect(uploadable).toContain("launches = @($launches)")
    expect(uploadable).toContain("processAliveAtReady = [bool]$launch.processAliveAtReady")
    expect(uploadable).toContain("bundledGitEnabled = [bool]$launch.bundledGitEnabled")
    expect(uploadable).toContain("serverReady = [bool]$launch.serverReady")
    expect(uploadable).toContain("readinessLogCopiedForScan")
    expect(uploadable).toContain("stop = $stop")
    expect(uploadable).toContain("profileCount = $Evidence.modelState.profileCount")
    expect(uploadable).toContain("installDirectoryRemoved = [bool]$Evidence.uninstall.installDirectoryRemoved")
    expect(uploadable).toContain("copiedLogCount = @($Evidence.diagnostics.copiedLogs).Count")
    expect(verifier).toContain("$evidence.installer.installExitCode = $installerProcess.ExitCode")
    expect(verifier).toContain('-LaunchName "first-launch"')
    expect(verifier).toContain('-LaunchName "restart"')
    expect(verifier).toContain("$launchEvidence[-1].stop = Stop-ApplicationProcess")
    expect(verifier).toContain("$evidence.uninstall = Invoke-SilentUninstall")
    expect(uploadable).not.toMatch(
      /\b(inputDirectory|directory|installDirectory|installArguments|logPath|evidenceLog|path|temporaryRoot|evidenceDirectory|copiedLogs|error|message|stack)\s*=/,
    )
    expect(verifier).toContain("$uploadableEvidence = Get-UploadableEvidence -Evidence $evidence")
    expect(verifier).toContain("$uploadableEvidence | ConvertTo-Json -Depth 12")
    expect(verifier).not.toContain("$evidence | ConvertTo-Json -Depth 12")
    expect(verifier).not.toContain(".Exception.ToString()")
    expect(verifier).not.toContain(".Exception.Message")
  })
})
