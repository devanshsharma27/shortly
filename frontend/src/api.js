// Tab-scoped tokens keep this learning project small. See docs/HLD.md for tradeoffs.
let tokens;
try {
  tokens = JSON.parse(sessionStorage.getItem("session") || "null");
} catch {
  tokens = null;
}
let refreshPromise;
export const hasSession = () => Boolean(tokens?.accessToken);
export function setSession(value) {
  tokens = value;
  value
    ? sessionStorage.setItem("session", JSON.stringify(value))
    : sessionStorage.removeItem("session");
}
async function send(path, options = {}) {
  return fetch("/api" + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(tokens && { Authorization: `Bearer ${tokens.accessToken}` }),
      ...options.headers,
    },
  });
}
export async function api(path, options = {}, retry = true) {
  let response = await send(path, options);
  if (
    response.status === 401 &&
    retry &&
    tokens &&
    !path.startsWith("/auth/")
  ) {
    if (!refreshPromise) {
      refreshPromise = (async () => {
        const result = await send("/auth/refresh", {
          method: "POST",
          body: JSON.stringify({ refreshToken: tokens.refreshToken }),
        });
        if (!result.ok) {
          setSession(null);
          window.dispatchEvent(new Event("session-expired"));
          throw new Error("Your session expired. Please sign in again.");
        }
        setSession(await result.json());
      })().finally(() => {
        refreshPromise = null;
      });
    }
    await refreshPromise;
    return api(path, options, false);
  }
  if (response.status === 204) return null;
  const data = await response
    .json()
    .catch(() => ({ error: "Service unavailable. Please try again." }));
  if (!response.ok)
    throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}
export async function logout() {
  if (tokens)
    await api("/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
  setSession(null);
}
