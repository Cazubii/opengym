// Asks a profile without an @ to pick one (the community), once per visit: "Later" hides it until
// the app is opened again.
import { useState } from 'react'
import { HandlePicker } from '../views/Community.jsx'

const KEY = 'gym_handle_later'
const later = () => { try { return sessionStorage.getItem(KEY) === '1' } catch { return false } }

export default function HandlePrompt() {
  const [gone, setGone] = useState(later)
  if (gone) return null
  const dismiss = () => { try { sessionStorage.setItem(KEY, '1') } catch { /* private mode */ } setGone(true) }
  return <div className="cm-prompt" role="dialog" aria-modal="true">
    <div className="cm-prompt-box"><HandlePicker onDone={() => setGone(true)} onLater={dismiss} /></div>
  </div>
}
