import { Hono } from "hono";

export type Env = {
  Bindings: {
    APP_ENV: string;
  };
};

export const app = new Hono<Env>().basePath("/api");

const routes = app.get("/health", (c) =>
  c.json({ status: "ok", service: "classa-api", env: c.env?.APP_ENV ?? "test" }),
);

export type AppType = typeof routes;
