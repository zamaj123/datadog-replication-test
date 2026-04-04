import { useState } from "react";
import { getMetricQuery } from "../../lib/api/metrics";
import type { MetricQueryRequest, MetricQueryResponse } from "../../lib/api/types";

export function useMetricQuery(initialRequest: MetricQueryRequest) {
  const [request, setRequest] = useState<MetricQueryRequest>(initialRequest);
  const [data, setData] = useState<MetricQueryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function runQuery(nextRequest?: MetricQueryRequest) {
    const resolvedRequest = nextRequest ?? request;

    setRequest(resolvedRequest);
    setIsLoading(true);
    setError(null);

    try {
      const response = await getMetricQuery(resolvedRequest);
      setData(response);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to load metric series.");
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
    runQuery
  };
}
