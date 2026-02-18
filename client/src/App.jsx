import { useState, useEffect, useCallback } from 'react'

// In dev, set VITE_API_BASE=http://localhost:5000 to call backend directly (avoids proxy 404)
const API_BASE = import.meta.env.VITE_API_BASE || ''
const API = `${API_BASE}/api`

const INITIAL_CALLS_VISIBLE = 5
const SHOW_MORE_STEP = 5
const CLEAR_HISTORY_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

function formatTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function formatDuration(seconds) {
  if (seconds == null) return '—'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s ? `${m}m ${s}s` : `${m}m`
}

export default function App() {
  const [calls, setCalls] = useState([])
  const [callsLoading, setCallsLoading] = useState(true)
  const [callsError, setCallsError] = useState(null)
  const [toNumber, setToNumber] = useState('')
  const [dialLoading, setDialLoading] = useState(false)
  const [dialMessage, setDialMessage] = useState({ text: '', error: false })
  const [incomingCall, setIncomingCall] = useState(null)
  const [incomingActionLoading, setIncomingActionLoading] = useState(false)
  const [callsVisibleCount, setCallsVisibleCount] = useState(INITIAL_CALLS_VISIBLE)

  const loadCalls = useCallback(async () => {
    setCallsLoading(true)
    setCallsError(null)
    try {
      const res = await fetch(`${API}/calls?limit=30`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCallsError(data.error || 'Failed to load calls')
        setCalls([])
        return
      }
      setCalls(data.calls || [])
    } catch (err) {
      setCallsError('Could not load calls. Is the server running?')
      setCalls([])
    } finally {
      setCallsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCalls()
  }, [loadCalls])

  // Clear call history every 5 min: reset visible count and refetch
  useEffect(() => {
    const t = setInterval(() => {
      setCallsVisibleCount(INITIAL_CALLS_VISIBLE)
      loadCalls()
    }, CLEAR_HISTORY_INTERVAL_MS)
    return () => clearInterval(t)
  }, [loadCalls])

  // Poll for incoming calls when no modal is shown
  useEffect(() => {
    if (incomingCall?.pending) return
    const t = setInterval(async () => {
      try {
        const res = await fetch(`${API}/incoming-call`)
        const data = await res.json().catch(() => ({}))
        if (data.pending && data.callSid) {
          setIncomingCall({ pending: true, callSid: data.callSid, from: data.from })
        }
      } catch (_) {}
    }, 2000)
    return () => clearInterval(t)
  }, [incomingCall?.pending])

  const handleAcceptCall = async () => {
    if (!incomingCall?.callSid) return
    setIncomingActionLoading(true)
    try {
      const res = await fetch(`${API}/call-accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callSid: incomingCall.callSid }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setIncomingCall(null)
        loadCalls()
      } else {
        setDialMessage({ text: data.error || 'Failed to accept', error: true })
      }
    } catch (err) {
      setDialMessage({ text: 'Network error', error: true })
    } finally {
      setIncomingActionLoading(false)
    }
  }

  const handleDeclineCall = async () => {
    if (!incomingCall?.callSid) return
    setIncomingActionLoading(true)
    try {
      const res = await fetch(`${API}/call-decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callSid: incomingCall.callSid }),
      })
      await res.json().catch(() => ({}))
      setIncomingCall(null)
      loadCalls()
    } catch (err) {
      setDialMessage({ text: 'Network error', error: true })
    } finally {
      setIncomingActionLoading(false)
    }
  }

  const handleDial = async (e) => {
    e.preventDefault()
    const to = toNumber.trim()
    if (!to) return
    setDialLoading(true)
    setDialMessage({ text: '', error: false })
    try {
      const res = await fetch(`${API}/call-out`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setDialMessage({ text: data.error || 'Failed to place call', error: true })
        return
      }
      setDialMessage({
        text: 'Call initiated. The other party will hear the Daewoo AI when they answer.',
        error: false,
      })
      setToNumber('')
      loadCalls()
    } catch (err) {
      setDialMessage({ text: 'Network error. Is the server running?', error: true })
    } finally {
      setDialLoading(false)
    }
  }

  return (
    <div className="layout">
      {incomingCall?.pending && (
        <div className="incoming-call-overlay" role="dialog" aria-labelledby="incoming-call-title">
          <div className="incoming-call-modal">
            <h2 id="incoming-call-title" className="incoming-call-title">Incoming call</h2>
            <p className="incoming-call-from">{incomingCall.from || 'Unknown'}</p>
            <div className="incoming-call-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleAcceptCall}
                disabled={incomingActionLoading}
              >
                Accept
              </button>
              <button
                type="button"
                className="btn btn-decline"
                onClick={handleDeclineCall}
                disabled={incomingActionLoading}
              >
                Decline
              </button>
            </div>
          </div>
        </div>
      )}

      <header>
        <h1>
          <span className="dot" aria-hidden />
          Daewoo Voice Agent
        </h1>
        <p className="subtitle">
          Incoming and outgoing calls — AI answers on your Twilio number
        </p>
      </header>

      <section aria-labelledby="dial-heading">
        <h2 id="dial-heading">
          <span className="icon" aria-hidden>📞</span>
          Place outbound call
        </h2>
        <form className="dial-form" onSubmit={handleDial} method="post" action="#">
          <label htmlFor="to-number">
            Phone number (E.164, e.g. +923001234567)
            <input
              id="to-number"
              type="tel"
              value={toNumber}
              onChange={(e) => setToNumber(e.target.value)}
              placeholder="+923001234567"
              required
              disabled={dialLoading}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={dialLoading}>
            {dialLoading ? 'Calling…' : 'Call'}
          </button>
        </form>
        {dialMessage.text && (
          <div
            className={`message ${dialMessage.error ? 'error' : 'success'}`}
            role="status"
          >
            {dialMessage.text}
          </div>
        )}
      </section>

      <section aria-labelledby="calls-heading">
        <h2 id="calls-heading">
          <span className="icon" aria-hidden>📋</span>
          Recent calls
        </h2>
        <div className="calls-toolbar">
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Incoming calls are answered by the AI. Outgoing calls connect the
            callee to the same AI flow.
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={loadCalls}
            disabled={callsLoading}
          >
            Refresh
          </button>
        </div>
        <div className="calls-history-box">
          <table className="calls-table">
            <thead>
              <tr>
                <th>Direction</th>
                <th>From</th>
                <th>To</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {callsLoading && (
                <tr>
                  <td colSpan={6} className="loading">
                    Loading…
                  </td>
                </tr>
              )}
              {!callsLoading && callsError && (
                <tr>
                  <td colSpan={6} className="empty">
                    {callsError}
                  </td>
                </tr>
              )}
              {!callsLoading && !callsError && calls.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">
                    No calls yet. Place an outbound call or wait for incoming
                    calls.
                  </td>
                </tr>
              )}
              {!callsLoading && !callsError && calls.length > 0 &&
                calls.slice(0, callsVisibleCount).map((c) => (
                  <tr key={c.sid}>
                    <td>
                      <span
                        className={`dir-badge ${
                          c.direction === 'inbound' ? 'dir-inbound' : 'dir-outbound'
                        }`}
                      >
                        {c.direction === 'inbound' ? 'Incoming' : 'Outgoing'}
                      </span>
                    </td>
                    <td className="cell-ellipsis" title={c.from || ''}>{c.from || '—'}</td>
                    <td className="cell-ellipsis" title={c.to || ''}>{c.to || '—'}</td>
                    <td className="status cell-ellipsis" title={c.status || ''}>{c.status || '—'}</td>
                    <td>{formatDuration(c.duration)}</td>
                    <td className="cell-time">{formatTime(c.startTime)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!callsLoading && !callsError && calls.length > callsVisibleCount && (
            <div className="calls-show-more-wrap">
              <button
                type="button"
                className="btn btn-secondary btn-show-more"
                onClick={() => setCallsVisibleCount((n) => Math.min(n + SHOW_MORE_STEP, calls.length))}
              >
                Show more ({calls.length - callsVisibleCount} more)
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
