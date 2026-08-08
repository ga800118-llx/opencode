import { createUniqueId, type ComponentProps } from "solid-js"

export function WordmarkV2(props: Pick<ComponentProps<"svg">, "class">) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 720 129"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g opacity="0.6" mask={`url(#${mask})`}>
        <path d="M0 18H92V41H0V18Z" fill="currentColor" />
        <path d="M0 18H23V110H0V18Z" fill="currentColor" />
        <path d="M0 87H92V110H0V87Z" fill="currentColor" />
        <path d="M46 55H92V78H46V55Z" fill="currentColor" />
        <path d="M69 78H92V110H69V78Z" fill="currentColor" opacity="0.65" />
        <text
          x="122"
          y="93"
          fill="currentColor"
          font-family="IBM Plex Sans, Arial, sans-serif"
          font-size="76"
          font-weight="700"
        >
          Guai Code
        </text>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="720" height="129">
          <rect width="720" height="129" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="360" y1="68" x2="360" y2="129" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
