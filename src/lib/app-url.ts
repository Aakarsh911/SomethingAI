/**
 * The app's public origin.
 *
 * Read from configuration rather than the incoming request, because it ends up
 * in callback URLs handed to third parties: deriving it from a request would
 * let a forged Host header redirect users somewhere else after authorization.
 */
export function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export function appUrl(path: string): URL {
  return new URL(path, appBaseUrl());
}
