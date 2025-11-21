import { vi } from 'vitest';

export const mockTwilioClient = {
  messages: {
    create: vi.fn().mockResolvedValue({
      sid: 'SM_MOCK_SID',
      from: '+1234567890',
      status: 'queued',
      errorCode: null,
      errorMessage: null,
    }),
  },
};

export const resetTwilioMock = () => {
  mockTwilioClient.messages.create.mockClear();
};
