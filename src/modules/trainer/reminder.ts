import { getSetting, setSetting, SETTING_KEYS } from '@/db'

/**
 * A local "remind me daily at HH:MM" toggle — best-effort, and that ceiling is
 * structural, not a shortcut. This app has no push server and no VAPID keys
 * (master context: zero paid services, no backend for user data), and
 * `src/app/pwa.tsx` registers a workbox-generated service worker with no
 * custom message handler to extend. So a reminder can only fire from
 * `Notification.requestPermission()` plus
 * `registration.showNotification(...)`, checked while a tab of this app
 * happens to be open — there is no mechanism here for a notification to
 * arrive while the reader has not opened Sahayak that day. `useDailyReminder`
 * is what calls this, on the `useNow` tick, so the check runs roughly once a
 * minute for as long as a tab stays open.
 *
 * `hour`/`minute` are in the DEVICE's local time, deliberately unlike the
 * streak's IST day — a reminder is "come back around when you usually study",
 * which is a fact about the reader's own clock, not a statutory day boundary.
 */

export interface ReminderSetting {
  enabled: boolean
  hour: number
  minute: number
  /** Local calendar day (device time) the reminder last fired, or null. */
  lastShownDate: string | null
}

export const DEFAULT_REMINDER_SETTING: ReminderSetting = {
  enabled: false,
  hour: 19,
  minute: 0,
  lastShownDate: null,
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** The device's own calendar day, `YYYY-MM-DD` — not IST, see the module note. */
export const localDay = (now: Date): string =>
  `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`

/**
 * Whether the reminder should fire right now. Pure, so the decision is tested
 * without a `Notification` global or a service worker in the room.
 */
export function shouldRemind(setting: ReminderSetting, now: Date): boolean {
  if (!setting.enabled) return false
  if (setting.lastShownDate === localDay(now)) return false
  const targetMinutes = setting.hour * 60 + setting.minute
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  return nowMinutes >= targetMinutes
}

export async function loadReminderSetting(): Promise<ReminderSetting> {
  const stored = await getSetting<Partial<ReminderSetting>>(SETTING_KEYS.learnReminder)
  return { ...DEFAULT_REMINDER_SETTING, ...stored }
}

export async function saveReminderSetting(patch: Partial<ReminderSetting>): Promise<ReminderSetting> {
  const next = { ...(await loadReminderSetting()), ...patch }
  await setSetting(SETTING_KEYS.learnReminder, next)
  return next
}

/** Whether the browser has already granted permission — never asks. */
export const hasNotificationPermission = (): boolean =>
  typeof Notification !== 'undefined' && Notification.permission === 'granted'

/**
 * Ask, from a reader's own click on the Settings toggle — never asked
 * automatically. Returns whether permission ended up granted.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

const REMINDER_TEXT = {
  en: { title: 'Time for today’s review', body: 'Your Rules Trainer cards are waiting.' },
  hi: { title: 'आज के पुनरीक्षण का समय', body: 'आपके नियम अभ्यास कार्ड प्रतीक्षा कर रहे हैं।' },
}

/**
 * The one impure step: if the reader's toggle, the time and the permission
 * all line up, show one local notification and record today as shown so it
 * fires at most once a day. Never throws — a blocked `Notification` global or
 * a service worker that never registered must not take a caller down.
 */
export async function checkAndShowReminder(now: Date, language: 'en' | 'hi' = 'en'): Promise<boolean> {
  try {
    const setting = await loadReminderSetting()
    if (!shouldRemind(setting, now)) return false
    if (!hasNotificationPermission()) return false
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false

    const registration = await navigator.serviceWorker.ready
    const copy = REMINDER_TEXT[language]
    await registration.showNotification(copy.title, { body: copy.body, tag: 'sahayak-daily-reminder' })
    await saveReminderSetting({ lastShownDate: localDay(now) })
    return true
  } catch {
    return false
  }
}
