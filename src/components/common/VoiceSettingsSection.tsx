import { Mic } from 'lucide-react'

import { useAppStore } from '@/app/store'
import { Badge, OptionRow } from '@/components/ui-x'
import { useT } from '@/i18n/useT'
import { isVoiceEnabled, isVoiceSupported, VOICE_CONSENT_VERSION } from '@/lib/voiceConsent'

/**
 * The off switch for voice search.
 *
 * The microphone is turned ON from the search bar, where the notice is; this is
 * where it is turned off again, and where a reader who has never touched it can
 * see that it exists and is off. That split is deliberate: consent belongs next
 * to the action it enables, and a kill switch belongs somewhere findable.
 *
 * Turning it off keeps the recorded consent, so turning it back on does not
 * re-prompt — the same contract as the AI tier (ADR-011). Bumping
 * VOICE_CONSENT_VERSION is what re-prompts everybody.
 */
export function VoiceSettingsSection() {
  const { t } = useT()
  const voice = useAppStore((s) => s.voice)
  const setVoice = useAppStore((s) => s.setVoice)

  const supported = isVoiceSupported()
  const on = isVoiceEnabled(voice)

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Mic aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
          {t('voice.settings.title')}
          <Badge tone={on ? 'warning' : 'neutral'}>
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
            // Turning it on from here still requires consent on record; a
            // reader who has never read the notice is sent to it by the mic
            // button rather than being opted in from a settings row.
            disabled={voice.consentVersion !== VOICE_CONSENT_VERSION}
            hint={voice.consentVersion !== VOICE_CONSENT_VERSION ? t('voice.settings.read') : undefined}
            onSelect={() => void setVoice({ enabled: true })}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('voice.settings.unsupported')}</p>
      )}
    </section>
  )
}
