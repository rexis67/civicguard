import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const STORAGE_KEY = "civicguard-theme";
const ThemeContext = createContext(null);

function getInitialTheme() {
  try {
    const storedTheme = window.localStorage.getItem(STORAGE_KEY);
    if (storedTheme === "dark") return true;
    if (storedTheme === "light") return false;
  } catch (error) {
    console.warn("[CivicGuard theme] Could not read the saved theme preference:", error);
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function ThemeProvider({ children }) {
  const [darkMode, setDarkMode] = useState(getInitialTheme);
  const hasPreferenceRef = useRef(null);
  if (hasPreferenceRef.current === null) {
    try {
      hasPreferenceRef.current = ["dark", "light"].includes(
        window.localStorage.getItem(STORAGE_KEY),
      );
    } catch (error) {
      console.warn("[CivicGuard theme] Could not inspect the saved theme preference:", error);
      hasPreferenceRef.current = false;
    }
  }

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", darkMode);
    root.style.colorScheme = darkMode ? "dark" : "light";
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", darkMode ? "#000000" : "#ffffff");

    if (!hasPreferenceRef.current) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, darkMode ? "dark" : "light");
    } catch (error) {
      console.warn("[CivicGuard theme] Could not save the theme preference:", error);
    }
  }, [darkMode]);

  useEffect(() => {
    const mediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mediaQuery) return undefined;
    function syncSystemTheme(event) {
      if (hasPreferenceRef.current) return;
      setDarkMode(event.matches);
    }

    mediaQuery.addEventListener("change", syncSystemTheme);
    return () => mediaQuery.removeEventListener("change", syncSystemTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    hasPreferenceRef.current = true;
    setDarkMode((current) => !current);
  }, []);
  const value = useMemo(() => ({ darkMode, toggleTheme }), [darkMode, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("useTheme must be used within a ThemeProvider.");
  return theme;
}
