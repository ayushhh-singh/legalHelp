import { Trans as I18nTrans } from 'react-i18next'

type TransProps = React.ComponentProps<typeof I18nTrans>

/**
 * Re-export of react-i18next's <Trans/> so application code has a single import
 * surface for i18n and we can add defaults here later without touching callers.
 */
export function Trans(props: TransProps) {
  return <I18nTrans {...props} />
}
