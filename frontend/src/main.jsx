import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowRight,
  Link2,
  Search,
  Copy,
  Check,
  Pencil,
  Trash2,
  LogOut,
  RefreshCw,
  X,
  Layers,
  MousePointer2,
  ExternalLink,
} from "lucide-react";
import { api, hasSession, setSession, logout } from "./api";
import "./style.css";

function App() {
  const [signedIn, setSignedIn] = useState(hasSession);
  const [mode, setMode] = useState("login");
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [modal, setModal] = useState(null);
  const [copied, setCopied] = useState(null);
  const request = useRef(0);
  const creator = useRef(null);
  const modalInput = useRef(null);
  useEffect(() => {
    const expired = () => {
      setSignedIn(false);
      setRows([]);
      setError("Your session expired. Please sign in again.");
    };
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!signedIn) return;
    const id = ++request.current;
    setLoading(true);
    api(`/urls?page=${page}&limit=8&search=${encodeURIComponent(query)}`)
      .then((result) => {
        if (id === request.current) {
          setRows(result.data);
          setPagination(result.pagination);
        }
      })
      .catch((e) => {
        if (id === request.current) setError(e.message);
      })
      .finally(() => {
        if (id === request.current) setLoading(false);
      });
    return () => {
      request.current++;
    };
  }, [signedIn, page, query, reload]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (modal) modalInput.current?.focus();
  }, [modal]);
  async function run(action) {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function authenticate(e) {
    e.preventDefault();
    const fields = Object.fromEntries(new FormData(e.currentTarget));
    run(async () => {
      if (mode === "register")
        await api("/auth/register", {
          method: "POST",
          body: JSON.stringify(fields),
        });
      const result = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify(fields),
      });
      setSession(result);
      setSignedIn(true);
      setPage(1);
      setSearch("");
      setQuery("");
    });
  }
  function create(e) {
    e.preventDefault();
    const form = e.currentTarget;
    run(async () => {
      await api("/urls", {
        method: "POST",
        body: JSON.stringify({ longUrl: form.longUrl.value.trim() }),
      });
      form.reset();
      setPage(1);
      setSearch("");
      setQuery("");
      setReload((n) => n + 1);
      setNotice("Your short link is ready to share.");
    });
  }
  async function copy(row) {
    try {
      await navigator.clipboard.writeText(row.shortUrl);
      setCopied(row.id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError(
        "Copy is unavailable here. Select and copy the short link manually.",
      );
    }
  }
  function saveModal(e) {
    e.preventDefault();
    const url = e.currentTarget.longUrl?.value.trim();
    run(async () => {
      await api(`/urls/${modal.row.id}`, {
        method: modal.type === "delete" ? "DELETE" : "PATCH",
        ...(url && { body: JSON.stringify({ longUrl: url }) }),
      });
      setNotice(
        modal.type === "delete" ? "Link deleted." : "Destination updated.",
      );
      setModal(null);
      if (modal.type === "delete" && rows.length === 1 && page > 1)
        setPage(page - 1);
      else setReload((n) => n + 1);
    });
  }
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  return (
    <div className="shell">
      <aside>
        <a className="brand" href="/">
          <span className="brand-icon">
            <Link2 size={23} />
          </span>
          shortly<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <button className="nav-active" onClick={() => creator.current?.focus()}>
          <Layers size={18} /> My links <span>↗</span>
        </button>
        <div className="sidebar-bottom">
          <div className="mini-icon">
            <Link2 size={20} />
          </div>
          <strong>
            A little link.
            <br />A lot of possibility.
          </strong>
          <p>
            Make every connection
            <br />a little simpler.
          </p>
          <a href="/api/docs" target="_blank" rel="noreferrer">
            Explore the API <ArrowUpRight size={15} />
          </a>
        </div>
        <div className="sidebar-footer">
          <span className="avatar">DS</span>
          <div>
            Personal workspace<small>URL shortener</small>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <span>
            Workspace <span className="slash">/</span> <strong>My links</strong>
          </span>
          <div className="header-right">
            <span className="project-badge">PERSONAL PROJECT</span>
            {signedIn && (
              <button
                className="icon-button"
                aria-label="Sign out"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await logout();
                    setSignedIn(false);
                    setRows([]);
                  })
                }
              >
                <LogOut size={18} />
              </button>
            )}
          </div>
        </header>
        <div className="content">
          <div className="heading">
            <div>
              <div className="eyebrow">SMALL LINKS. BIG POSSIBILITIES.</div>
              <h1>
                Your links, simplified<span>.</span>
              </h1>
              <p>Shorten, share, and keep track of what connects.</p>
            </div>
            <div className="heading-mark">
              <ArrowUpRight size={44} />
            </div>
          </div>
          {error && (
            <div role="alert" className="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="notice">
              <Check size={17} />
              {notice}
            </div>
          )}
          {!signedIn ? (
            <div className="welcome">
              <section className="auth-card">
                <span className="tag">YOUR WORKSPACE AWAITS</span>
                <h2>
                  {mode === "login"
                    ? "Welcome back."
                    : "Make room for better links."}
                </h2>
                <p>
                  {mode === "login"
                    ? "Sign in to create and manage your short links."
                    : "Create your free account to get started."}
                </p>
                <form onSubmit={authenticate}>
                  <label>
                    Email address
                    <input
                      name="email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      required
                      maxLength={254}
                    />
                  </label>
                  <label>
                    Password
                    <input
                      name="password"
                      type="password"
                      autoComplete={
                        mode === "login" ? "current-password" : "new-password"
                      }
                      placeholder="At least 8 characters"
                      required
                      minLength={8}
                      maxLength={72}
                    />
                  </label>
                  <button className="primary" disabled={busy}>
                    {busy
                      ? "Please wait…"
                      : mode === "login"
                        ? "Sign in"
                        : "Create account"}
                    <ArrowRight size={17} />
                  </button>
                </form>
                <p className="auth-switch">
                  {mode === "login" ? "New here?" : "Already have an account?"}{" "}
                  <button
                    disabled={busy}
                    onClick={() => {
                      setMode(mode === "login" ? "register" : "login");
                      setError("");
                    }}
                  >
                    {mode === "login" ? "Create an account" : "Sign in"}
                  </button>
                </p>
              </section>
              <section className="welcome-art">
                <span className="pill">LESS LENGTH. MORE IMPACT.</span>
                <div className="link-art">
                  <Link2 size={90} strokeWidth={1.2} />
                </div>
                <h2>
                  Good things come
                  <br />
                  in short links.
                </h2>
                <p>
                  One place for every link.
                  <br />A clearer path to wherever you're going.
                </p>
                <div className="art-footer">
                  <span>CREATE</span>
                  <span>SHARE</span>
                  <span>TRACK</span>
                </div>
              </section>
            </div>
          ) : (
            <>
              <section className="create-card">
                <div className="section-title">
                  <span className="square-icon">
                    <Link2 size={20} />
                  </span>
                  <div>
                    <h2>Create a short link</h2>
                    <p>A long URL goes in. Something simpler comes out.</p>
                  </div>
                </div>
                <form onSubmit={create}>
                  <label className="sr-only" htmlFor="longUrl">
                    Destination URL
                  </label>
                  <input
                    ref={creator}
                    id="longUrl"
                    name="longUrl"
                    type="url"
                    placeholder="Paste your long URL here, starting with https://"
                    required
                    maxLength={2048}
                  />
                  <button className="primary" disabled={busy}>
                    {busy ? "Working…" : "Shorten link"}
                    <ArrowRight size={17} />
                  </button>
                </form>
                <small>Use a public http:// or https:// destination.</small>
              </section>
              <div className="stats">
                <div>
                  <span>
                    <Link2 size={16} /> Matching links
                  </span>
                  <strong>{pagination.total.toLocaleString()}</strong>
                  <small>
                    {query
                      ? "For your current search"
                      : "Across your workspace"}
                  </small>
                </div>
                <div>
                  <span>
                    <MousePointer2 size={16} /> Clicks on this page
                  </span>
                  <strong>{clicks.toLocaleString()}</strong>
                  <small>Recorded redirects · best effort</small>
                </div>
                <div className="tip">
                  <span className="tip-icon">
                    <ArrowUpRight size={24} />
                  </span>
                  <h3>Ready to go places.</h3>
                  <p>Copy a link and share it anywhere.</p>
                </div>
              </div>
              <section className="links-section">
                <div className="list-heading">
                  <h2>
                    Your links <span>{pagination.total}</span>
                  </h2>
                  <div className="list-tools">
                    <label className="search">
                      <Search size={17} />
                      <input
                        aria-label="Search destinations"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search destinations…"
                      />
                    </label>
                    <button
                      className="icon-button"
                      aria-label="Refresh links and clicks"
                      disabled={loading}
                      onClick={() => setReload((n) => n + 1)}
                    >
                      <RefreshCw size={17} />
                    </button>
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>LINK / DESTINATION</th>
                        <th>CREATED</th>
                        <th>CLICKS</th>
                        <th className="actions-heading">ACTIONS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr>
                          <td colSpan="4" className="empty" role="status">
                            Loading your links…
                          </td>
                        </tr>
                      ) : rows.length ? (
                        rows.map((row) => (
                          <tr key={row.id}>
                            <td>
                              <a
                                className="short-link"
                                href={row.shortUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {row.shortUrl.replace(/^https?:\/\//, "")}
                                <ArrowUpRight size={14} />
                              </a>
                              <a
                                className="destination"
                                href={row.longUrl}
                                target="_blank"
                                rel="noreferrer"
                                title={row.longUrl}
                              >
                                {row.longUrl}
                              </a>
                            </td>
                            <td className="date">
                              {new Date(row.createdAt).toLocaleDateString(
                                undefined,
                                {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                },
                              )}
                            </td>
                            <td>
                              <span className="click-count">
                                {row.clicks.toLocaleString()}
                              </span>
                            </td>
                            <td>
                              <div className="row-actions">
                                <button
                                  className="icon-button"
                                  aria-label={`Copy ${row.shortCode}`}
                                  onClick={() => copy(row)}
                                >
                                  {copied === row.id ? (
                                    <Check size={16} />
                                  ) : (
                                    <Copy size={16} />
                                  )}
                                </button>
                                <button
                                  className="icon-button"
                                  aria-label={`Edit ${row.shortCode}`}
                                  disabled={busy}
                                  onClick={() =>
                                    setModal({ type: "edit", row })
                                  }
                                >
                                  <Pencil size={15} />
                                </button>
                                <button
                                  className="icon-button delete"
                                  aria-label={`Delete ${row.shortCode}`}
                                  disabled={busy}
                                  onClick={() =>
                                    setModal({ type: "delete", row })
                                  }
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="4" className="empty">
                            <Link2 size={28} />
                            <h3>
                              {query
                                ? "No matching links"
                                : "Your first short link starts here."}
                            </h3>
                            <p>
                              {query
                                ? "Try another destination or clear your search."
                                : "Paste a URL above to create your first link."}
                            </p>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="pagination">
                  <span>
                    {pagination.total
                      ? `Page ${page} of ${Math.max(1, pagination.totalPages)}`
                      : "No links to show"}
                  </span>
                  <div>
                    <button
                      disabled={page <= 1 || loading}
                      onClick={() => setPage(page - 1)}
                    >
                      Previous
                    </button>
                    <button
                      disabled={page >= pagination.totalPages || loading}
                      onClick={() => setPage(page + 1)}
                    >
                      Next <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              </section>
            </>
          )}
          <footer>
            <span>Built for shorter journeys.</span>
            <a
              href="https://github.com/devanshsharma27/url-shortner"
              target="_blank"
              rel="noreferrer"
            >
              View project <ExternalLink size={13} />
            </a>
          </footer>
        </div>
      </main>
      {modal && (
        <div className="modal-backdrop">
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onSubmit={saveModal}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) setModal(null);
              if (e.key === "Tab") {
                const items = [
                  ...e.currentTarget.querySelectorAll("input,button"),
                ].filter((x) => !x.disabled);
                const first = items[0],
                  last = items.at(-1);
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <h2 id="modal-title">
              {modal.type === "delete"
                ? "Delete this link?"
                : "Edit destination"}
            </h2>
            <p>
              {modal.type === "delete"
                ? "The short link will stop working. This cannot be undone."
                : "Your short link stays the same. Only its destination changes."}
            </p>
            {modal.type === "edit" && (
              <label>
                Destination URL
                <input
                  ref={modalInput}
                  name="longUrl"
                  type="url"
                  required
                  maxLength={2048}
                  defaultValue={modal.row.longUrl}
                />
              </label>
            )}
            {error && (
              <p role="alert" className="modal-error">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button
                ref={modal.type === "delete" ? modalInput : undefined}
                type="button"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button
                className={modal.type === "delete" ? "danger" : "primary"}
                disabled={busy}
              >
                {busy
                  ? "Working…"
                  : modal.type === "delete"
                    ? "Delete link"
                    : "Save changes"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
