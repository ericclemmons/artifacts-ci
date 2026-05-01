export function getUpstream(headers: Headers, namespace: string, repoName: string) {
  const token = getBearerToken(headers);
  const remote = headers.get("X-Artifacts-Remote") ?? undefined;

  if (!token) {
    return {
      ok: false as const,
      status: 401,
      message:
        "Missing Artifacts token. Run the setup command from http://ci.localhost:8787 first.\n",
    };
  }

  if (!isExpectedRemote(remote, namespace, repoName)) {
    return {
      ok: false as const,
      status: 400,
      message:
        "Missing or invalid X-Artifacts-Remote header. Run the setup command from http://ci.localhost:8787 first.\n",
    };
  }

  return { ok: true as const, remote, token };
}

export function withArtifactsAuth(headers: Headers, token: string) {
  const next = new Headers(headers);

  next.set("Authorization", `Bearer ${token}`);
  next.delete("X-Artifacts-Remote");
  next.delete("Host");
  next.delete("Content-Length");

  return next;
}

function getBearerToken(headers: Headers) {
  const authorization = headers.get("Authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function isExpectedRemote(
  remote: string | undefined,
  namespace: string,
  repoName: string,
): remote is string {
  if (!remote?.startsWith("https://")) {
    return false;
  }

  try {
    const url = new URL(remote);
    return url.pathname === `/git/${namespace}/${repoName}.git`;
  } catch {
    return false;
  }
}
