import { useEffect, useState } from "react";

// Minimal hash router: "#/findings/3" -> { page: "findings", id: 3 }.
const parse = (hash) => {
  const parts = (hash || "").replace(/^#\/?/, "").split("/").filter(Boolean);
  const page = parts[0] || "overview";
  const id = parts[1] !== undefined && /^\d+$/.test(parts[1]) ? Number(parts[1]) : null;
  return { page, id };
};

export function useRoute() {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const on = () => { setRoute(parse(window.location.hash)); window.scrollTo?.(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export const go = (path) => { window.location.hash = path; };
