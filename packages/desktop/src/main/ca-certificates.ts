type CertificateSource = "default" | "system"

export function configureCACertificates(input: {
  environment: Record<string, string | undefined>
  get: (type: CertificateSource) => string[]
  set: (certificates: string[]) => void
}) {
  const sources: CertificateSource[] =
    input.environment.GUAI_CODE_INTERNAL_PACKAGE_SMOKE === "1" ? ["default"] : ["default", "system"]
  const certificates = sources.flatMap(input.get)
  input.set([...new Set(certificates)])
}
