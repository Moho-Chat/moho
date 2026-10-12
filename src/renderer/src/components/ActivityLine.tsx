import { Icon } from './Icon'
import { activityIcon } from '../lib/activity'
import type { Activity } from '../../../shared/wire'

/**
 * What somebody is doing, as the small line under their name: a gamepad and a
 * game, a note and a track, or - with no picture at all - words they wrote
 * themselves, which is how Discord draws a custom status.
 */
export function ActivityLine({ activity }: { activity: Activity }): JSX.Element {
  const icon = activityIcon(activity)
  return (
    <span className="activity-line small muted">
      {icon && <Icon name={icon} size={13} />}
      <span className="ellipsis">{activity.text}</span>
    </span>
  )
}
