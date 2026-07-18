// src/lib/checklists/spot-draw.ts
// Weighted, seedable spot-check draw (spec 11, F-21). Pure function, no I/O.
// Candidates recently checked less often carry more weight, so the draw does not
// keep landing on the same fridge. The RNG is injected so tests are deterministic.

/** One instance eligible for a spot check, tagged with its task template. */
export interface DrawCandidate {
  instanceId: string
  templateId: string
}

/**
 * Candidate weight = 1 / (1 + checks of the same template in the last 14 days),
 * so a never-checked template weighs 1 and a template checked 5 times weighs 1/6.
 */
function weightFor(candidate: DrawCandidate, recentChecksByTemplate: Record<string, number>): number {
  const recent = recentChecksByTemplate[candidate.templateId] ?? 0
  return 1 / (1 + recent)
}

/**
 * Draw up to `count` spot checks by weighted random selection without replacement
 * (spec 11). Each pick sums the remaining candidates' weights, targets `rng() * total`,
 * and walks the remaining candidates (ordered by weight descending) until the running
 * sum exceeds the target. Ordering descending makes `rng() === 0` deterministically
 * choose the highest-weight (least-recently-checked) candidate.
 *
 * Returns the chosen instanceIds in selection order, with no repeats. Fewer candidates
 * than `count` returns all of them; empty candidates returns [].
 */
export function drawSpotChecks(
  candidates: DrawCandidate[],
  recentChecksByTemplate: Record<string, number>,
  count: number,
  rng: () => number,
): string[] {
  // Highest weight first: makes rng()===0 pick the least-recently-checked candidate,
  // and keeps the whole draw deterministic for a fixed rng sequence.
  const remaining = [...candidates].sort(
    (a, b) => weightFor(b, recentChecksByTemplate) - weightFor(a, recentChecksByTemplate),
  )

  const chosen: string[] = []

  while (chosen.length < count && remaining.length > 0) {
    const total = remaining.reduce((sum, candidate) => sum + weightFor(candidate, recentChecksByTemplate), 0)
    const target = rng() * total

    let running = 0
    let pickedIndex = remaining.length - 1
    for (let i = 0; i < remaining.length; i++) {
      running += weightFor(remaining[i], recentChecksByTemplate)
      if (running > target) {
        pickedIndex = i
        break
      }
    }

    const [picked] = remaining.splice(pickedIndex, 1)
    chosen.push(picked.instanceId)
  }

  return chosen
}
