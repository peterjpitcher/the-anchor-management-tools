/**
 * One call of sendPolicyAcknowledgements sends to at most this many people, so it finishes well
 * inside the request limit. The policies page sends a long list in batches of this size.
 */
export const POLICY_BATCH_SIZE = 10
