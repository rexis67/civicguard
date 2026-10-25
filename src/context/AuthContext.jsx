import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  loginUser,
  registerUser,
  resendVerificationEmail,
  verifyEmailToken,
} from "../services/api.js";

const STORAGE_KEY = "civicguard.auth";
const AuthContext = createContext(null);

function readStoredSession() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const session = JSON.parse(stored);
    if (
      typeof session.token !== "string" ||
      !session.user ||
      !["citizen", "authority"].includes(session.user.role)
    ) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return session;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(readStoredSession);

  const persistSession = useCallback((nextSession) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
    setSession(nextSession);
    return nextSession.user;
  }, []);

  const login = useCallback(async (credentials) => {
    const result = await loginUser(credentials);
    return persistSession({ token: result.token, user: result.user });
  }, [persistSession]);

  const register = useCallback(async (details) => {
    return registerUser(details);
  }, []);

  const verifyEmail = useCallback(async (token) => {
    const result = await verifyEmailToken(token);
    return persistSession({ token: result.token, user: result.user });
  }, [persistSession]);

  const resendVerification = useCallback((email) => resendVerificationEmail(email), []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({
      user: session?.user ?? null,
      token: session?.token ?? null,
      isAuthenticated: Boolean(session?.token),
      login,
      register,
      verifyEmail,
      resendVerification,
      logout,
    }),
    [session, login, register, verifyEmail, resendVerification, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider.");
  return context;
}
