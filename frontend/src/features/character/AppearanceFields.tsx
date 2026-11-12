import { ChoiceGroup } from '../../components/forms'
import type { Appearance, EyeColorId, HairColorId, HairStyleId, SkinToneId } from '../../domain/types'
import { EYE_COLORS, HAIR_COLORS, HAIR_STYLES, SKIN_TONES } from './sprites'

const entries = <K extends string, V>(record: Record<K, V>) => Object.entries(record) as [K, V][]

/** 髪型・髪色・肌色・目の色の選択。性別で分けず、すべての外見を選べる */
export function AppearanceFields({
  value,
  onChange,
  fields = ['hairStyle', 'hairColor', 'skinTone', 'eyeColor'],
}: {
  value: Appearance
  onChange: (next: Appearance) => void
  fields?: (keyof Appearance)[]
}) {
  const set = <K extends keyof Appearance>(key: K, v: Appearance[K]) => onChange({ ...value, [key]: v })

  return (
    <div className="space-y-5">
      {fields.includes('hairStyle') && (
        <ChoiceGroup<HairStyleId>
          legend="髪型"
          value={value.hairStyle}
          onChange={(v) => set('hairStyle', v)}
          options={entries(HAIR_STYLES).map(([id, style]) => ({ value: id, label: style.label }))}
        />
      )}
      {fields.includes('hairColor') && (
        <ChoiceGroup<HairColorId>
          legend="髪の色"
          value={value.hairColor}
          onChange={(v) => set('hairColor', v)}
          options={entries(HAIR_COLORS).map(([id, color]) => ({ value: id, label: color.label, swatch: color.H }))}
        />
      )}
      {fields.includes('skinTone') && (
        <ChoiceGroup<SkinToneId>
          legend="肌の色"
          columns={2}
          value={value.skinTone}
          onChange={(v) => set('skinTone', v)}
          options={entries(SKIN_TONES).map(([id, tone]) => ({ value: id, label: tone.label, swatch: tone.S }))}
        />
      )}
      {fields.includes('eyeColor') && (
        <ChoiceGroup<EyeColorId>
          legend="目の色"
          columns={2}
          value={value.eyeColor}
          onChange={(v) => set('eyeColor', v)}
          options={entries(EYE_COLORS).map(([id, eye]) => ({ value: id, label: eye.label, swatch: eye.E }))}
        />
      )}
    </div>
  )
}
