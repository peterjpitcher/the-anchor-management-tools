// Gates new inbound body/media capture only. Existing SMS/WhatsApp bodies and
// outbound email bodies are still logged because customer communication history
// and fail-closed outbound audit depend on those records.
export function isCommunicationBodyMediaCaptureEnabled(): boolean {
  return process.env.COMMUNICATION_CAPTURE_BODY_MEDIA_ENABLED === 'true'
}
