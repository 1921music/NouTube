import { View } from 'react-native'
import { t } from 'i18next'
import { formatTranspose, maxTranspose, minTranspose } from '@/lib/transpose'
import { BaseCenterModal } from './BaseCenterModal'
import { NouButton } from '../button/NouButton'
import { NouText } from '../NouText'

const values = Array.from({ length: maxTranspose - minTranspose + 1 }, (_, index) => minTranspose + index)

export function TransposeModal({ semitones, onSelect, onClose }: {
  semitones: number
  onSelect: (value: number) => void
  onClose: () => void
}) {
  return (
    <BaseCenterModal onClose={onClose} containerClassName="w-[24rem] max-w-[88vw]">
      <View className="p-4">
        <NouText className="mb-3 text-center text-lg font-semibold">{t('transpose.title')}</NouText>
        <View className="flex-row flex-wrap justify-center gap-y-2">
          {values.map((value) => (
            <View key={value} style={{ width: '20%' }} className="px-0.5">
              <NouButton
                size="1"
                variant={value === semitones ? 'solid' : 'outline'}
                className="items-center justify-center px-0"
                onPress={() => onSelect(value)}
              >
                {formatTranspose(value)}
              </NouButton>
            </View>
          ))}
        </View>
      </View>
    </BaseCenterModal>
  )
}
