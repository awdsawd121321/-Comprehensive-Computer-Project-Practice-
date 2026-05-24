import { getDataBackendBaseUrl } from '../utils/runtimeConfig';

export function buildDataBackendUrl(pathname: string): string {
  const baseUrl = getDataBackendBaseUrl();
  const url = new URL(pathname, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  return url.toString();
}

export async function dataBackendFetch(pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(buildDataBackendUrl(pathname), init);
}

