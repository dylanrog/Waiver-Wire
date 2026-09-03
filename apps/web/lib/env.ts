import { parseEnv, type Env } from "@waiver-wire/shared";

let cached: Env | undefined;

/** Validated environment. First call parses `process.env`; see `.env.example`. */
export function env(): Env {
  cached ??= parseEnv();
  return cached;
}
