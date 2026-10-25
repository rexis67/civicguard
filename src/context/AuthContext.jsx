import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  loginUser,
  registerUser,
  resendVerificationEmail,
  verifyEmailToken,
} from "../services/api.js";

const STORAGE_KEY = "civicguard.auth";
const AuthContext = createContext(null);

function tokenExpiry(token) {
  try {
    const [, encodedPayload] = token.split(".");
    if (!encodedPayload) return null;
    const normalized = encodedPayload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isExpired(token) {
  const expiry = tokenExpiry(token);
  return !expiry || expiry <= Date.now();
}

function readStoredSession() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const session = JSON.parse(stored);
    if (
      typeof session.token !== "string" ||
      !session.user ||
      !["citizen", "authority"].includes(session.user.role) ||
      isExpired(session.token)
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

  const resendVerification = useCallback(
    (credentials) => resendVerificationEmail(credentials),
    [],
  );

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  }, []);

  // Keep tabs in sync when one of them signs in or out.
  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key === STORAGE_KEY) setSession(readStoredSession());
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  // Drop the session when its JWT expires instead of showing a signed-in header
  // until the next API call fails.
  useEffect(() => {
    if (!session?.token) return undefined;

    const expiry = tokenExpiry(session.token);
    if (!expiry || expiry <= Date.now()) {
      logout();
      return undefined;
    }

    const timer = window.setTimeout(
      logout,
      Math.min(expiry - Date.now(), 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [session, logout]);

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
