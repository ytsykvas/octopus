import type { UsageLimit } from '@core/usage.js'

/**
 * What each plan window is called, in the two lengths the app draws it at.
 *
 * Both tables here rather than one beside each surface, and both exhaustive by
 * their type: a window added to the allowlist in `core/usage.ts` fails to
 * compile until it has a name at **both** widths, rather than appearing under
 * its own key in one place and not at all in the other.
 *
 * Two names for one window is not the drift that keeps: the card has a column
 * to write `Current week (all models)` in and the sidebar has two hundred
 * pixels for the whole row. What must not differ is which windows exist, and
 * that is what these two records share.
 */
export const WINDOW_NAMES: Record<
  UsageLimit['key'],
  | 'usage.windowFiveHour'
  | 'usage.windowSevenDay'
  | 'usage.windowSevenDayOpus'
  | 'usage.windowSevenDaySonnet'
  | 'usage.windowSevenDayOauthApps'
  | 'usage.windowModelScoped'
> = {
  five_hour: 'usage.windowFiveHour',
  seven_day: 'usage.windowSevenDay',
  seven_day_opus: 'usage.windowSevenDayOpus',
  seven_day_sonnet: 'usage.windowSevenDaySonnet',
  seven_day_oauth_apps: 'usage.windowSevenDayOauthApps',
  model_scoped: 'usage.windowModelScoped'
}

/** The same windows, at the width the sidebar has for them. */
export const SHORT_WINDOW_NAMES: Record<
  UsageLimit['key'],
  | 'limits.windowFiveHour'
  | 'limits.windowSevenDay'
  | 'limits.windowSevenDayOpus'
  | 'limits.windowSevenDaySonnet'
  | 'limits.windowSevenDayOauthApps'
  | 'limits.windowModelScoped'
> = {
  five_hour: 'limits.windowFiveHour',
  seven_day: 'limits.windowSevenDay',
  seven_day_opus: 'limits.windowSevenDayOpus',
  seven_day_sonnet: 'limits.windowSevenDaySonnet',
  seven_day_oauth_apps: 'limits.windowSevenDayOauthApps',
  model_scoped: 'limits.windowModelScoped'
}
