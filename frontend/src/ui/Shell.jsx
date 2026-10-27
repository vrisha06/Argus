import React, { useState } from "react";
import {
  LayoutDashboard, Code2, ShieldAlert, Workflow, Library, FileText, BarChart3, Eye,
  PanelLeftClose, PanelLeftOpen, Sun, Moon, BookOpen, Menu, ChevronRight, Loader2,
} from "lucide-react";
import { useArgus } from "../state/store.jsx";
import { go } from "../router.js";

const NAV = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "analyze", label: "Analyze Code", icon: Code2 },
  { id: "findings", label: "Findings", icon: ShieldAlert, badge: true },
  { id: "pipeline", label: "Compiler Pipeline", icon: Workflow },
  { id: "examples", label: "Examples", icon: Library },
  { id: "docs", label: "Documentation", icon: FileText },
  { id: "analytics", label: "My Analytics", icon: BarChart3 },
];
const TITLES = Object.fromEntries(NAV.map((n) => [n.id, n.label]));

function Sidebar({ page, mobileOpen, closeMobile }) {
  const { collapsed, setCollapsed, findings } = useArgus();
  return (
    <aside className={`sb ${collapsed ? "collapsed" : ""} ${mobileOpen ? "open" : ""}`} aria-label="Primary">
      <div className="sb-brand">
        <span className="sb-logo" aria-hidden><Eye size={20} /></span>
        {!collapsed && (
          <div className="sb-brand-text">
            <strong>Argus</strong>
            <span>Secure Code. Smarter Compilers. Safer Software.</span>
          </div>
        )}
      </div>
      <nav className="sb-nav">
        {NAV.map(({ id, label, icon: Icon, badge }) => (
          <a key={id} href={`#/${id}`} onClick={closeMobile}
             className={`sb-item ${page === id ? "active" : ""}`}
             aria-current={page === id ? "page" : undefined} title={collapsed ? label : undefined}>
            <Icon size={18} aria-hidden />
            {!collapsed && <span>{label}</span>}
            {!collapsed && badge && findings.length > 0 && <em className="sb-badge">{findings.length}</em>}
          </a>
        ))}
      </nav>
      <button className="sb-collapse" onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
        {collapsed ? <PanelLeftOpen size={18} /> : <><PanelLeftClose size={18} /><span>Collapse</span></>}
      </button>
    </aside>
  );
}

function Topbar({ route, openMobile }) {
  const { theme, setTheme, resultMeta, findings, files, analyzing, liveBusy } = useArgus();
  const crumbs = [{ label: "Argus", href: "#/overview" }, { label: TITLES[route.page] || "Not found", href: `#/${route.page}` }];
  if (route.page === "findings" && route.id !== null) crumbs.push({ label: `Finding #${route.id + 1}` });
  const ctx = resultMeta
    ? `${resultMeta.files.length > 1 ? `${resultMeta.files.length} files` : resultMeta.files[0]} · ${findings.length} finding${findings.length === 1 ? "" : "s"}`
    : files.length > 1 ? `${files.length} files · not analyzed` : `${files[0]?.name} · not analyzed`;
  return (
    <header className="tb">
      <button className="icon-btn tb-menu" onClick={openMobile} aria-label="Open navigation"><Menu size={18} /></button>
      <nav className="crumbs" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <ChevronRight size={14} aria-hidden />}
            {c.href && i < crumbs.length - 1 ? <a href={c.href}>{c.label}</a> : <span aria-current="page">{c.label}</span>}
          </React.Fragment>
        ))}
      </nav>
      <div className="tb-right">
        <span className="ctx-chip" title="Current analysis context">
          {(analyzing || liveBusy) ? <Loader2 size={13} className="spin" aria-hidden /> : <span className="ctx-dot" aria-hidden />}
          <span className="mono">{ctx}</span>
        </span>
        <button className="icon-btn" onClick={() => go("/docs")} aria-label="Open documentation" title="Documentation"><BookOpen size={18} /></button>
        <button className="icon-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
}

export default function Shell({ route, children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { collapsed } = useArgus();
  return (
    <div className={`shell ${collapsed ? "is-collapsed" : ""}`}>
      <Sidebar page={route.page} mobileOpen={mobileOpen} closeMobile={() => setMobileOpen(false)} />
      {mobileOpen && <div className="scrim" onClick={() => setMobileOpen(false)} aria-hidden />}
      <div className="shell-main">
        <Topbar route={route} openMobile={() => setMobileOpen(true)} />
        <main className="page" id="main">{children}</main>
      </div>
    </div>
  );
}
