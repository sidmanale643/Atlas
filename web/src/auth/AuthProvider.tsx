import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PropsWithChildren } from "react";
import type { Session } from "@supabase/supabase-js";
import { apiFetch, setApiAccessToken } from "../lib/api-transport";
import { supabase, supabaseConfigurationError } from "../lib/supabase";
import AuthModal from "./AuthModal";
import { AuthContext } from "./AuthContext";
import type { AuthContextValue, AuthModalMode, AuthState, Quota } from "./AuthContext";
import styles from "./AuthModal.module.css";

export const AUTH_MODAL_EVENT = "atlas:open-auth";
export const AUTH_CLAIMED_EVENT = "atlas:auth-claimed";
export const QUOTA_REACHED_EVENT = "atlas:quota-reached";

export function openAuthModal(mode: AuthModalMode = "login"): void {
  window.dispatchEvent(new CustomEvent(AUTH_MODAL_EVENT, { detail: { mode } }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseQuota(value: unknown): Quota | null {
  if (!isRecord(value)) return null;
  const { authenticated, limit, used, remaining, reached } = value;
  if (
    typeof authenticated !== "boolean" || typeof limit !== "number" ||
    typeof used !== "number" || typeof remaining !== "number" ||
    typeof reached !== "boolean"
  ) return null;
  return { authenticated, limit, used, remaining, reached };
}

async function responseMessage(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return isRecord(body) && typeof body.error === "string"
    ? body.error
    : `Request failed (${response.status})`;
}

export default function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>({ kind: "loading", user: null, session: null });
  const [quota, setQuota] = useState<Quota | null>(null);
  const [error, setError] = useState<string | null>(supabaseConfigurationError);
  const [submitting, setSubmitting] = useState(false);
  const [modalMode, setModalMode] = useState<AuthModalMode | null>(null);
  const [quotaPrompt, setQuotaPrompt] = useState<Quota | null>(null);
  const claimedUserRef = useRef<string | null>(null);
  const latestSessionTokenRef = useRef<string | null>(null);
  const pendingClaimRef = useRef<{
    userId: string;
    accessToken: string;
    promise: Promise<Quota>;
  } | null>(null);

  const claimGuestData = useCallback((userId: string, accessToken: string): Promise<Quota> => {
    if (
      pendingClaimRef.current?.userId === userId &&
      pendingClaimRef.current.accessToken === accessToken
    ) return pendingClaimRef.current.promise;
    const promise = (async () => {
      const claimResponse = await apiFetch("/api/auth/claim", { method: "POST" });
      if (!claimResponse.ok) throw new Error(await responseMessage(claimResponse));
      const claimBody: unknown = await claimResponse.json();
      const claimedQuota = parseQuota(claimBody);
      if (!claimedQuota) throw new Error("The server returned an invalid quota response.");
      claimedUserRef.current = userId;
      setQuota(claimedQuota);
      window.dispatchEvent(new CustomEvent(AUTH_CLAIMED_EVENT, { detail: claimedQuota }));
      return claimedQuota;
    })().finally(() => {
      if (
        pendingClaimRef.current?.userId === userId &&
        pendingClaimRef.current.accessToken === accessToken
      ) pendingClaimRef.current = null;
    });
    pendingClaimRef.current = { userId, accessToken, promise };
    return promise;
  }, []);

  const establishSession = useCallback(async (session: Session | null) => {
    const token = session?.access_token ?? null;
    latestSessionTokenRef.current = token;
    setApiAccessToken(token);
    if (!session) {
      claimedUserRef.current = null;
      pendingClaimRef.current = null;
      setQuota(null);
      setState({ kind: "guest", user: null, session: null });
      window.dispatchEvent(new CustomEvent(AUTH_CLAIMED_EVENT));
      return;
    }

    setState({ kind: "loading", user: null, session: null });
    try {
      if (claimedUserRef.current !== session.user.id) {
        await claimGuestData(session.user.id, token);
      }
      if (latestSessionTokenRef.current !== token) return;
      setError(null);
      setState({ kind: "authenticated", user: session.user, session });
      setModalMode(null);
      setQuotaPrompt(null);
    } catch (claimError) {
      if (latestSessionTokenRef.current !== token) return;
      setError(claimError instanceof Error ? claimError.message : "Could not claim guest memories.");
      setState({ kind: "authenticated", user: session.user, session });
    }
  }, [claimGuestData]);

  useEffect(() => {
    if (!supabase) {
      setApiAccessToken(null);
      setState({ kind: "guest", user: null, session: null });
      return;
    }
    let active = true;
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) {
        setError(sessionError.message);
        setState({ kind: "guest", user: null, session: null });
        return;
      }
      void establishSession(data.session);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      queueMicrotask(() => { if (active) void establishSession(session); });
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [establishSession]);

  useEffect(() => {
    const handleOpen = (event: Event) => {
      if (!(event instanceof CustomEvent) || !isRecord(event.detail)) {
        setQuotaPrompt(null);
        setModalMode("login");
        return;
      }
      setQuotaPrompt(null);
      setModalMode(event.detail.mode === "signup" ? "signup" : "login");
    };
    window.addEventListener(AUTH_MODAL_EVENT, handleOpen);
    return () => window.removeEventListener(AUTH_MODAL_EVENT, handleOpen);
  }, []);

  useEffect(() => {
    const handleQuotaReached = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const reachedQuota = parseQuota(event.detail);
      if (!reachedQuota) return;
      setQuota(reachedQuota);
      setQuotaPrompt(reachedQuota);
      setModalMode(reachedQuota.authenticated ? null : "login");
    };
    window.addEventListener(QUOTA_REACHED_EVENT, handleQuotaReached);
    return () => window.removeEventListener(QUOTA_REACHED_EVENT, handleQuotaReached);
  }, []);

  const authenticate = useCallback(async (mode: AuthModalMode, email: string, password: string) => {
    if (!supabase) {
      setError(supabaseConfigurationError);
      return false;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: window.location.origin },
          });
      if (result.error) {
        setError(result.error.message);
        return false;
      }
      if (!result.data.session) {
        setError("Check your email to confirm your account before logging in.");
        return false;
      }
      await establishSession(result.data.session);
      return true;
    } catch (authenticationError) {
      setError(authenticationError instanceof Error ? authenticationError.message : "Authentication failed.");
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [establishSession]);

  const value = useMemo<AuthContextValue>(() => ({
    state,
    quota,
    error,
    configured: supabase !== null,
    submitting,
    modalMode,
    quotaPrompt,
    openAuthModal: (mode = "login") => {
      setError(supabaseConfigurationError);
      setModalMode(mode);
    },
    closeAuthModal: () => {
      if (!submitting) {
        setModalMode(null);
        setQuotaPrompt(null);
        setError(null);
      }
    },
    login: (email, password) => authenticate("login", email, password),
    signup: (email, password) => authenticate("signup", email, password),
    logout: async () => {
      if (!supabase) return;
      setError(null);
      const { error: logoutError } = await supabase.auth.signOut();
      if (logoutError) setError(logoutError.message);
    },
  }), [authenticate, error, modalMode, quota, quotaPrompt, state, submitting]);

  return (
    <AuthContext.Provider value={value}>
      {state.kind === "loading"
        ? <div className={styles.loading} role="status" aria-live="polite">Restoring your atlas…</div>
        : children}
      <AuthModal />
    </AuthContext.Provider>
  );
}

export { useAuth } from "./AuthContext";
export type { AuthModalMode, Quota } from "./AuthContext";
