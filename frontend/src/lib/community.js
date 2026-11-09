// The community (api/community.js): @handles, follow requests, and the workouts of people who
// approved you. The server decides what anyone may see; this file only asks and formats.
import { api } from './api.js'
import { EXIDX } from './exercises.js'
import { exerciseNameText, fmtNum } from './format.js'

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) })

export const communityMe = () => api('/api/community/me')
export const setHandle = handle => post('/api/community/handle', { handle })
export const searchPeople = q => api('/api/community/search?q=' + encodeURIComponent(q))
export const profileOf = handle => api('/api/community/profile?handle=' + encodeURIComponent(handle))
export const follow = handle => post('/api/community/follow', { handle })
export const unfollow = handle => post('/api/community/unfollow', { handle })
export const answerRequest = (handle, accept) => post('/api/community/requests/answer', { handle, accept })
export const removeFollower = handle => post('/api/community/followers/remove', { handle })
export const communityFeed = () => api('/api/community/feed')

// The same rule the server holds (api/community.js HANDLE), so the field says no before asking.
const HANDLE = /^[a-z0-9](?:[a-z0-9._]{1,18})[a-z0-9]$/
export const normalizeHandle = v => String(v || '').trim().replace(/^@/, '').toLowerCase()
export const handleLooksValid = v => { const h = normalizeHandle(v); return HANDLE.test(h) && !/[._]{2}/.test(h) }

/** An exercise's name: the app's own for catalogue ones, the owner's for theirs. */
export const entryName = e => e?.name || (EXIDX[e?.id] ? exerciseNameText(EXIDX[e.id]) : e?.id || '')

const one = (s, unit) => {
  if (!s) return ''
  const load = s.w != null && s.w !== 0 ? `${fmtNum(s.w)} ${unit}` : ''
  if (s.r != null) return load ? `${load} × ${fmtNum(s.r)}` : `× ${fmtNum(s.r)}`
  if (s.sec != null) return (load ? load + ' · ' : '') + `${fmtNum(s.sec)} s`
  if (s.dist != null) return `${fmtNum(s.dist)} m`
  return load
}
/** One set as a line: "80 kg × 8", "L 12 kg × 10 · R 12 kg × 10", "45 s". */
export function setLine(s, unit) {
  if (s?.sides) return `L ${one(s.sides.L, unit)} · R ${one(s.sides.R, unit)}`
  return one(s, unit)
}
export const isWarmup = s => s?.phase === 'warmup' || s?.kind === 'warmup'
