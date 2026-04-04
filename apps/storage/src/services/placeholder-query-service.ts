export function emptyLogsResponse(): {
  logs: [];
  next_cursor: null;
  total_matched: number;
  truncated: boolean;
} {
  return {
    logs: [],
    next_cursor: null,
    total_matched: 0,
    truncated: false,
  };
}

export function emptyLogCountResponse(): { count: number; truncated: boolean } {
  return { count: 0, truncated: false };
}

export function emptyLogVolumeResponse(step: string): { step: string; buckets: [] } {
  return { step, buckets: [] };
}

export function emptyTracesResponse(): { traces: []; next_cursor: null } {
  return { traces: [], next_cursor: null };
}

export function emptyServicesResponse(): { services: [] } {
  return { services: [] };
}

export function emptyEnvironmentsResponse(): { environments: [] } {
  return { environments: [] };
}
