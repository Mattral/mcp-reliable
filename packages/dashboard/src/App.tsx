import { Suspense, lazy } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { FleetOverview } from "./pages/FleetOverview.js";

// Lazy-loaded because it pulls in recharts, which the fleet overview never
// needs — this keeps the far more frequently visited "/" route's bundle
// small. See the chunk-size note in docs/decisions/0008-dashboard-stack-and-duplication.md.
const ServerDetail = lazy(() => import("./pages/ServerDetail.js").then((m) => ({ default: m.ServerDetail })));

/**
 * Hash-based routing (`/#/servers/xyz`) rather than createBrowserRouter's
 * path-based routing: the server only ever needs to serve one static
 * index.html for "/" plus its built assets — every sub-route is resolved
 * entirely client-side from the URL fragment, which the server never even
 * sees in the request. This avoids needing a catch-all SPA-fallback route
 * in @mcp-reliable/server (see docs/decisions/0008-dashboard-stack-and-duplication.md).
 */
export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<FleetOverview />} />
          <Route
            path="/servers/:id"
            element={
              <Suspense fallback={<div className="font-mono text-sm text-text-muted">Loading…</div>}>
                <ServerDetail />
              </Suspense>
            }
          />
        </Route>
      </Routes>
    </HashRouter>
  );
}
