import { resolveChannel } from "./utils"
import { getProductIdentity } from "../src/product/identity"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const identity = getProductIdentity(channel)
const summary = `Open source AI coding agent${channel !== "prod" ? ` (${channel})` : ""}`

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${identity.appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${identity.name}</name>
  <summary>${summary}</summary>

  <developer id="com.guaicode">
    <name>Guai Code</name>
  </developer>

  <description>
    <p>
      Guai Code is an open source agent that helps you write and run code with any AI model.
    </p>
  </description>

  <launchable type="desktop-id">${identity.appId}.desktop</launchable>

  <content_rating type="oars-1.1" />

</component>
`

await Bun.write(`resources/${identity.appId}.metainfo.xml`, xml)
console.log(`Generated metainfo for ${channel} at resources/${identity.appId}.metainfo.xml`)
