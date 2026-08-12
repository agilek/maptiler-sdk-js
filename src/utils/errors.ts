export class FetchError extends Error {
  status: number;
  statusText: string;
  /** Message the service returned in the response body, when it provided one. */
  detail?: string;

  /**
   * @param response - The failed response.
   * @param resource - What was being fetched, for the message ("image metadata", "directions", …).
   * @param module - The emitting unit, used as the `[module]:` message prefix.
   * @param detail - Message parsed out of the response body. Appended to the
   * message so the service's own explanation survives, since the HTTP status
   * alone rarely says why a request was rejected.
   */
  constructor(response: Response, resource: string, module: string, detail?: string) {
    const message = `[${module}]: Failed to fetch ${resource} at ${response.url}: ${response.status.toString()}: ${response.statusText}${detail ? `. ${detail}` : ""}`;

    super(message);

    this.name = "FetchError";
    this.message = message;
    this.status = response.status;
    this.statusText = response.statusText;
    this.detail = detail;
  }
}
