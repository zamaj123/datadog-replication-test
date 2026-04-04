import { useCallback, useEffect, useState } from "react";
import { getMetricNames } from "../../lib/api/metrics";
import type { MetricNamesRequest, MetricNamesResponse } from "../../lib/api/types";

export function useMetricNames(initialRequest: MetricNamesRequest) {
  const [request, setRequest] = useState<MetricNamesRequest>(initialRequest);
  const [data, setData] = useState<MetricNamesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await getMetricNames(request);
      setData(response);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to load metric names.");
    } finally {
      setIsLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    request,
    setRequest,
    data,
    error,
    isLoading,
    reload: load
  };
}
