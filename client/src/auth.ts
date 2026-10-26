import { httpBase } from "./shop";

// Signing in with a Gattchaa account. "Sign in with Gattchaa" goes to
// gattchaaoripa.com, which sends the player back here with a one-time
// ?ticket=… (valid for a minute). We swap it for a game session token right
// away, so the player can take their time in the character creator.

const TOKEN_KEY = "my-world:token";
const ACCOUNT_KEY = "my-world:account";

/** The character saved on the account (empty strings before the first visit). */
export interface AccountInfo {
  displayName: string;
  name: string;
  look: string;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the sign-in lasts until the tab closes */
  }
}

export class Auth {
  token: string | null = read(TOKEN_KEY);
  /** Gattchaa display name of the signed-in account. */
  displayName: string | null = read(ACCOUNT_KEY);

  get signedIn() {
    return Boolean(this.token);
  }

  /** Where "Sign in with Gattchaa" goes (the game server forwards to gattchaaoripa.com). */
  get signInUrl() {
    return `${httpBase()}/auth/gattchaa`;
  }

  /**
   * Finishes a sign-in if this page was opened with ?ticket=…: the account, an
   * error message to show, or null when there was no ticket.
   */
  async completeSignIn(): Promise<AccountInfo | string | null> {
    const url = new URL(location.href);
    const ticket = url.searchParams.get("ticket");
    if (!ticket) return null;
    // Don't leave the ticket in the address bar, history or a shared link.
    url.searchParams.delete("ticket");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    try {
      const res = await fetch(`${httpBase()}/api/auth/ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket }),
      });
      const body = (await res.json()) as { token?: string; account?: AccountInfo; error?: string };
      if (!res.ok || !body.token || !body.account) return body.error || "Sign-in failed. Please try again.";
      this.remember(body.token, body.account.displayName);
      return body.account;
    } catch {
      return "Couldn't reach the game server to finish signing in.";
    }
  }

  async signOut() {
    const token = this.token;
    this.forget();
    if (!token) return;
    await fetch(`${httpBase()}/api/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => undefined);
  }

  /** Drops the session locally (the server said it's no longer valid). */
  forget() {
    this.remember(null, null);
  }

  private remember(token: string | null, displayName: string | null) {
    this.token = token;
    this.displayName = displayName;
    write(TOKEN_KEY, token);
    write(ACCOUNT_KEY, displayName);
  }
}
