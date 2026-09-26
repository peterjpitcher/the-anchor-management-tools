import { GUEST_H2_CLASS, GUEST_MUTED_CLASS } from './styles'

type GuestSectionProps = {
  /** Heading over the group. Leave it out for a plain ruled-off block. */
  title?: React.ReactNode
  /** Id for the heading, which also names the section for assistive tech. */
  titleId?: string
  description?: React.ReactNode
  children: React.ReactNode
}

/**
 * A ruled-off group lower down a guest page: a top rule, an optional serif
 * heading and description, then its content one card-rhythm apart.
 *
 * Hook-free on purpose, so it renders from a server component. That is why the
 * heading id is passed in rather than generated.
 */
export function GuestSection({
  title,
  titleId,
  description,
  children,
}: GuestSectionProps): React.JSX.Element {
  return (
    <section
      aria-labelledby={title && titleId ? titleId : undefined}
      className="flex flex-col gap-guest-md border-t border-guest-border-strong pt-guest-lg"
    >
      {title ? (
        <div className="flex flex-col gap-guest-xs">
          <h2 id={titleId} className={GUEST_H2_CLASS}>
            {title}
          </h2>
          {description ? <p className={GUEST_MUTED_CLASS}>{description}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}
