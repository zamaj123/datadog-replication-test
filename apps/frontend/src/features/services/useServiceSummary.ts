import { useState } from "react";
import { getServiceSummary } from "../../lib/api/services";
import type { ServiceSummaryRequest, ServiceSummaryResponse } from "../../lib/api/types";

export function useServiceSummary(serviceName: string, initialRequest: ServiceSummaryRequest) {
  const [request, setRequest] = useState<ServiceSummaryRequest>(initialRequest);
  const [data, setData] = useState<ServiceSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function load(nextRequest?: ServiceSummaryRequest) {
    const resolvedRequest = nextRequest ?? request;

    setRequest(resolvedRequest);
    setIsLoading(true);
    setError(null);

    try {
      const response = await getServiceSummary(serviceName, resolvedRequest);
      setData(response);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to load service summary.");
    } finally {
      setIsLoading(false);
    }
  }

  return {
    request,
    setRequest,
    data,
    error,
    isLoading,
    reload: load
  };
}
