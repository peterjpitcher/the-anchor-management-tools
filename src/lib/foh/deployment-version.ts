export const LOCAL_DEPLOYMENT_VERSION = 'development'

export function getDeploymentVersion(): string {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    LOCAL_DEPLOYMENT_VERSION
  )
}

export function hasDeploymentChanged(currentVersion: string, latestVersion: string): boolean {
  if (!currentVersion || !latestVersion) return false
  if (currentVersion === LOCAL_DEPLOYMENT_VERSION || latestVersion === LOCAL_DEPLOYMENT_VERSION) return false
  return currentVersion !== latestVersion
}

