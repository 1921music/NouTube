export const minTranspose = -12
export const maxTranspose = 12

export function isTranspose(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minTranspose && value <= maxTranspose
}

export function formatTranspose(semitones: number) {
  return semitones > 0 ? `+${semitones}` : String(semitones)
}
