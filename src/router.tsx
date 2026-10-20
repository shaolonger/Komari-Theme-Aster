import { createBrowserRouter, Navigate } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { AppShell } from "@/components/shell/AppShell";
import { RouteErrorFallback } from "@/components/shell/ErrorBoundary";

const Home = lazy(() =>
  import("@/pages/Home").then((m) => ({ default: m.Home })),
);
const Instance = lazy(() =>
  import("@/pages/Instance").then((m) => ({ default: m.Instance })),
);
const InstanceReport = lazy(() => import("@/pages/InstanceReport"));
const Compare = lazy(() =>
  import("@/pages/Compare").then((m) => ({ default: m.Compare })),
);
const NotFound = lazy(() =>
  import("@/pages/NotFound").then((m) => ({ default: m.NotFound })),
);
const NetworkObservatory = lazy(() =>
  import("@/pages/NetworkObservatory").then((m) => ({
    default: m.NetworkObservatory,
  })),
);

function loading(page: ReactNode) {
  return (
    <Suspense
      fallback={
        <div className="flex h-[60vh] items-center justify-center">
          <Spinner />
        </div>
      }
    >
      {page}
    </Suspense>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    errorElement: <RouteErrorFallback />,
    children: [
      {
        index: true,
        element: loading(<Home />),
      },
      {
        path: "compare",
        element: loading(<Compare />),
      },
      {
        path: "network-observatory",
        element: loading(<NetworkObservatory />),
      },
      {
        path: "instance/:uuid/report",
        element: loading(<InstanceReport />),
      },
      {
        path: "instance/:uuid",
        element: loading(<Instance />),
      },
      {
        path: "404",
        element: loading(<NotFound />),
      },
      { path: "*", element: <Navigate to="/404" replace /> },
    ],
  },
]);
