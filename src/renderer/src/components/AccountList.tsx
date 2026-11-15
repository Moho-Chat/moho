import { useState } from 'react'
import { Icon, ServiceMark } from './Icon'
import { xmppStateWords } from './XmppAccountTools'
import { useMediaUrl } from '../lib/route'
import { classes, serviceIcon, serviceLabel } from '../lib/util'
import { ircNetworkFor } from '../lib/networks'
import type { Account } from '../../../shared/wire'

/**
 * The parts Settings → Accounts and the "+" pane share (#339).
 *
 * Both are the same question asked for a different reason - which account? -
 * followed by a page about the one chosen. So both are drawn from the same
 * list of accounts beside the same kind of page, and what is learned in one
 * is already known in the other.
 */

/** How an account is doing, as one of four colours and a few words. */
export type AccountTone = 'ok' | 'busy' | 'bad' | 'off'

export function accountState(account: Account): { tone: AccountTone; words: string } {
  switch (account.state) {
    case 'connected':
      return { tone: 'ok', words: 'Connected' }
    case 'connecting':
      return { tone: 'busy', words: 'Connecting…' }
    case 'auth_failed': {
      // XMPP says what stopped it; the rest only know that the sign-in was refused.
      const why = account.service === 'xmpp' ? xmppStateWords(account) : 'sign-in refused'
      return { tone: 'bad', words: why.charAt(0).toUpperCase() + why.slice(1) }
    }
    case 'error':
      return { tone: 'bad', words: 'Not working' }
    default:
      return { tone: 'off', words: 'Offline' }
  }
}

/**
 * Where an account is, as distinct from who it is: the network, homeserver or
 * domain for the services that have one, and nothing for the ones that are a
 * single place - their service's name already says it.
 *
 * This is what tells three IRC accounts called "salastil" apart.
 */
export function accountPlace(account: Account): string {
  const id = account.id
  switch (account.service) {
    case 'irc': {
      const host = id.includes('@') ? id.slice(id.lastIndexOf('@') + 1) : ''
      return ircNetworkFor(host)?.name ?? host
    }
    case 'matrix': {
      // "@name:server", with or without something in front of it.
      const at = id.indexOf('@')
      const colon = id.indexOf(':', at < 0 ? 0 : at)
      return at >= 0 && colon > at ? id.slice(colon + 1) : ''
    }
    case 'xmpp':
    case 'jabber':
      return id.includes('@') ? id.slice(id.lastIndexOf('@') + 1).split('/')[0] : ''
    default:
      return ''
  }
}

/** "IRC · Libera.Chat", or just "Discord". */
export function accountWhere(account: Account, serviceName = serviceLabel(account.service)): string {
  const place = accountPlace(account)
  return place ? `${serviceName} · ${place}` : serviceName
}

/**
 * An account's face: its picture with its service's mark on the corner, or
 * the mark alone on a tile where the service gave no picture.
 */
export function AccountFace({ account, size = 32 }: { account: Account; size?: number }): JSX.Element {
  const media = useMediaUrl(account.id)
  const icon = serviceIcon(account.service)
  return (
    <span className="account-face" style={{ width: size, height: size }}>
      {account.avatarUrl ? (
        <>
          <img className="account-face-picture" src={media(account.avatarUrl)} alt="" />
          <span className="account-face-badge">
            <ServiceMark icon={icon} size={Math.round(size * 0.34)} />
          </span>
        </>
      ) : (
        <span className="account-face-mark">
          <ServiceMark icon={icon} size={Math.round(size * 0.56)} />
        </span>
      )}
    </span>
  )
}

/** The state in words, coloured: a dot and what it means. */
export function StatePill({ account }: { account: Account }): JSX.Element {
  const state = accountState(account)
  return (
    <span className={`state-pill tone-${state.tone}`}>
      <span className="state-pill-dot" aria-hidden="true" />
      {state.words}
    </span>
  )
}

/** How many accounts it takes before a filter is worth its row. */
const FILTER_FROM = 9

/**
 * Every account, one row each: who, where, and how it is doing.
 *
 * Not folded by service. A row is short enough that fifteen fit in a window,
 * and the service's mark down the left edge groups them without a heading
 * that has to be opened first.
 */
