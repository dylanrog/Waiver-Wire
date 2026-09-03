import { createDb, type Db } from "@waiver-wire/db";
import { createSleeperClient, type SleeperClient } from "@waiver-wire/sleeper";

import { env } from "./env";

let dbHandle: Db | undefined;
let sleeperHandle: SleeperClient | undefined;

export function db(): Db {
  dbHandle ??= createDb(env().DATABASE_URL);
  return dbHandle;
}

export function sleeper(): SleeperClient {
  sleeperHandle ??= createSleeperClient({ userAgent: env().FETCH_USER_AGENT });
  return sleeperHandle;
}
