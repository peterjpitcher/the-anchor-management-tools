export function isCommunicationBodyMediaCaptureEnabled(): boolean {
  return process.env.COMMUNICATION_CAPTURE_BODY_MEDIA_ENABLED === 'true'
}
