// The community screen: the feed of people you follow, and the people tab (search, follow
// requests, who you follow and who follows you). A profile without an @ picks one first.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { fmtDate, fmtVol } from '../lib/format.js'
import {
  communityMe, communityFeed, searchPeople, setHandle, answerRequest, removeFollower,
  handleLooksValid, normalizeHandle, entryName, setLine, isWarmup
} from '../lib/community.js'
import Icon from '../components/Icon.jsx'
import { Button, Segmented, SearchField, TextField, Section, Row } from '../components/ui.jsx'

const toast = m => useUI.getState().toast(m)
const failed = () => toast(t('Couldn’t reach the server. Try again.'))

/** Choosing (or changing) the @. `onDone(handle)` once the server has taken it. */
export function HandlePicker({ onDone, onLater, current }) {
  const [v, setV] = useState(current || '')
  const [busy, setBusy] = useState(false)
  const ok = handleLooksValid(v)
  const save = async () => {
    if (!ok || busy) return
    setBusy(true)
    try {
      const r = await setHandle(normalizeHandle(v))
      useStore.setState(s => ({ user: s.user ? { ...s.user, handle: r.handle } : s.user }))
      onDone?.(r.handle)
    } catch (e) {
      const code = e?.data?.code
      if (code === 'handle-taken') toast(t('That @ is already taken.'))
      else if (code === 'handle-invalid') toast(t('That @ can’t be used. Use 3 to 20 letters, numbers, dots or underscores.'))
      else failed()
    } finally { setBusy(false) }
  }
  return <div className="card">
    <h3 style={{ marginTop: 0 }}>{t('Choose your @')}</h3>
    <p className="muted small">{t('Your @ is how people find and follow you: 3 to 20 letters, numbers, dots or underscores.')}</p>
    <TextField value={v} onChange={e => setV(e.target.value)} placeholder="@" autoCapitalize="none" autoCorrect="off" spellCheck={false}
      onKeyDown={e => { if (e.key === 'Enter') save() }} />
    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
      <Button variant="primary" disabled={!ok || busy} onClick={save}>{t('Save')}</Button>
      {onLater && <Button variant="ghost" onClick={onLater}>{t('Later')}</Button>}
    </div>
  </div>
}

/** One finished workout as a follower sees it. */
export function WorkoutCard({ w, unit, who }) {
  const nav = useNavigate()
  return <div className="card cm-workout">
    {who && <button type="button" className="cm-who" onClick={() => nav('/u/' + who.handle)}>
      <span className="cm-av">{(who.name || who.handle).slice(0, 1).toUpperCase()}</span>
      <span><b>{who.name}</b> <span className="muted">@{who.handle}</span></span>
    </button>}
    <div className="cm-head">
      <b>{w.name || t('Workout')}</b>
      <span className="muted small">{w.d ? fmtDate(w.d, true) : ''}</span>
    </div>
    <div className="muted small">{tn('{0} set', '{0} sets', w.sets)} · {t('Volume')} {fmtVol(w.volume, unit)}</div>
    {w.entries.map((e, i) => <div key={i} className="cm-ex">
      <div className="cm-exn">{entryName(e)}</div>
      {e.sets.map((s, j) => <div key={j} className={'cm-set' + (isWarmup(s) ? ' muted' : '')}>
        <span className="cm-n">{isWarmup(s) ? 'W' : j + 1 - e.sets.slice(0, j).filter(isWarmup).length}</span>{setLine(s, unit)}
      </div>)}
    </div>)}
  </div>
}

function Person({ p, children }) {
  const nav = useNavigate()
  return <Row title={p.name} subtitle={'@' + p.handle} onClick={() => nav('/u/' + p.handle)}>{children}</Row>
}

function Feed() {
  const [items, setItems] = useState(null)
  useEffect(() => { communityFeed().then(r => setItems(r.items), () => { setItems([]); failed() }) }, [])
  if (!items) return <p className="muted center">…</p>
  if (!items.length) return <p className="muted center" style={{ marginTop: 32 }}>{t('Nothing here yet. Follow people to see their workouts.')}</p>
  return items.map((i, k) => <WorkoutCard key={k} w={i.workout} unit={i.unit} who={i} />)
}

function People({ me, reload }) {
  const [q, setQ] = useState('')
  const [found, setFound] = useState(null)
  useEffect(() => {
    if (normalizeHandle(q).length < 2) { setFound(null); return }
    const id = setTimeout(() => searchPeople(q).then(r => setFound(r.results), failed), 250)
    return () => clearTimeout(id)
  }, [q])
  const act = fn => async (...a) => { try { await fn(...a); reload() } catch { failed() } }
  const answer = act(answerRequest)
  const remove = act(removeFollower)
  return <>
    <SearchField value={q} onChange={e => setQ(e.target.value)} onClear={() => setQ('')} placeholder={t('Search by @ or name')} />
    {found && <Section>
      {found.length ? found.map(p => <Person key={p.handle} p={p} />) : <p className="muted small" style={{ padding: 12 }}>{t('Nobody found.')}</p>}
    </Section>}
    {!!me.requests.length && <Section title={t('Follow requests')}>
      {me.requests.map(p => <Person key={p.handle} p={p}>
        <Button size="sm" variant="primary" onClick={e => { e.stopPropagation(); answer(p.handle, true) }}>{t('Accept')}</Button>
        <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); answer(p.handle, false) }}>{t('Decline')}</Button>
      </Person>)}
    </Section>}
    <Section title={t('Following') + ' · ' + me.following.length}>
      {me.following.map(p => <Person key={p.handle} p={p} />)}
      {me.pending.map(p => <Person key={p.handle} p={p}><span className="muted small">{t('Requested')}</span></Person>)}
    </Section>
    <Section title={t('Followers') + ' · ' + me.followers.length}>
      {me.followers.map(p => <Person key={p.handle} p={p}>
        <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); remove(p.handle) }}>{t('Remove follower')}</Button>
      </Person>)}
    </Section>
  </>
}

export default function Community() {
  const nav = useNavigate()
  const [me, setMe] = useState(null)
  const [tab, setTab] = useState('feed')
  const load = () => communityMe().then(setMe, failed)
  useEffect(() => { load() }, [])
  return <div className="narrow">
    <div className="hdr">
      <div><h1>{t('Community')}</h1>{me?.handle && <div className="sub">@{me.handle}</div>}</div>
      {me?.handle && <button className="iconbtn" onClick={() => nav('/u/' + me.handle)} aria-label={t('Your profile')}><Icon name="person" /></button>}
    </div>
    {!me ? <p className="muted center">…</p>
      : !me.handle ? <HandlePicker onDone={load} />
      : <>
        <Segmented options={[{ value: 'feed', label: t('Feed') }, { value: 'people', label: t('People') + (me.requests.length ? ` · ${me.requests.length}` : '') }]} value={tab} onChange={setTab} />
        <div style={{ height: 12 }} />
        {tab === 'feed' ? <Feed /> : <People me={me} reload={load} />}
      </>}
  </div>
}
