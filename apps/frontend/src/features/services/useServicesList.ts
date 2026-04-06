import { useCallback, useState } from "react";
import { getServices } from "../../lib/api/services";
import type { ServicesRequest, ServicesResponse } from "../../lib/api/types";

export function useServicesList(initialRequest: ServicesRequest) {
  const [request, setRequest] = useState<ServicesRequest>(initialRequest);
  const [data, setData] = useState<ServicesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async (nextRequest?: ServicesRequest) => {
    const resolvedRequest = nextRequest ?? request;

    setRequest(resolvedRequest);
    setIsLoading(true);
    setError(null);

    try {
      const response = await getServices(resolvedRequest);
      setData(response);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to load services.");
    } finally {
      setIsLoading(false);
    }
  }, [request]);

  return {
    request,
    setRequest,
    data,
    error,
    isLoading,
    reload: load
  };
}
