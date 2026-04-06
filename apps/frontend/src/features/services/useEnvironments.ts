import { useCallback, useEffect, useState } from "react";
import { getEnvironments } from "../../lib/api/services";
import type { EnvironmentsResponse } from "../../lib/api/types";

export function useEnvironments() {
  const [data, setData] = useState<EnvironmentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await getEnvironments();
      setData(response);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to load environments.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    data,
    error,
    isLoading,
    reload: load
  };
}
