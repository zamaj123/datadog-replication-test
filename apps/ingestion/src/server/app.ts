import Fastify, { FastifyInstance } from "fastify";
import JSONBigFactory from "json-bigint";

import { MetricsWriter } from "../clickhouse/writer";
import { IngestionEnv } from "../config/env";
import { registerMetricsRoute } from "../routes/metrics";
import { registerNotImplementedIngestionRoutes } from "../routes/not-implemented";

const JSONBig = JSONBigFactory({ useNativeBigInt: true });

export interface BuildAppOptions {
  env: IngestionEnv;
  metricsWriter: MetricsWriter;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, body, done) => {
      try {
        done(null, JSONBig.parse(body as string));
      } catch (error) {
        done(error as Error, undefined);
      }
    }
  );

  await registerMetricsRoute(app, {
    env: options.env,
    writer: options.metricsWriter
  });
  await registerNotImplementedIngestionRoutes(app, { env: options.env });

  return app;
}
