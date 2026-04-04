import { MetricWriteRow } from "../types/metrics";

export interface MetricsWriter {
  writeMetrics(rows: MetricWriteRow[]): Promise<void>;
}

export class NoopMetricsWriter implements MetricsWriter {
  async writeMetrics(_rows: MetricWriteRow[]): Promise<void> {
    return;
  }
}
