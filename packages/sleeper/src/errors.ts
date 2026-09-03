/** Base for every error this package throws. */
export class SleeperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The requested user, league, or resource does not exist (HTTP 404, or a `null` body). */
export class SleeperNotFound extends SleeperError {}

/** Rate limited (HTTP 429) and out of retries. */
export class SleeperRateLimited extends SleeperError {}

/** Sleeper is down or unreachable (5xx / network / timeout) and out of retries. */
export class SleeperUnavailable extends SleeperError {}

/** A response parsed as JSON but did not match the expected schema. */
export class SleeperResponseInvalid extends SleeperError {}
