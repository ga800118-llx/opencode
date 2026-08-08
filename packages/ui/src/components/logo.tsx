import { type ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path data-slot="logo-mark-g-top" d="M0 0H16V4H0V0Z" fill="var(--icon-strong-base)" />
      <path data-slot="logo-mark-g-left" d="M0 0H4V20H0V0Z" fill="var(--icon-strong-base)" />
      <path data-slot="logo-mark-g-bottom" d="M0 16H16V20H0V16Z" fill="var(--icon-strong-base)" />
      <path data-slot="logo-mark-g-crossbar" d="M8 8H16V12H8V8Z" fill="var(--icon-strong-base)" />
      <path data-slot="logo-mark-g-leg" d="M12 12H16V20H12V12Z" fill="var(--icon-weak-base)" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M0 0H80V20H0V0Z" fill="var(--icon-strong-base)" />
      <path d="M0 0H20V100H0V0Z" fill="var(--icon-strong-base)" />
      <path d="M0 80H80V100H0V80Z" fill="var(--icon-strong-base)" />
      <path d="M40 40H80V60H40V40Z" fill="var(--icon-strong-base)" />
      <path d="M60 60H80V100H60V60Z" fill="var(--icon-base)" />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 184 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <path d="M0 6H24V12H0V6Z" fill="var(--icon-base)" />
      <path d="M0 6H6V36H0V6Z" fill="var(--icon-base)" />
      <path d="M0 30H24V36H0V30Z" fill="var(--icon-base)" />
      <path d="M12 18H24V24H12V18Z" fill="var(--icon-base)" />
      <path d="M18 24H24V36H18V24Z" fill="var(--icon-weak-base)" />
      <text
        x="34"
        y="31"
        fill="var(--icon-strong-base)"
        font-family="IBM Plex Sans, Arial, sans-serif"
        font-size="28"
        font-weight="700"
      >
        Guai Code
      </text>
    </svg>
  )
}
