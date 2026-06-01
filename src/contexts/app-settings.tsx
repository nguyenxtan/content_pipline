"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Currency = "usd" | "vnd";
type Theme = "dark" | "light";

interface AppSettings {
  currency: Currency;
  usdRate: number;
  theme: Theme;
  toggleCurrency: () => void;
  toggleTheme: () => void;
  fmt: (usd: number, decimals?: number) => string;
}

const AppSettingsContext = createContext<AppSettings>({
  currency: "usd",
  usdRate: 26162,
  theme: "dark",
  toggleCurrency: () => {},
  toggleTheme: () => {},
  fmt: (usd, decimals = 4) => `$${usd.toFixed(decimals)}`,
});

export function useAppSettings() {
  return useContext(AppSettingsContext);
}

export function AppSettingsProvider({
  children,
  initialRate = 26162,
}: {
  children: ReactNode;
  initialRate?: number;
}) {
  const [currency, setCurrency] = useState<Currency>("usd");
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const savedCurrency = localStorage.getItem("currency") as Currency | null;
    const savedTheme = localStorage.getItem("theme") as Theme | null;
    if (savedCurrency === "usd" || savedCurrency === "vnd") setCurrency(savedCurrency);
    if (savedTheme === "light") setTheme("light");
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    if (theme === "light") {
      html.classList.remove("dark");
      html.classList.add("light");
    } else {
      html.classList.remove("light");
      html.classList.add("dark");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleCurrency = () => {
    setCurrency((prev) => {
      const next = prev === "usd" ? "vnd" : "usd";
      localStorage.setItem("currency", next);
      return next;
    });
  };

  const toggleTheme = () => setTheme((prev) => (prev === "dark" ? "light" : "dark"));

  const fmt = (usd: number, decimals = 4): string => {
    if (currency === "vnd") {
      const vnd = Math.round(usd * initialRate);
      if (vnd === 0) return "< 1₫";
      return `${vnd.toLocaleString("vi-VN")}₫`;
    }
    return `$${usd.toFixed(decimals)}`;
  };

  return (
    <AppSettingsContext.Provider
      value={{ currency, usdRate: initialRate, theme, toggleCurrency, toggleTheme, fmt }}
    >
      {children}
    </AppSettingsContext.Provider>
  );
}