export function AccountList({
  accounts,
  selected,
  onSelect,
  nameFor,
  label,
  children
}: {
  accounts: Account[]
  /** The account whose page is showing, if one is. */
  selected: string | null
  onSelect: (id: string) => void
  nameFor?: (service: string) => string
  /** What the list is for, said to a screen reader. */
  label: string
  /** What sits under the list: the way to add another. */
  children?: React.ReactNode
}): JSX.Element {
  const [filter, setFilter] = useState('')
  const q = filter.trim().toLowerCase()
  const name = nameFor ?? serviceLabel
  const shown = q
    ? accounts.filter((a) =>
        `${a.displayName} ${a.id} ${name(a.service)} ${accountPlace(a)}`.toLowerCase().includes(q)
      )
    : accounts
  const troubled = accounts.filter((a) => accountState(a).tone === 'bad').length

  return (
    <div className="account-list">
      {accounts.length >= FILTER_FROM && (
        <label className="account-list-filter">
          <Icon name="search" size={16} />
          <input
            placeholder="Filter accounts"
            value={filter}
            spellCheck={false}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && filter) {
                e.stopPropagation()
                setFilter('')
              }
              // Enter takes the only one left, which is what typing a name to one match means.
              if (e.key === 'Enter' && shown.length === 1) onSelect(shown[0].id)
            }}
          />
          {filter && (
            <button type="button" className="icon-button" title="Clear" onClick={() => setFilter('')}>
              <Icon name="close" size={14} />
            </button>
          )}
        </label>
      )}
      <div className="account-list-rows" role="listbox" aria-label={label}>
        {shown.map((a) => {
          const state = accountState(a)
          return (
            <button
              key={a.id}
              type="button"
              role="option"
              aria-selected={a.id === selected}
              data-account-id={a.id}
              className={classes('account-row', a.id === selected && 'active', `tone-${state.tone}`)}
              onClick={() => onSelect(a.id)}
            >
              <AccountFace account={a} />
              <span className="account-row-text">
                <span className="account-row-name ellipsis">{a.displayName || a.id}</span>
                <span className="account-row-where ellipsis">
                  {/* Only what is not as it should be is said in words: a column of "Connected" is noise. */}
                  {state.tone === 'ok' ? (
                    accountWhere(a, name(a.service))
                  ) : (
                    <>
                      <span className="account-row-state">{state.words}</span>
                      {' · '}
                      {accountWhere(a, name(a.service))}
                    </>
                  )}
                </span>
              </span>
              <span className="account-row-dot" title={state.words} />
            </button>
          )
        })}
        {shown.length === 0 && <p className="account-list-none small muted">No account matches “{filter.trim()}”.</p>}
      </div>
      <div className="account-list-foot">
        {children}
        {accounts.length > 1 && (
          <span className="account-list-count small muted">
            {accounts.length} accounts
            {troubled > 0 && <span className="tone-bad"> · {troubled} need{troubled === 1 ? 's' : ''} a look</span>}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * The list on the left and the chosen thing's page on the right.
 *
 * In a narrow window the two are steps instead: the list, then - once
 * something is chosen - its page with a way back. Which of the two is showing
 * is the stylesheet's to decide from the pane's own width, so `chosen` only
 * says whether a choice has been made by hand.
 */
export function MasterDetail({
  list,
  chosen,
  onBack,
  backLabel,
  pageKey,
  children
}: {
  list: React.ReactNode
  /** Whether somebody picked what is on the right, rather than it being the default. */
  chosen: boolean
  onBack: () => void
  backLabel: string
  /** Changes when the page on the right becomes a different page, so it arrives rather than swaps. */
  pageKey: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className={classes('master-detail', chosen && 'chosen')}>
      <div className="master-detail-list">{list}</div>
      <div className="master-detail-page">
        <button type="button" className="master-detail-back" onClick={onBack}>
          <Icon name="arrow_back" size={18} />
          {backLabel}
        </button>
        <div key={pageKey} className="master-detail-body">
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * A page's tabs. Each names a part of the page; the page shows one.
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label
}: {
  tabs: { id: T; label: string; icon?: string; badge?: boolean }[]
  value: T
  onChange: (id: T) => void
  label: string
}): JSX.Element {
  return (
    <div
      className="tabs"
      role="tablist"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        const at = tabs.findIndex((t) => t.id === value)
        const next = tabs[(at + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
        onChange(next.id)
        const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')
        buttons[tabs.indexOf(next)]?.focus()
      }}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1}
          data-tab={t.id}
          className={classes('tabs-tab', t.id === value && 'active')}
          onClick={() => onChange(t.id)}
        >
          {t.icon && <Icon name={t.icon} size={16} />}
          {t.label}
          {t.badge && <span className="tabs-badge" aria-label="needs a look" />}
        </button>
      ))}
    </div>
  )
}

/**
 * A view of Settings → Accounts asked for from somewhere else: the "+" pane's
 * "Add an account", an account's own settings from its row there.
 *
 * Left for the pane to pick up when it opens, since it is not on screen to be
 * told at the moment of asking.
 */
let wanted: { add: true } | { accountId: string } | null = null

export function askAccountsFor(view: { add: true } | { accountId: string }): void {
  wanted = view
}

export function takeAccountsAsk(): { add: true } | { accountId: string } | null {
  const view = wanted
  wanted = null
  return view
}
