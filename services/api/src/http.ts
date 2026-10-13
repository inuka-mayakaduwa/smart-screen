export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, text || response.statusText);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function postForm(url: string, body: URLSearchParams): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  return readJson(response);
}
