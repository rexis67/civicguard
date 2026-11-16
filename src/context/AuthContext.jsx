import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  getAuthSession,
  loginUser,
  logoutUser,
  requestPasswordReset,
  registerUser,
  resendVerificationEmail,
  resetPassword,
  verifyEmailToken,
} from "../services/api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    try {
      window.localStorage.removeItem("civicguard.auth");
    } catch (error) {
      console.error("[CivicGuard auth] Could not remove a legacy browser session:", error);
    }
  }, []);

  const login = useCallback(async (credentials) => {
    const authenticatedUser = await loginUser(credentials);
    setUser(authenticatedUser);
    return authenticatedUser;
  }, []);

  const register = useCallback(async (details) => {
    return registerUser(details);
  }, []);

  const verifyEmail = useCallback(async (token) => {
    const authenticatedUser = await verifyEmailToken(token);
    setUser(authenticatedUser);
    return authenticatedUser;
  }, []);

  const resendVerification = useCallback(
    (credentials) => resendVerificationEmail(credentials),
    [],
  );

  const forgotPassword = useCallback(
    (email) => requestPasswordReset(email),
    [],
  );

  const completePasswordReset = useCallback(
    (token, password) => resetPassword(token, password),
    [],
  );

  const logout = useCallback(() => {
    setUser(null);
    void logoutUser().catch((error) => {
      console.error("[CivicGuard auth] Could not clear the server session:", error);
    });
  }, []);

  useEffect(() => {
    let active = true;
    const restoreSession = async () => {
      try {
        const authenticatedUser = await getAuthSession();
        if (active) setUser(authenticatedUser);
      } catch (error) {
        console.error("[CivicGuard auth] Could not restore the server session:", error);
        if (active) setUser(null);
      }
    };

    void restoreSession();
    window.addEventListener("focus", restoreSession);
    return () => {
      active = false;
      window.removeEventListener("focus", restoreSession);
    };
  }, []);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      login,
      register,
      verifyEmail,
      resendVerification,
      forgotPassword,
      resetPassword: completePasswordReset,
      logout,
    }),
    [user, login, register, verifyEmail, resendVerification, forgotPassword, completePasswordReset, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider.");
  return context;
}
