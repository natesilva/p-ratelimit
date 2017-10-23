export interface Quota {
  /** interval (sliding window) over which API calls are counted, in milliseconds */
  interval?: number;
  /** number of API calls allowed per interval */
  rate?: number;
  /** number of concurrent API calls allowed */
  concurrency?: number;
  /**
   * if a request is queued longer than this, it will be discarded and an error thrown
   * (default: 0, disabled)
   */
  maxDelay?: number;
  /**
   * (Redis only): if true, immediately begin processing requests using the full quota,
   * instead of waiting several seconds to discover other servers (default: false)
   */
  fastStart?: boolean;
}
