import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Under Fluid compute one instance serves several requests at once. @sparticuz/chromium reports
// its path as soon as the file exists, even while it is still being written, so two cold renders
// must share one unpack rather than each starting their own. A failed unpack must not be cached.

const mocks = vi.hoisted(() => ({
  executablePath: vi.fn<() => Promise<string>>(),
  launch: vi.fn(),
}))

vi.mock('@sparticuz/chromium', () => ({
  default: { executablePath: mocks.executablePath, args: ['--headless=shell'] },
}))

vi.mock('puppeteer', () => ({
  default: { launch: mocks.launch, executablePath: () => '/local/chrome' },
}))

const originalPlatform = process.platform
const originalVercel = process.env.VERCEL

async function loadGenerator() {
  // A fresh module per test, so the cached unpack from one test never leaks into the next.
  vi.resetModules()
  return import('@/lib/pdf-generator')
}

describe('createPdfBrowser Chromium unpack on Vercel', () => {
  beforeEach(() => {
    mocks.executablePath.mockReset()
    mocks.launch.mockReset()
    mocks.launch.mockResolvedValue({ newPage: vi.fn(), close: vi.fn() })
    process.env.VERCEL = '1'
    Object.defineProperty(process, 'platform', { value: 'linux' })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    if (originalVercel === undefined) delete process.env.VERCEL
    else process.env.VERCEL = originalVercel
  })

  it('shares one unpack when a second render arrives while the first is still unpacking', async () => {
    const { createPdfBrowser } = await loadGenerator()

    const pendingUnpacks: Array<(path: string) => void> = []
    const finishUnpack = (path: string) => pendingUnpacks.forEach((resolve) => resolve(path))
    mocks.executablePath.mockImplementation(
      () => new Promise<string>((resolve) => { pendingUnpacks.push(resolve) })
    )

    // The second render starts once the first is mid-unpack, which is the production race. The
    // two are not started in the same tick because Vitest can resolve one of two simultaneous
    // dynamic imports of a mocked module to the real package and launch a real browser.
    const first = createPdfBrowser()
    await vi.waitFor(() => expect(mocks.executablePath).toHaveBeenCalledTimes(1))
    const second = createPdfBrowser()
    await new Promise((resolve) => setTimeout(resolve, 50))

    finishUnpack('/tmp/chromium')
    await Promise.all([first, second])

    expect(mocks.executablePath).toHaveBeenCalledTimes(1)
    expect(mocks.launch).toHaveBeenCalledTimes(2)
    expect(mocks.launch).toHaveBeenNthCalledWith(1, expect.objectContaining({ executablePath: '/tmp/chromium' }))
    expect(mocks.launch).toHaveBeenNthCalledWith(2, expect.objectContaining({ executablePath: '/tmp/chromium' }))
  })

  it('reuses a finished unpack for later renders', async () => {
    const { createPdfBrowser } = await loadGenerator()
    mocks.executablePath.mockResolvedValue('/tmp/chromium')

    await createPdfBrowser()
    await createPdfBrowser()

    expect(mocks.executablePath).toHaveBeenCalledTimes(1)
  })

  it('forgets a failed unpack so the next render retries and succeeds', async () => {
    const { createPdfBrowser } = await loadGenerator()
    mocks.executablePath
      .mockRejectedValueOnce(new Error('unpack failed'))
      .mockResolvedValueOnce('/tmp/chromium')

    await expect(createPdfBrowser()).rejects.toThrow('unpack failed')
    expect(mocks.launch).not.toHaveBeenCalled()

    await expect(createPdfBrowser()).resolves.toBeDefined()
    expect(mocks.executablePath).toHaveBeenCalledTimes(2)
    expect(mocks.launch).toHaveBeenCalledWith(expect.objectContaining({ executablePath: '/tmp/chromium' }))
  })

  it('does not unpack Chromium off Vercel', async () => {
    delete process.env.VERCEL
    const { createPdfBrowser } = await loadGenerator()

    await createPdfBrowser()

    expect(mocks.executablePath).not.toHaveBeenCalled()
    expect(mocks.launch).toHaveBeenCalledWith(expect.objectContaining({ executablePath: '/local/chrome' }))
  })
})
