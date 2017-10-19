export interface Quota {
  /** interval (sliding window) over which API calls are counted, in milliseconds */
  interval?: number;
  /** number of API calls allowed per interval */
  rate?: number;
  /** number of concurrent API calls allowed */
  concurrency?: number;
}
