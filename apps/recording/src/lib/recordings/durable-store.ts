/**
 * Durable local capture (audit: "audio is durable only after a completed
 * upload"). Every recorder chunk is written to IndexedDB as it arrives, so a
 * crash, reload or closed tab leaves the take on this device for upload later.
 * Chunks are kept as ArrayBuffers, which every IndexedDB implementation can
 * store, and upload progress is kept per block so an upload can resume.
 */

export type TrackType = 'mic' | 'sounders';
export const TRACK_TYPES: readonly TrackType[] = ['mic', 'sounders'];

export interface DurableTrack {
  mimeType: string;
  chunkCount: number;
  size: number;
  /** Indexes of upload blocks already staged in storage. */
  uploadedBlocks: number[];
  committed: boolean;
}

export interface DurableTake {
  id: string;
  sessionId: string;
  episode: string;
  hostName: string;
  startedAt: number;
  /** Null until the take is stopped normally. */
  durationMs: number | null;
  state: 'capturing' | 'saved';
  lastChunkAt: number;
  tracks: Record<TrackType, DurableTrack>;
}

interface StoredChunk {
  takeId: string;
  track: TrackType;
  seq: number;
  data: ArrayBuffer;
}

const DB_NAME = 'bbpc-recording';
const DB_VERSION = 1;
const TAKES = 'takes';
const CHUNKS = 'chunks';
// Without Web Locks, a capturing take counts as live while chunks keep arriving.
const LIVE_WITHOUT_LOCKS_MS = 15_000;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function lockName(takeId: string): string {
  return `bbpc-recording-take:${takeId}`;
}

export class DurableRecordingStore {
  private db: Promise<IDBDatabase>;
  private chunkSeq = new Map<string, number>();

