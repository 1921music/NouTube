import { isTranspose } from '../lib/transpose'

export type TransposeState = { videoId: string; semitones: number; unavailable?: boolean }

type AudioRoute = {
  source: MediaElementAudioSourceNode
  worklet?: AudioWorkletNode
  preservesPitch: boolean
}

const processorUrl = '/__noutube/soundtouch-processor.js'

function canRoute(video: HTMLVideoElement) {
  if (!video.currentSrc || video.mediaKeys) return false
  const url = new URL(video.currentSrc)
  return url.origin === location.origin || video.crossOrigin !== null
}

export function createTransposer(publish: (state: TransposeState) => void) {
  const sources = new WeakMap<HTMLVideoElement, AudioRoute>()
  let context: AudioContext | undefined
  let registered: Promise<void> | undefined
  let videoId = ''
  let video: HTMLVideoElement | null = null
  let semitones = 0
  let revision = 0

  function bypass(element: HTMLVideoElement | null) {
    const route = element && sources.get(element)
    if (!route?.worklet || !element) return
    route.source.disconnect(route.worklet)
    route.worklet.disconnect()
    route.worklet = undefined
    element.preservesPitch = route.preservesPitch
    route.source.connect(route.source.context.destination)
  }

  function onRateChange() {
    if (!video) return
    const rate = sources.get(video)?.worklet?.parameters.get('playbackRate')
    if (rate) {
      video.preservesPitch = false
      rate.value = video.playbackRate
    }
  }

  function fail(element: HTMLVideoElement, error: unknown) {
    ++revision
    bypass(element)
    semitones = 0
    console.warn('NouTube transpose:', error)
    publish({ videoId, semitones, unavailable: true })
  }

  async function apply(element: HTMLVideoElement, value: number) {
    const pending = ++revision
    if (!value) {
      bypass(element)
      publish({ videoId, semitones })
      return
    }
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      if (!canRoute(element)) throw new Error('The media source is inaccessible to Web Audio')
      const audio = (context ??= new AudioContext())
      registered ??= audio.audioWorklet.addModule(processorUrl).catch((error) => {
        registered = undefined
        throw error
      })
      await Promise.race([
        Promise.all([registered, audio.resume()]),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('AudioWorklet startup timed out')), 4000)
        }),
      ])
      if (revision !== pending) return
      if (!canRoute(element)) throw new Error('The media source changed while starting AudioWorklet')
      let route = sources.get(element)
      let worklet = route?.worklet
      if (!worklet) {
        worklet = new AudioWorkletNode(audio, 'soundtouch-processor', { outputChannelCount: [2] })
        const captured = worklet
        worklet.addEventListener('processorerror', (error) => {
          if (video === element && sources.get(element)?.worklet === captured) fail(element, error)
        })
        if (!route) {
          const source = audio.createMediaElementSource(element)
          source.connect(audio.destination)
          route = { source, preservesPitch: element.preservesPitch }
          sources.set(element, route)
        }
        worklet.parameters.get('playbackRate')!.value = element.playbackRate
        worklet.parameters.get('pitchSemitones')!.value = value
        route.preservesPitch = element.preservesPitch
        route.source.connect(worklet).connect(audio.destination)
        route.worklet = worklet
        route.source.disconnect(audio.destination)
        element.preservesPitch = false
      } else {
        worklet.parameters.get('pitchSemitones')!.value = value
      }
      publish({ videoId, semitones })
    } catch (error) {
      if (revision === pending) fail(element, error)
    } finally {
      clearTimeout(timeout)
    }
  }

  function sync(nextId: string, element: HTMLVideoElement | null) {
    if (video === element && videoId === nextId) return
    ++revision
    bypass(video)
    video?.removeEventListener('ratechange', onRateChange)
    if (videoId !== nextId || !nextId) semitones = 0
    videoId = nextId
    video = element
    video?.addEventListener('ratechange', onRateChange)
    if (video && semitones) void apply(video, semitones)
    else publish({ videoId, semitones })
  }

  function set(expectedId: string, value: number) {
    if (!video || !videoId || expectedId !== videoId || !isTranspose(value)) return
    semitones = value
    void apply(video, value)
  }

  return { sync, set, detach: () => sync(videoId, null) }
}
