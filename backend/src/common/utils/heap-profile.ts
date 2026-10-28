import { Session } from 'node:inspector/promises';

/**
 * V8's sampling heap profiler: records the allocation stack of a sample of
 * live objects (one per `samplingInterval` bytes on average), cheaply enough
 * to leave on in production. `topRetainers()` answers "which code is holding
 * the heap" without a full heap snapshot, which on a 768 MB container would
 * need about as much memory again as the heap it describes.
 */

type ProfileNode = {
  callFrame: {
    functionName: string;
    url: string;
    lineNumber: number;
  };
  selfSize: number;
  children: ProfileNode[];
};

export type Retainer = { site: string; mb: number; stack: string };

let session: Session | null = null;

export async function startHeapSampling(samplingInterval = 256 * 1024) {
  if (session) return;
  const next = new Session();
  next.connect();
  await next.post('HeapProfiler.startSampling', { samplingInterval });
  session = next;
}

const shortUrl = (url: string) =>
  url
    .replace(/^file:\/\//, '')
    .replace(/^.*\/node_modules\//, '~/')
    .replace(/^.*\/dist\//, '');

const frameLabel = (frame: ProfileNode['callFrame']) =>
  `${frame.functionName || '(anonymous)'} ${shortUrl(frame.url) || '(native)'}:${frame.lineNumber + 1}`;

/** Our own code first: the frame a human can act on, not V8's internals. */
const isOwnCode = (frame: ProfileNode['callFrame']) =>
  frame.url !== '' &&
  !frame.url.includes('node_modules') &&
  !frame.url.startsWith('node:');

/**
 * Sums retained sample sizes per allocation site and returns the biggest.
 * A site is the allocating frame; `stack` adds the nearest frame from our own
 * code, which is usually the line to fix.
 */
export function summarizeProfile(head: ProfileNode, top = 12): Retainer[] {
  const bySite = new Map<string, { bytes: number; stack: string }>();

  const walk = (node: ProfileNode, path: ProfileNode['callFrame'][]) => {
    const frames = [...path, node.callFrame];
    if (node.selfSize > 0) {
      const site = frameLabel(node.callFrame);
      const own = [...frames].reverse().find(isOwnCode);
      const stack = own ? frameLabel(own) : '';
      const key = `${site}|${stack}`;
      const entry = bySite.get(key) ?? { bytes: 0, stack };
      entry.bytes += node.selfSize;
      bySite.set(key, entry);
    }
    for (const child of node.children) walk(child, frames);
  };
  walk(head, []);

  return [...bySite.entries()]
    .map(([key, { bytes, stack }]) => ({
      site: key.split('|')[0],
      mb: Math.round((bytes / 1024 / 1024) * 10) / 10,
      stack,
    }))
    .sort((a, b) => b.mb - a.mb)
    .slice(0, top);
}

export async function topRetainers(top = 12): Promise<Retainer[]> {
  if (!session) return [];
  const { profile } = (await session.post(
    'HeapProfiler.getSamplingProfile',
  )) as {
    profile: { head: ProfileNode };
  };
  return summarizeProfile(profile.head, top);
}