  constructor(factory: IDBFactory) {
    this.db = new Promise((resolve, reject) => {
      const open = factory.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains(TAKES)) {
          db.createObjectStore(TAKES, { keyPath: 'id' }).createIndex('by_sessionId', 'sessionId');
        }
        if (!db.objectStoreNames.contains(CHUNKS)) {
          db.createObjectStore(CHUNKS, { keyPath: ['takeId', 'track', 'seq'] });
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }

  async beginTake(input: {
    id: string;
    sessionId: string;
    episode: string;
    hostName: string;
    startedAt: number;
    mimeTypes: Record<TrackType, string>;
  }): Promise<DurableTake> {
    const track = (mimeType: string): DurableTrack => ({ mimeType, chunkCount: 0, size: 0, uploadedBlocks: [], committed: false });
    const take: DurableTake = {
      id: input.id,
      sessionId: input.sessionId,
      episode: input.episode,
      hostName: input.hostName,
      startedAt: input.startedAt,
      durationMs: null,
      state: 'capturing',
      lastChunkAt: input.startedAt,
      tracks: { mic: track(input.mimeTypes.mic), sounders: track(input.mimeTypes.sounders) },
    };
    const tx = (await this.db).transaction(TAKES, 'readwrite');
    tx.objectStore(TAKES).put(take);
    await done(tx);
    return take;
  }

  /**
   * Chunks are numbered in call order before any await, and IndexedDB runs
   * overlapping readwrite transactions in creation order, so the stored order
   * matches the recorder's.
   */
  async appendChunk(takeId: string, track: TrackType, chunk: Blob): Promise<void> {
    const key = `${takeId}\u0000${track}`;
    const seq = this.chunkSeq.get(key) ?? 0;
    this.chunkSeq.set(key, seq + 1);
    const data = await chunk.arrayBuffer();
    await this.updateTake(takeId, take => {
      take.tracks[track].chunkCount = Math.max(take.tracks[track].chunkCount, seq + 1);
      take.tracks[track].size += data.byteLength;
      take.lastChunkAt = Date.now();
    }, store => {
      const stored: StoredChunk = { takeId, track, seq, data };
      store.put(stored);
    });
  }

  async finishTake(takeId: string, durationMs: number): Promise<void> {
    await this.updateTake(takeId, take => {
      take.durationMs = durationMs;
      take.state = 'saved';
    });
  }

  async markBlockUploaded(takeId: string, track: TrackType, index: number): Promise<void> {
    await this.updateTake(takeId, take => {
      if (!take.tracks[track].uploadedBlocks.includes(index)) take.tracks[track].uploadedBlocks.push(index);
    });
  }

  async markCommitted(takeId: string, track: TrackType): Promise<void> {
    await this.updateTake(takeId, take => { take.tracks[track].committed = true; });
  }

  async getTake(takeId: string): Promise<DurableTake | null> {
    const tx = (await this.db).transaction(TAKES, 'readonly');
    return (await request(tx.objectStore(TAKES).get(takeId)) as DurableTake | undefined) ?? null;
  }

  async listTakes(sessionId: string): Promise<DurableTake[]> {
    const tx = (await this.db).transaction(TAKES, 'readonly');
    const takes = await request(tx.objectStore(TAKES).index('by_sessionId').getAll(sessionId)) as DurableTake[];
    return takes.sort((left, right) => left.startedAt - right.startedAt);
  }

  async readTrack(take: DurableTake, track: TrackType): Promise<Blob> {
    const tx = (await this.db).transaction(CHUNKS, 'readonly');
    const range = IDBKeyRange.bound([take.id, track, 0], [take.id, track, Number.MAX_SAFE_INTEGER]);
    const chunks = await request(tx.objectStore(CHUNKS).getAll(range)) as StoredChunk[];
    return new Blob(chunks.map(chunk => chunk.data), { type: take.tracks[track].mimeType });
  }

  async deleteTake(takeId: string): Promise<void> {
    const tx = (await this.db).transaction([TAKES, CHUNKS], 'readwrite');
    tx.objectStore(TAKES).delete(takeId);
    tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([takeId, '', 0], [takeId, '￿', Number.MAX_SAFE_INTEGER]));
    await done(tx);
    for (const track of TRACK_TYPES) this.chunkSeq.delete(`${takeId}\u0000${track}`);
  }

  /** Whether a take is still being captured by a tab that is alive. */
  async isTakeLive(take: DurableTake): Promise<boolean> {
    if (take.state !== 'capturing') return false;
    const locks = globalThis.navigator?.locks;
    if (locks?.query) {
      const snapshot = await locks.query();
      return (snapshot.held ?? []).some(lock => lock.name === lockName(take.id));
    }
    return Date.now() - take.lastChunkAt < LIVE_WITHOUT_LOCKS_MS;
  }

  private async updateTake(
    takeId: string,
    change: (take: DurableTake) => void,
    alsoWriteChunk?: (chunks: IDBObjectStore) => void,
  ): Promise<void> {
    const tx = (await this.db).transaction([TAKES, CHUNKS], 'readwrite');
    const takes = tx.objectStore(TAKES);
    const take = await request(takes.get(takeId)) as DurableTake | undefined;
    if (!take) {
      tx.abort();
      await done(tx).catch(() => {});
      throw new Error('The local recording was removed');
    }
    change(take);
    takes.put(take);
    alsoWriteChunk?.(tx.objectStore(CHUNKS));
    await done(tx);
  }
}

/**
 * Holds a Web Lock for as long as a take is captured, so other tabs can tell
 * a live take from one left behind by a crash. Returns the release function.
 */
export function holdTakeLock(takeId: string): () => void {
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return () => {};
  let release: () => void = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  void locks.request(lockName(takeId), () => held).catch(() => {});
  return release;
}

let shared: DurableRecordingStore | null | undefined;

/** The browser's store, or null where IndexedDB is unavailable. */
export function durableRecordingStore(): DurableRecordingStore | null {
  if (shared === undefined) {
    try {
      shared = globalThis.indexedDB ? new DurableRecordingStore(globalThis.indexedDB) : null;
    } catch {
      shared = null;
    }
  }
  return shared;
}
