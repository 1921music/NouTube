import { expect, test } from 'bun:test'

type Processor = {
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean
}

test('the bundled SoundTouch processor shifts a known tone across the full range and at different speeds', async () => {
  const sampleRate = 48_000
  const blockSize = 128
  const frequency = 440
  let SoundTouch: (new () => Processor) | undefined
  const globals = {
    sampleRate,
    AudioWorkletProcessor: class { port = { postMessage: () => undefined } },
    registerProcessor: (name: string, processor: new () => Processor) => {
      if (name === 'soundtouch-processor') SoundTouch = processor
    },
  }
  const originals = Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const)
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, value })
  try {
    await import(import.meta.resolve('@soundtouchjs/audio-worklet/processor'))
    if (!SoundTouch) throw new Error('SoundTouch did not register its processor')

    for (const rate of [0.75, 1, 1.5]) {
      for (let semitones = -12; semitones <= 12; semitones++) {
        const processor = new SoundTouch()
        const input = new Float32Array(blockSize)
        const left = new Float32Array(blockSize)
        const right = new Float32Array(blockSize)
        const params = { pitch: Float32Array.of(1), pitchSemitones: Float32Array.of(semitones), playbackRate: Float32Array.of(rate) }
        const crossings: number[] = []
        let samples = 0
        let energy = 0
        let last = 0
        for (let frame = 0; frame < sampleRate * 1.25; frame += blockSize) {
          for (let i = 0; i < blockSize; i++) input[i] = Math.sin((frame + i) * 2 * Math.PI * frequency * rate / sampleRate)
          processor.process([[input, input]], [[left, right]], params)
          if (frame < sampleRate / 3) continue
          for (const value of left) {
            energy += value * value
            if (last < 0 && value >= 0) crossings.push(samples - 1 - last / (value - last))
            samples++
            last = value
          }
        }
        const periods = crossings.slice(1).map((crossing, index) => crossing - crossings[index]!).sort((a, b) => a - b)
        const measured = sampleRate / periods[Math.floor(periods.length / 2)]!
        const expected = frequency * 2 ** (semitones / 12)
        const label = `${semitones} semitones at ${rate}×`
        expect(Math.abs(measured / expected - 1), label).toBeLessThan(0.025)
        expect(Math.sqrt(energy / samples), label).toBeGreaterThan(0.45)
      }
    }
  } finally {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
}, 20_000)
