import { useState, useEffect, useRef } from 'react'
import { API_BASE_URL } from '../config.js'

export default function ProfileSettings() {
  const menuRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState('profile')
  const [users, setUsers] = useState([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [message, setMessage] = useState('')
  const [createForm, setCreateForm] = useState({ username: '', email: '', role: 'officer', send_email: true })
  const [userPage, setUserPage] = useState(1)
  const [userSearch, setUserSearch] = useState('')
  const [totalUserPages, setTotalUserPages] = useState(1)

  const storedUser = (() => {
    try {
      return JSON.parse(localStorage.getItem('MARGDARSHAK_USER') || '{}')
    } catch {
      return {}
    }
  })()
  const userName = storedUser?.display_name || storedUser?.username || storedUser?.email?.split('@')?.[0] || 'City Operator'
  const userEmail = storedUser?.email || 'ops@margdarshak.city'
  const userRole = storedUser?.role || 'officer'
  const isAdmin = userRole === 'admin'
  const initials = userName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join('') || 'CO'

  const [form, setForm] = useState({
    apiBaseUrl: localStorage.getItem('MARGDARSHAK_API_BASE_URL') || API_BASE_URL,
    groqApiKey: localStorage.getItem('MARGDARSHAK_GROQ_API_KEY') || '',
    twitterApiKey: localStorage.getItem('MARGDARSHAK_TWITTER_API_KEY') || '',
  })

  useEffect(() => {
    let cancelled = false

    const syncSessionUser = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/me`, { credentials: 'include' })
        const data = await response.json().catch(() => ({}))
        if (!cancelled && response.ok && data?.user) {
          localStorage.setItem('MARGDARSHAK_USER', JSON.stringify(data.user))
        }
      } catch {
        // Keep the last known profile snapshot when the backend is temporarily unavailable.
      }
    }

    void syncSessionUser()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const onPointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) {
        setOpen(false)
        setPanel('profile')
        setMessage('')
      }
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false)
        setPanel('profile')
        setMessage('')
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    if (!isAdmin || panel !== 'users') return

    let cancelled = false
    const loadUsers = async () => {
      setLoadingUsers(true)
      try {
        const queryParams = new URLSearchParams({
          page: userPage,
          search: userSearch
        })
        const response = await fetch(`${API_BASE_URL}/admin/users?${queryParams}`, { credentials: 'include' })
        const data = await response.json().catch(() => ({}))
        if (!cancelled) {
          if (!response.ok) throw new Error(data.detail || 'Failed to load users')
          setUsers(data.users || [])
          setTotalUserPages(data.total_pages || 1)
        }
      } catch (error) {
        if (!cancelled) setMessage(error.message || 'Failed to load users')
      } finally {
        if (!cancelled) setLoadingUsers(false)
      }
    }

    void loadUsers()
    return () => { cancelled = true }
  }, [open, isAdmin, panel, userPage, userSearch])

  const deleteUser = async (userId) => {
    setMessage('')
    try {
      const response = await fetch(`${API_BASE_URL}/admin/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.detail || 'Failed to delete user')
      setMessage('User deleted successfully')
      setUsers(prev => prev.filter(u => u.id !== userId))
    } catch (error) {
      setMessage(error.message || 'Failed to delete user')
    }
  }

  const saveSettings = () => {
    localStorage.setItem('MARGDARSHAK_API_BASE_URL', form.apiBaseUrl.trim())
    localStorage.setItem('MARGDARSHAK_GROQ_API_KEY', form.groqApiKey.trim())
    localStorage.setItem('MARGDARSHAK_TWITTER_API_KEY', form.twitterApiKey.trim())
    setOpen(false)
    setPanel('profile')
    window.location.reload()
  }

  const createUser = async (event) => {
    event.preventDefault()
    setMessage('')
    try {
      const response = await fetch(`${API_BASE_URL}/admin/users`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: createForm.username.trim(),
          email: createForm.email.trim(),
          role: createForm.role,
          send_email: createForm.send_email,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.detail || 'Failed to create user')
      setMessage(`Created ${data.user.username}. Temporary password: ${data.user.temporary_password}`)
      setCreateForm({ username: '', email: '', role: 'officer', send_email: true })
      setPanel('users')
      setUsers((previous) => [data.user, ...previous.filter((entry) => entry.id !== data.user.id)])
    } catch (error) {
      setMessage(error.message || 'Failed to create user')
    }
  }

  const profileSummary = (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
      <div className="font-semibold text-slate-900">{userName}</div>
      <div>{userEmail}</div>
      <div className="mt-1 uppercase tracking-wide text-slate-500">Role: {userRole}</div>
    </div>
  )

  const logout = async () => {
    try {
      await fetch(`${API_BASE_URL}/logout`, { method: 'POST', credentials: 'include' })
    } catch {}
    localStorage.removeItem('MARGDARSHAK_USER')
    setOpen(false)
    setPanel('profile')
    window.location.href = '/'
  }

  return (
    <div className="profile-wrap relative z-[9999]" ref={menuRef}>
      <button
        className="avatar-button relative flex h-10 w-10 items-center justify-center rounded-full border border-sky-200 bg-gradient-to-br from-white to-sky-50 text-[12px] font-bold text-sky-900 shadow-sm transition-transform duration-150 hover:-translate-y-0.5 active:scale-95"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => {
          setOpen(v => !v)
          setPanel('profile')
          setMessage('')
        }}
        aria-label="Open profile menu"
      >
        <span className="avatar-online" />
        <span>{initials}</span>
      </button>
      {open && (
        <div className="avatar-dropdown absolute right-0 mt-2 w-72 origin-top-right rounded-lg border border-gray-200 bg-white p-3 shadow-lg z-[9999] animate-dropdown-in" onMouseDown={(event) => event.stopPropagation()}>
          <div className="dropdown-profile rounded-md border border-gray-200 bg-white p-3 mb-3">
            <div className="dropdown-profile-name text-sm font-semibold text-slate-900">{userName}</div>
            <div className="dropdown-profile-email text-xs text-slate-500">{userEmail}</div>
            <div className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              {userRole}
            </div>
          </div>

          {panel === 'profile' && (
            <div className="space-y-3">
              {profileSummary}
              
              {isAdmin && (
                <button
                  type="button"
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-center text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={() => setPanel('users')}
                >
                  Manage Users
                </button>
              )}

              <div className="border-t border-slate-100 pt-2">
                <button
                  type="button"
                  className="w-full rounded-md bg-red-50 hover:bg-red-100 px-3 py-2 text-center text-sm font-bold text-red-600 transition-colors duration-150"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={logout}
                >
                  Log Out
                </button>
              </div>
            </div>
          )}

          {panel === 'users' && isAdmin && (
            <div className="mt-2 space-y-3">
              <form className="space-y-2 rounded-lg border border-slate-200 bg-white p-3" onSubmit={createUser}>
                <div className="text-sm font-semibold text-slate-900">Create account</div>
                <input
                  className="settings-input"
                  value={createForm.username}
                  onChange={(event) => setCreateForm((previous) => ({ ...previous, username: event.target.value }))}
                  placeholder="username"
                />
                <input
                  className="settings-input"
                  value={createForm.email}
                  onChange={(event) => setCreateForm((previous) => ({ ...previous, email: event.target.value }))}
                  placeholder="email@example.com"
                  type="email"
                />
                <select
                  className="settings-input"
                  value={createForm.role}
                  onChange={(event) => setCreateForm((previous) => ({ ...previous, role: event.target.value }))}
                >
                  <option value="officer">Officer</option>
                  <option value="admin">Admin</option>
                </select>
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={createForm.send_email}
                    onChange={(event) => setCreateForm((previous) => ({ ...previous, send_email: event.target.checked }))}
                  />
                  Email temporary password
                </label>
                <button type="submit" className="settings-save">Create user</button>
              </form>

              {message && <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{message}</div>}

              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-sm font-semibold text-slate-900 mb-2">Users</div>
                <input
                  className="settings-input mb-3"
                  value={userSearch}
                  onChange={(event) => {
                    setUserSearch(event.target.value)
                    setUserPage(1)
                  }}
                  placeholder="Search users..."
                />
                <div className="space-y-2 text-xs text-slate-600">
                  {loadingUsers ? (
                    <div>Loading users...</div>
                  ) : users.length === 0 ? (
                    <div>No users found.</div>
                  ) : (
                    users.map((user) => (
                      <div key={user.id} className="flex items-center justify-between rounded-md bg-slate-50 px-2 py-2">
                        <div>
                          <div className="font-semibold text-slate-900">{user.username}</div>
                          <div className="text-[10px] text-slate-500">{user.email || 'No email set'}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            Role: <span className="font-bold">{user.role}</span> | Status: <span className={user.is_active ? 'text-emerald-600 font-bold' : 'text-slate-400 font-bold'}>{user.is_active ? 'Active' : 'Inactive'}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          style={{
                            padding: '2px 6px', background: '#fee2e2', color: '#b91c1c', border: 'none',
                            borderRadius: 4, fontSize: 10, fontWeight: 'bold', cursor: 'pointer'
                          }}
                          onClick={() => deleteUser(user.id)}
                        >
                          Delete
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {totalUserPages > 1 && (
                  <div className="flex justify-between items-center mt-3 px-1 text-[11px]">
                    <button
                      type="button"
                      disabled={userPage <= 1}
                      onClick={() => setUserPage(p => Math.max(1, p - 1))}
                      style={{ background: 'none', border: 'none', color: userPage <= 1 ? '#cbd5e1' : '#2563eb', cursor: 'pointer', fontWeight: 'bold' }}
                    >
                      &larr; Prev
                    </button>
                    <span className="text-slate-500">Page {userPage} of {totalUserPages}</span>
                    <button
                      type="button"
                      disabled={userPage >= totalUserPages}
                      onClick={() => setUserPage(p => Math.min(totalUserPages, p + 1))}
                      style={{ background: 'none', border: 'none', color: userPage >= totalUserPages ? '#cbd5e1' : '#2563eb', cursor: 'pointer', fontWeight: 'bold' }}
                    >
                      Next &rarr;
                    </button>
                  </div>
                )}

                <button type="button" className="mt-4 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={() => setPanel('profile')}>
                  Back
                </button>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
}
