// Someone's profile in the community: their @, counts, the follow button, and their workouts once
// they approved you (or when it is your own). Nothing personal: the server never sends it.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { profileOf, follow, unfollow } from '../lib/community.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { WorkoutCard } from './Community.jsx'

const failed = () => useUI.getState().toast(t('Couldn’t reach the server. Try again.'))

export default function CommunityProfile() {
  const { handle } = useParams()
  const nav = useNavigate()
  const [p, setP] = useState(null)
  const [missing, setMissing] = useState(false)
  const load = () => profileOf(handle).then(setP, e => { if (e?.status === 404) setMissing(true); else failed() })
  useEffect(() => { setP(null); setMissing(false); load() }, [handle])
  const act = fn => async () => {
    try { await fn(handle); load() }
    catch (e) { if (e?.data?.code === 'no-handle') nav('/community'); else failed() }
  }
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="undo" /></button>
    </div>
    {missing ? <p className="muted center">{t('Nobody found.')}</p>
      : !p ? <p className="muted center">…</p>
      : <>
        <div className="card cm-profile">
          <span className="cm-av big">{(p.name || p.handle).slice(0, 1).toUpperCase()}</span>
          <div style={{ margin: '8px 0 0', fontSize: 22, fontWeight: 700 }}>{p.name}</div>
          <div className="muted">@{p.handle}{p.followsYou && p.relation !== 'self' ? ' · ' + t('Follows you') : ''}</div>
          <div className="cm-counts">
            <span><b>{p.followers}</b> {t('Followers')}</span>
            <span><b>{p.following}</b> {t('Following')}</span>
          </div>
          {p.relation === 'none' && <Button variant="primary" onClick={act(follow)}>{t('Follow')}</Button>}
          {p.relation === 'pending' && <Button variant="tinted" onClick={act(unfollow)}>{t('Requested')}</Button>}
          {p.relation === 'accepted' && <Button variant="ghost" onClick={act(unfollow)}>{t('Unfollow')}</Button>}
        </div>
        {p.workouts
          ? (p.workouts.length ? p.workouts.map(w => <WorkoutCard key={w.id} w={w} unit={p.unit} />) : <p className="muted center">{t('No workouts yet.')}</p>)
          : <div className="card center"><Icon name="lock" /><p className="muted">{t('Only followers this person approves can see their workouts.')}</p></div>}
      </>}
  </div>
}
