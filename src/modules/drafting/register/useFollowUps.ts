import { useLiveQuery } from 'dexie-react-hooks'

import { listEntries } from './registerStore'

import { dueFollowUps } from '@/lib/drafting/register'
import { istDay } from '@/lib/istDay'

/**
 * How many communications are waiting for something today, for the Register
 * sub-tab's badge.
 *
 * `Date.now()` is read INSIDE the querier, not during render: a component that
 * reads the clock while rendering is a component whose output depends on when
 * React happened to call it, which is what `react-hooks/purity` refuses. A
 * badge does not need the day to advance while the screen is open.
 *
 * It lives in the Drafting Studio's own (lazily loaded) module rather than in
 * the app shell, because a count computed in the shell is a count every reader
 * downloads the register, its zod schema and Dexie query for — including every
 * reader who never opens the section.
 */
export function useDueFollowUpCount(): number | undefined {
  return useLiveQuery(async () => dueFollowUps(await listEntries(), istDay(Date.now())).length, [], undefined)
}
