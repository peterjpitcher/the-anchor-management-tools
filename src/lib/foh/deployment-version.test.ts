import { describe, expect, it } from 'vitest'
import { hasDeploymentChanged } from './deployment-version'

describe('hasDeploymentChanged', () => {
  it('detects a new production deployment', () => {
    expect(hasDeploymentChanged('old-sha', 'new-sha')).toBe(true)
  })

  it('does not reload for the same deployment', () => {
    expect(hasDeploymentChanged('same-sha', 'same-sha')).toBe(false)
  })

  it('does not reload local development', () => {
    expect(hasDeploymentChanged('development', 'new-sha')).toBe(false)
  })
})
