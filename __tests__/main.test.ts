/**
 * Unit tests for the action's main functionality, src/main.ts
 */
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'

// Mocks should be declared before the module being tested is imported.
jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('node:fs', () => ({
  writeFileSync: jest.fn<(...args: unknown[]) => void>()
}))

// Mock gensvg to avoid heavy physics simulation in tests
const mockGensvg = jest
  .fn<(...args: unknown[]) => Promise<string>>()
  .mockResolvedValue('<svg>test</svg>' as never)
jest.unstable_mockModule('../src/gensvg.js', () => ({
  gensvg: mockGensvg
}))

const { run } = await import('../src/main.js')

describe('main.ts', () => {
  beforeEach(() => {
    core.getInput.mockImplementation((name: string) => {
      if (name === 'username') return 'testuser'
      return ''
    })
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('generates SVG and sets output', async () => {
    await run()

    expect(core.setOutput).toHaveBeenCalledWith('svg-path', 'gravity.svg')
  })

  it('uses custom output path', async () => {
    core.getInput.mockImplementation((name: string) => {
      if (name === 'username') return 'testuser'
      if (name === 'output-path') return 'custom.svg'
      return ''
    })

    await run()

    expect(core.setOutput).toHaveBeenCalledWith('svg-path', 'custom.svg')
  })

  it('uses text input when provided', async () => {
    core.getInput.mockImplementation((name: string) => {
      if (name === 'username') return 'testuser'
      if (name === 'text') return 'Custom Text'
      return ''
    })

    await run()

    expect(mockGensvg).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'testuser',
        text: 'Custom Text'
      })
    )
  })

  it('passes shape parameter to gensvg', async () => {
    core.getInput.mockImplementation((name: string) => {
      if (name === 'username') return 'testuser'
      if (name === 'shape') return 'square'
      return ''
    })

    await run()

    expect(mockGensvg).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'testuser',
        shape: 'square'
      })
    )
  })

  it('defaults shape to circle when not provided', async () => {
    core.getInput.mockImplementation((name: string) => {
      if (name === 'username') return 'testuser'
      return ''
    })

    await run()

    expect(mockGensvg).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'testuser',
        shape: 'circle'
      })
    )
  })

  it('falls back to username when text is empty', async () => {
    core.getInput.mockImplementation((name: string) => {
      if (name === 'username') return 'testuser'
      return ''
    })

    await run()

    expect(mockGensvg).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'testuser',
        text: 'testuser'
      })
    )
  })

  it('sets failed status on error', async () => {
    mockGensvg.mockRejectedValueOnce(new Error('Simulation failed'))

    await run()

    expect(core.setFailed).toHaveBeenCalledWith('Simulation failed')
  })
})
