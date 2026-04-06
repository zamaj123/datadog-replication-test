import { useEffect, useState } from "react";

export interface ServicesRoute {
  kind: "services";
}

export interface ServiceDetailRoute {
  kind: "service";
  serviceName: string;
}

export type AppRoute = ServicesRoute | ServiceDetailRoute;

function readRoute(pathname: string): AppRoute {
  if (pathname === "/" || pathname === "/services") {
    return { kind: "services" };
  }

  const match = pathname.match(/^\/services\/(.+)$/);

  if (match) {
    return {
      kind: "service",
      serviceName: decodeURIComponent(match[1])
    };
  }

  return { kind: "services" };
}

export function navigate(pathname: string) {
  window.history.pushState({}, "", pathname);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useAppRoute() {
  const [route, setRoute] = useState<AppRoute>(() => readRoute(window.location.pathname));

  useEffect(() => {
    function handlePopstate() {
      setRoute(readRoute(window.location.pathname));
    }

    window.addEventListener("popstate", handlePopstate);
    return () => window.removeEventListener("popstate", handlePopstate);
  }, []);

  return route;
}
