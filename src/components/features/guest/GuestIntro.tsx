import {
  GUEST_H1_CLASS,
  GUEST_INTRO_CLASS,
  GUEST_KICKER_CLASS,
  GUEST_LEAD_CLASS,
} from './styles'

type GuestIntroProps = {
  /** Names the flow, e.g. `Table booking`. Carries no facts. */
  kicker?: string
  /**
   * The decorative locality line in the script face, shown instead of a kicker.
   * The feedback funnel is the only place that uses it.
   */
  script?: string
  /** The page `h1`. */
  title: React.ReactNode
  /** The greeting or lead line under the title. */
  lead?: React.ReactNode
  /** Anything else that belongs to the heading, such as a status badge. */
  children?: React.ReactNode
}

/** The decorative script line. Only the feedback funnel uses the script face. */
export const GUEST_SCRIPT_CLASS = 'font-anchor-script text-guest-script text-guest-accent-text'

/**
 * The top of every guest page: kicker, `h1` and lead, one rhythm apart. This is
 * the guest counterpart of the staff page title, so no page builds its own `h1`.
 */
export function GuestIntro({ kicker, script, title, lead, children }: GuestIntroProps): React.JSX.Element {
  return (
    <div className={GUEST_INTRO_CLASS}>
      {script ? <p className={GUEST_SCRIPT_CLASS}>{script}</p> : null}
      {kicker ? <p className={GUEST_KICKER_CLASS}>{kicker}</p> : null}
      <h1 className={GUEST_H1_CLASS}>{title}</h1>
      {lead ? <p className={GUEST_LEAD_CLASS}>{lead}</p> : null}
      {children}
    </div>
  )
}
