import { vi } from 'vitest';

export const mockGraphClient = {
  api: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  post: vi.fn().mockResolvedValue({ id: 'MSG_MOCK_ID' }),
  get: vi.fn().mockResolvedValue({ 
    displayName: 'Mock User', 
    mail: 'mock@example.com', 
    id: 'USER_MOCK_ID',
    userPrincipalName: 'mock@example.com'
  }),
};

export const resetGraphMock = () => {
  mockGraphClient.api.mockClear();
  mockGraphClient.select.mockClear();
  mockGraphClient.post.mockClear();
  mockGraphClient.get.mockClear();
};
