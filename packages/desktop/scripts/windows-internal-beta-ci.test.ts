import { describe, expect, test } from "bun:test"
import path from "node:path"

const verifierPath = path.join(import.meta.dir, "verify-internal-windows.ps1")
const workflowPath = path.join(import.meta.dir, "..", "..", "..", ".github", "workflows", "windows-internal-beta.yml")

function section(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)
  return source.slice(startIndex, endIndex)
}

describe("Windows internal beta CI safety contracts", () => {
  test("validates exact delivery contents without dereferencing an empty directory collection", async () => {
    const verifier = await Bun.file(verifierPath).text()
    const exactDelivery = section(
      verifier,
      "function Assert-ExactDeliveryFiles",
      "function Get-VerifiedManifestEntries",
    )

    expect(exactDelivery).toContain("Get-ChildItem -LiteralPath $Directory -Force")
    expect(exactDelivery).toContain("if ($directories.Count -ne 0)")
    expect(exactDelivery).toContain("$directoryNames = @($directories | ForEach-Object { $_.Name })")
    expect(exactDelivery).not.toContain("$directories.Name")
    expect(exactDelivery).toContain("[System.StringComparer]::Ordinal")
    expect(exactDelivery).toContain("$actual.Count -eq $ExpectedNames.Count")
    expect(exactDelivery).toContain("$actual.Contains($name)")
  })

  test("uses one durable Electron profile and allowlisted safeStorage diagnostics", async () => {
    const workflow = await Bun.file(workflowPath).text()
    const smoke = section(
      workflow,
      "      - name: Verify native safeStorage",
      "      - name: Verify installed Windows package",
    )
    const readyIndex = smoke.indexOf("app.whenReady()")

    expect(smoke.indexOf('app.setPath("userData", expectedProfilePath)')).toBeLessThan(readyIndex)
    expect(smoke.indexOf('app.setPath("sessionData", expectedProfilePath)')).toBeLessThan(readyIndex)
    expect(smoke).toContain('app.getPath("userData")')
    expect(smoke).toContain('app.getPath("sessionData")')
    expect(smoke).toContain("actualPathsMatched")
    expect(smoke).toContain('join(expectedProfilePath, "Local State")')
    expect(smoke).toContain("localStateExists")
    expect(smoke).toContain("localStateValid")
    expect(smoke).toContain("encryptedKeyPresent")
    expect(smoke).toContain("os_crypt")
    expect(smoke).toContain("encrypted_key")
    expect(smoke).toContain("Wait-DurableLocalState")
    expect(smoke.indexOf("Wait-DurableLocalState")).toBeLessThan(
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
  })

  test("scans credentials only after package and verifier success", async () => {
    const workflow = await Bun.file(workflowPath).text()
    const scan = section(
      workflow,
      "      - name: Scan package and smoke evidence for credential canaries",
      "      - name: Prepare sanitized smoke evidence",
    )

    expect(scan).toContain("if: always() && steps.package.outcome == 'success' && steps.verifier.outcome == 'success'")
    expect(scan).toContain('Where-Object { $_.Name -like "*main.log" }')
    expect(scan).toContain('throw "Smoke evidence does not contain a copied main.log."')
    expect(workflow).toContain("if: always() && steps.credential_scan.outcome == 'success'")
    expect(workflow).toContain("if: always() && steps.credential_scan.outcome != 'success'")
  })
})
