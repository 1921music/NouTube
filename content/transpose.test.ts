import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createTransposer, type TransposeState } from './transpose'
import { isTranspose } from '../lib/transpose'

class Video extends EventTarget {
  currentSrc = 'blob:https://m.youtube.com/media'
  mediaKeys = null
  crossOrigin = null
  playbackRate = 1
  preservesPitch = true
}

const destination = {}
const connections = new Set<object>()
let failRegistration = false
let finishRegistering: (() => void) | undefined
let registration: Promise<void> | undefined
let sources = 0

class Context {
  destination = destination
  audioWorklet = {
    addModule: () => failRegistration ? Promise.reject(new Error('test registration failure')) : registration ?? Promise.resolve(),
  }
  resume = () => Promise.resolve()
  createMediaElementSource() {
    sources++
    return {
      context: this,
      connect: (target: object) => {
        connections.add(target)
        return target
      },
      disconnect: (target: object) => connections.delete(target),
    }
  }
}

class Worklet extends EventTarget {
  static last: Worklet
  constructor() {
    super()
    Worklet.last = this
  }
  parameters = new Map([['pitchSemitones', { value: 0 }], ['playbackRate', { value: 1 }]])
  connect = () => undefined
  disconnect = () => undefined
}

const originals = new Map<string, PropertyDescriptor | undefined>()
beforeEach(() => {
  for (const [name, value] of Object.entries({ AudioContext: Context, AudioWorkletNode: Worklet, location: new URL('https://m.youtube.com') })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value })
  }
  connections.clear()
  sources = 0
  registration = undefined
  finishRegistering = undefined
  failRegistration = false
})

afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

function fixture() {
  const video = new Video() as unknown as HTMLVideoElement
  const published: TransposeState[] = []
  const transposer = createTransposer((state) => published.push(state))
  transposer.sync('first', video)
  return { video, published, transposer }
}

const settle = () => Bun.sleep(0)

describe('track transposition', () => {
  test('accepts all 25 integers and rejects invalid values', () => {
    for (let pitch = -12; pitch <= 12; pitch++) expect(isTranspose(pitch)).toBe(true)
    for (const invalid of [-13, 13, -0.5, NaN, Infinity, '-2', undefined]) expect(isTranspose(invalid)).toBe(false)
  })

  test('uses one source, tracks speed, restores the dry route on the next song', async () => {
    const { video, published, transposer } = fixture()
    for (let pitch = -12; pitch <= 12; pitch++) {
      transposer.set('first', pitch)
      await settle()
      expect(published.at(-1)?.semitones).toBe(pitch)
      expect(video.preservesPitch).toBe(pitch === 0)
    }
    expect(sources).toBe(1)
    video.playbackRate = 1.5
    video.dispatchEvent(new Event('ratechange'))
    expect(Worklet.last.parameters.get('playbackRate')?.value).toBe(1.5)
    video.dispatchEvent(new Event('seeking'))
    video.dispatchEvent(new Event('pause'))
    transposer.sync('first', video)
    expect(published.at(-1)?.semitones).toBe(12)
    transposer.sync('second', video)
    transposer.set('first', -12)
    expect(published.at(-1)).toEqual({ videoId: 'second', semitones: 0 })
    expect(video.preservesPitch).toBe(true)
    expect([...connections]).toEqual([destination])
  })

  test('invalidates pending requests when the track changes', async () => {
    registration = new Promise<void>((resolve) => { finishRegistering = resolve })
    const { video, published, transposer } = fixture()
    transposer.set('first', -12)
    transposer.sync('second', video)
    finishRegistering?.()
    await settle()
    expect(sources).toBe(0)
    expect(published.at(-1)).toEqual({ videoId: 'second', semitones: 0 })
  })

  test('preserves the selection when the same track gets a new video element', async () => {
    const { published, transposer } = fixture()
    transposer.set('first', -4)
    await settle()
    transposer.detach()
    transposer.sync('first', new Video() as unknown as HTMLVideoElement)
    await settle()
    expect(sources).toBe(2)
    expect(published.at(-1)).toEqual({ videoId: 'first', semitones: -4 })
  })

  test('does not bind the media element at zero or for an inaccessible origin', async () => {
    const { published, transposer } = fixture()
    transposer.set('first', 0)
    expect(sources).toBe(0)
    const remote = new Video()
    remote.currentSrc = 'https://example.net/media'
    transposer.sync('second', remote as unknown as HTMLVideoElement)
    transposer.set('second', -2)
    await settle()
    expect(sources).toBe(0)
    expect(published.at(-1)).toEqual({ videoId: 'second', semitones: 0, unavailable: true })
  })

  test('module load failure leaves normal HTML audio untouched', async () => {
    failRegistration = true
    const { video, published, transposer } = fixture()
    transposer.set('first', 12)
    await settle()
    expect(sources).toBe(0)
    expect(video.preservesPitch).toBe(true)
    expect(published.at(-1)).toEqual({ videoId: 'first', semitones: 0, unavailable: true })
  })

  test('processor errors restore the dry route', async () => {
    const { video, published, transposer } = fixture()
    transposer.set('first', 12)
    await settle()
    Worklet.last.dispatchEvent(new Event('processorerror'))
    expect([...connections]).toEqual([destination])
    expect(video.preservesPitch).toBe(true)
    expect(published.at(-1)).toEqual({ videoId: 'first', semitones: 0, unavailable: true })
  })
})
