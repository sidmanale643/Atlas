import { createContext, useContext } from "react";
import type { Session, User } from "@supabase/supabase-js";

export type AuthModalMode = "login" | "signup";

export type Quota = {
  authenticated: boolean;
  limit: number;
  used: number;
  remaining: number;
  reached: boolean;
};

export type AuthState =
  | { kind: "loading"; user: null; session: null }
  | { kind: "guest"; user: null; session: null }
  | { kind: "authenticated"; user: User; session: Session };

export type AuthContextValue = {
  state: AuthState;
  quota: Quota | null;
  error: string | null;
  configured: boolean;
  submitting: boolean;
  modalMode: AuthModalMode | null;
  quotaPrompt: Quota | null;
  openAuthModal: (mode?: AuthModalMode) => void;
  closeAuthModal: () => void;
  login: (email: string, password: string) => Promise<boolean>;
  signup: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
