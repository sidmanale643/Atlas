import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "./AuthContext";
import styles from "./AuthModal.module.css";

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export default function AuthModal() {
  const auth = useAuth();
  const dialogRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const mode = auth.modalMode;
  const quotaPrompt = auth.quotaPrompt;
  useEffect(() => {
    if (!mode && !quotaPrompt) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => (emailRef.current ?? closeRef.current)?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, [mode, quotaPrompt]);

  if (!mode && !quotaPrompt) return null;

  const isLogin = mode === "login";
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const succeeded = isLogin
      ? await auth.login(email, password)
      : await auth.signup(email, password);
    if (succeeded) {
      setEmail("");
      setPassword("");
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !auth.submitting) {
      auth.closeAuthModal();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className={styles.backdrop} onMouseDown={(event) => {
      if (event.target === event.currentTarget && !auth.submitting) auth.closeAuthModal();
    }}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
      >
        <button
          ref={closeRef}
          className={styles.close}
          type="button"
          aria-label="Close authentication dialog"
          onClick={auth.closeAuthModal}
          disabled={auth.submitting}
        >
          ×
        </button>
        <p className={styles.eyebrow}>{quotaPrompt ? "Atlas capacity" : "Atlas account"}</p>
        <h2 id={titleId}>
          {quotaPrompt
            ? `You've recorded all ${quotaPrompt.limit} memories.`
            : isLogin ? "Welcome back." : "Keep building your atlas."}
        </h2>
        <p id={descriptionId} className={styles.description}>
          {quotaPrompt?.authenticated
            ? "This account has reached its lifetime submission limit. Deleting memories does not restore capacity."
            : quotaPrompt
              ? "Log in or sign up to move these guest memories into an account and continue up to 25 total submissions."
              : isLogin
                ? "Log in to continue with your account memories."
                : "Create an account with email and password. Guest memories on this network will come with you."}
        </p>
        {quotaPrompt?.authenticated ? null : <>
          <div className={styles.tabs} aria-label="Authentication method">
            <button type="button" aria-pressed={isLogin} onClick={() => auth.openAuthModal("login")}>Log in</button>
            <button type="button" aria-pressed={!isLogin} onClick={() => auth.openAuthModal("signup")}>Sign up</button>
          </div>
          <form className={styles.form} onSubmit={handleSubmit}>
          <label htmlFor={`${titleId}-email`}>Email</label>
          <input
            ref={emailRef}
            id={`${titleId}-email`}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={auth.submitting}
          />
          <label htmlFor={`${titleId}-password`}>Password</label>
          <input
            id={`${titleId}-password`}
            type="password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            disabled={auth.submitting}
          />
          {auth.error ? <p className={styles.error} id={errorId} role="alert">{auth.error}</p> : null}
          <button className={styles.submit} type="submit" disabled={auth.submitting || !auth.configured} aria-describedby={auth.error ? errorId : undefined}>
            {auth.submitting ? "Connecting…" : isLogin ? "Log in" : "Create account"}
          </button>
          </form>
        </>}
      </div>
    </div>,
    document.body,
  );
}
