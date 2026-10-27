import React from "react";
import { ArgusProvider, useArgus } from "./state/store.jsx";
import { useRoute } from "./router.js";
import Shell from "./ui/Shell.jsx";
import OverviewPage from "./pages/OverviewPage.jsx";
import AnalyzePage from "./pages/AnalyzePage.jsx";
import FindingsPage from "./pages/FindingsPage.jsx";
import FindingDetailPage from "./pages/FindingDetailPage.jsx";
import PipelinePage from "./pages/PipelinePage.jsx";
import ExamplesPage from "./pages/ExamplesPage.jsx";
import DocsPage from "./pages/DocsPage.jsx";
import Analytics from "./components/Analytics.jsx";
import { getUserId } from "./api.js";
import { EmptyState } from "./ui/primitives.jsx";

function Router() {
  const route = useRoute();
  const { analyticsKey } = useArgus();
  let page;
  switch (route.page) {
    case "overview": page = <OverviewPage />; break;
    case "analyze": page = <AnalyzePage />; break;
    case "findings": page = route.id !== null ? <FindingDetailPage key={route.id} id={route.id} /> : <FindingsPage />; break;
    case "pipeline": page = <PipelinePage />; break;
    case "examples": page = <ExamplesPage />; break;
    case "docs": page = <DocsPage />; break;
    case "analytics":
      page = <Analytics userId={getUserId()} refreshKey={analyticsKey} />;
      break;
    default: page = <EmptyState title="Page not found" body="That page does not exist." />;
  }
  return <Shell route={route}>{page}</Shell>;
}

export default function App() {
  return <ArgusProvider><Router /></ArgusProvider>;
}
