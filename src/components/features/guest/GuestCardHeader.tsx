import { GUEST_H2_CLASS, GUEST_MUTED_CLASS } from './styles'

type GuestCardHeaderProps = {
  title: React.ReactNode
  /** One short line under the title, in sentence case. */
  description?: React.ReactNode
  /** Id on the heading, for a form or group that names itself after it. */
  id?: string
}

/**
 * The title of a card: the one heading style below the page title on a guest
 * page, the same serif as `GuestSection`. Never hand-build a heading inside a
 * `GuestCard`.
 */
export function GuestCardHeader({ title, description, id }: GuestCardHeaderProps): React.JSX.Element {
  return (
    <div className="mb-guest-md flex flex-col gap-guest-xs">
      <h2 id={id} className={GUEST_H2_CLASS}>
        {title}
      </h2>
      {description ? <p className={GUEST_MUTED_CLASS}>{description}</p> : null}
    </div>
  )
}
