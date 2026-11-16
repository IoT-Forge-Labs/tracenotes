/**
 * Turn a git remote into the web link base that `--repo-url` takes (tickets/T-010).
 *
 * Pure: no git, no file system, no network. The caller reads the remote.
 * Validate Before You Normalize: the whole raw remote is matched against one of three shapes before
 * anything is removed; the only framing removed is one trailing newline (`\n` or `\r\n`, printed
 * by git), one `.git` suffix and the userinfo before `@`.
 * Credentials never leave this function: they are not in the result, and an error message never
 * contains the remote or any part of it.
 */
import { checkRepoUrl } from './render.ts';

const HOST = '[A-Za-z0-9.-]+';
const SEGMENT = '[A-Za-z0-9._-]+';
const USERINFO = '[^@/?#\\s]+@';

/** `https://[userinfo@]host[:port]/owner/repo[.git]`; the port is the web port and is kept. */
const HTTPS = new RegExp(
  `^https://(?:${USERINFO})?(?<host>${HOST})(?::(?<port>[0-9]+))?/(?<owner>${SEGMENT})/(?<repo>${SEGMENT})$`,
);
/**
 * `ssh://[user@]host[:port]/owner/repo[.git]`; the port is the SSH port: checked (1-65535), then
 * dropped, because it is not the web port.
 */
const SSH = new RegExp(
  `^ssh://(?:${USERINFO})?(?<host>${HOST})(?::(?<sshPort>[0-9]+))?/(?<owner>${SEGMENT})/(?<repo>${SEGMENT})$`,
);
/**
 * scp-like `[user@]host:owner/repo[.git]`. The host has at least two characters: on Windows
 * `C:work/repo` is a drive-relative path, not a remote.
 */
const SCP = new RegExp(`^(?:[^@/:?#\\s]+@)?(?<host>[A-Za-z0-9.-]{2,}):(?<owner>${SEGMENT})/(?<repo>${SEGMENT})$`);

const EXPECTED =
  'not a supported remote: expected https://<host>[:port]/<owner>/<repo>[.git], ' +
  'ssh://[user@]<host>[:port]/<owner>/<repo>[.git] or [user@]<host>:<owner>/<repo>[.git]';

/**
 * Convert an origin remote into `https://<host>[:port]/<owner>/<repo>`.
 *
 * @param remote The remote exactly as `git remote get-url origin` printed it, newline included.
 * @returns A link base that passes `checkRepoUrl()`, with any userinfo dropped. Host, owner and
 *   repo keep their case.
 * @throws RangeError for any other shape, including a result `checkRepoUrl()` rejects (such as
 *   port 0). The message names the accepted forms and never contains the remote.
 */
export function repoUrlFromRemote(remote: string): string {
  const raw = remote.endsWith('\r\n') ? remote.slice(0, -2) : remote.endsWith('\n') ? remote.slice(0, -1) : remote;

  const groups = (HTTPS.exec(raw) ?? SSH.exec(raw) ?? SCP.exec(raw))?.groups;
  if (groups === undefined) throw new RangeError(EXPECTED);
  const { host, port, sshPort, owner } = groups as { host: string; port?: string; sshPort?: string; owner: string };
  if (sshPort !== undefined && !(Number(sshPort) >= 1 && Number(sshPort) <= 65535)) throw new RangeError(EXPECTED);
  const repo = groups['repo']!.endsWith('.git') ? groups['repo']!.slice(0, -'.git'.length) : groups['repo']!;
  if (repo === '' || isDotSegment(owner) || isDotSegment(repo)) throw new RangeError(EXPECTED);

  const url = `https://${host}${port === undefined ? '' : `:${port}`}/${owner}/${repo}`;
  try {
    checkRepoUrl(url);
  } catch (error) {
    // checkRepoUrl's own message quotes the URL; replace it so no part of the remote is shown.
    if (error instanceof RangeError) throw new RangeError(EXPECTED);
    throw error;
  }
  return url;
}

/** `.` and `..` are path navigation, not names; a link built from them points elsewhere. */
function isDotSegment(segment: string): boolean {
  return segment === '.' || segment === '..';
}
