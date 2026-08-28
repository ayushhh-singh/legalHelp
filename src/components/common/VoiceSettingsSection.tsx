import { Mic } from 'lucide-react'

import { useAppStore } from '@/app/store'
import { Badge, OptionRow } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import { isVoiceSupported } from '@/lib/voiceSettings'

/**
 * The off switch for voice search.
 *
 * There is nothing to consent to — speech is recognised on the device and never
 * sent anywhere (ADR-017) — so this is a preference, not a gate: some readers
 * would simply rather not have a microphone button in their search field.
 *
 * It shows the unsupported case rather than hiding the section, because "this
 * app has no voice search" and "your browser cannot do it locally" are
 * different facts and only one of them is about the app.
 */
export function VoiceSettingsSection() {
  const { t } = useT()
  const voice = useAppStore((s) => s.voice)
  const setVoice = useAppStore((s) => s.setVoice)

  const supported = isVoiceSupported()
  const on = voice.enabled

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Mic aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
          {t('voice.settings.title')}
          <Badge tone={on ? 'success' : 'neutral'}>
            {on ? t('voice.settings.on') : t('voice.settings.off')}
          </Badge>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('voice.settings.hint')}</p>
      </div>

      {supported ? (
        <div role="radiogroup" aria-label={t('voice.settings.title')} className="flex flex-col gap-2">
          <OptionRow
            selected={!on}
            label={t('voice.settings.off')}
            onSelect={() => void setVoice({ enabled: false })}
          />
          <OptionRow
            selected={on}
            label={t('voice.settings.on')}
            onSelect={() => void setVoice({ enabled: true })}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('voice.settings.unsupported')}</p>
      )}
    </section>
  )
}
