import { type ComponentProps } from "solid-js"
import { GUAI_MARK_PATH, GUAI_MARK_VIEWBOX, GUAI_WORDMARK } from "./logo-geometry"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox={GUAI_MARK_VIEWBOX}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path data-slot="logo-mark-g" d={GUAI_MARK_PATH} fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox={GUAI_MARK_VIEWBOX}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={GUAI_MARK_PATH} fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 150 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <path d={GUAI_MARK_PATH} transform="translate(0 1) scale(0.36)" fill="var(--icon-base)" />
      <text
        x="45"
        y="31"
        fill="var(--icon-strong-base)"
        font-family="IBM Plex Sans, Arial, sans-serif"
        font-size="27"
        font-weight="600"
      >
        {GUAI_WORDMARK}
      </text>
    </svg>
  )
}
