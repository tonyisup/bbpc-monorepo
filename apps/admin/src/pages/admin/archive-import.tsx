import { useConvex, useConvexAuth } from "convex/react";
import Head from "next/head";
import { useEffect, useRef, useState } from "react";

import { useBbpcAdminAuth } from "@/components/auth/BbpcAdminAuthContext";
import { Button } from "@/components/ui/button";
import {
  ARCHIVE_CHECKPOINT_KEY, ARCHIVE_ORIGIN, ARCHIVE_TARGET, archiveApi,
  parseApprovedArchivePlan, parseArchiveJournal, prepareArchiveImport, runArchiveImport,
  validateArchiveMediaProof,
  type ArchiveJournal, type ArchivePlan,
} from "@/convex/archiveImport";

export default function ArchiveImportPage() {
  const convex = useConvex();
  const auth = useBbpcAdminAuth();
  const { isAuthenticated } = useConvexAuth();
  const authorized = auth.accountStatus === "ready" && auth.user?.isAdmin === true && isAuthenticated;
  const authorizedRef = useRef(authorized);
  authorizedRef.current = authorized;
  const stopRef = useRef(false);
  const busyRef = useRef(false);
  const [plan, setPlan] = useState<ArchivePlan | null>(null);
  const [proof, setProof] = useState("");
  const [proofDate, setProofDate] = useState("");
  const [journal, setJournal] = useState<ArchiveJournal | null>(null);
  const [backedUp, setBackedUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [message, setMessage] = useState("Load the approved plan and recent read-only Azure preflight.");
  const [error, setError] = useState("");

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (busyRef.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => { stopRef.current = true; window.removeEventListener("beforeunload", warn); };
  }, []);

  function persist(value: ArchiveJournal) {
    const serialized = JSON.stringify(value);
    localStorage.setItem(ARCHIVE_CHECKPOINT_KEY, serialized);
    if (localStorage.getItem(ARCHIVE_CHECKPOINT_KEY) !== serialized) throw new Error("Recovery checkpoint could not be saved. Import stopped.");
  }

  async function exclusively(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      if (!authorizedRef.current || location.origin !== ARCHIVE_ORIGIN || convex.url !== ARCHIVE_TARGET) throw new Error("Use the signed-in production admin site for this approved batch.");
      if (!navigator.locks) throw new Error("This browser cannot safely lock the import. Use a current Chrome browser.");
      await navigator.locks.request(ARCHIVE_CHECKPOINT_KEY, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error("Another tab is operating this archive import.");
        await work();
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import stopped. Review the recovery checkpoint before continuing.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function apiClient() {
    return archiveApi(convex, () => authorizedRef.current && location.origin === ARCHIVE_ORIGIN);
  }

  async function prepare() {
    await exclusively(async () => {
      if (!plan) throw new Error("Load the approved plan first.");
      validateArchiveMediaProof(proof);
      setMessage("Checking the complete authenticated catalog. No writes yet.");
      setJournal(null);
      setBackedUp(false);
      const saved = localStorage.getItem(ARCHIVE_CHECKPOINT_KEY);
      const checkpoint = await prepareArchiveImport(plan, apiClient(), saved ? parseArchiveJournal(saved) : undefined);
      persist(checkpoint);
      setJournal(checkpoint);
      setCompleted(Object.values(checkpoint.entries).filter(e => e.state === "done").length);
      setMessage("Preflight passed. Download the recovery checkpoint before applying or resuming.");
    });
  }

  function downloadCheckpoint() {
    try {
      const saved = localStorage.getItem(ARCHIVE_CHECKPOINT_KEY);
      if (!saved) throw new Error("Run preflight before downloading a checkpoint.");
      parseArchiveJournal(saved);
      const url = URL.createObjectURL(new Blob([saved], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `bbpc-archive-checkpoint-${new Date().toISOString().replaceAll(":", "-")}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setBackedUp(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Checkpoint download failed."); }
  }

  async function run() {
    await exclusively(async () => {
      if (!plan || !journal || !backedUp) throw new Error("Preflight and download the recovery checkpoint first.");
      validateArchiveMediaProof(proof);
      // Read the durable copy while holding the cross-tab lock, never a stale React snapshot.
      const saved = localStorage.getItem(ARCHIVE_CHECKPOINT_KEY);
      if (!saved) throw new Error("The durable checkpoint is missing.");
      const checkpoint = parseArchiveJournal(saved);
      stopRef.current = false;
      setJournal(checkpoint);
      const outcome = await runArchiveImport({ plan, journal: checkpoint, apiClient: apiClient(), persist,
        stop: () => stopRef.current || !authorizedRef.current,
        progress: (count, label) => { setCompleted(count); setMessage(label); },
      });
      setMessage(outcome === "complete" ? "All 552 approved operations verified. Download the final checkpoint. RSS is unchanged."
        : "Paused between operations. Run preflight again before resuming.");
      if (outcome === "paused") setBackedUp(false);
    });
  }

  if (!authorized) return <p role="status">Sign in with a verified BBPC administrator account to use the archive importer.</p>;

  return <section className="mx-auto max-w-3xl space-y-6 py-10">
    <Head><title>Approved archive import | BBPC Admin</title><meta name="robots" content="noindex,nofollow" /></Head>
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">Approved website archive import</h1>
      <p>292 recording-only updates · 260 new historical listings · No RSS cutover</p>
      <p className="text-sm text-muted-foreground">Only the exact reviewed plan is accepted. Existing metadata, episode relationships, and Azure files are not edited. Keep this tab open and avoid editing the episode catalog from another session while it runs.</p>
    </div>
    <div className="space-y-4 rounded-lg border p-5">
      <label className="block space-y-2">
        <span>Approved plan JSON</span>
        <input aria-label="Approved plan JSON" type="file" accept=".json,application/json" disabled={busy} className="block w-full text-sm" onChange={event => {
          const file = event.target.files?.[0];
          setPlan(null); setJournal(null); setBackedUp(false); setError("");
          if (file) void file.text().then(parseApprovedArchivePlan).then(value => { setPlan(value); setMessage("Exact approved plan verified: 552 operations."); }).catch(cause => setError(String(cause)));
        }} />
      </label>
      <label className="block space-y-2">
        <span>Azure preflight proof JSON (less than 2 hours old)</span>
        <input aria-label="Azure preflight proof JSON" type="file" accept=".json,application/json" disabled={busy} className="block w-full text-sm" onChange={event => {
          const file = event.target.files?.[0];
          setProof(""); setProofDate(""); setJournal(null); setBackedUp(false); setError("");
          if (file) void file.text().then(text => { setProofDate(validateArchiveMediaProof(text)); setProof(text); }).catch(cause => setError(String(cause)));
        }} />
      </label>
      {proofDate && <p className="text-sm">Azure objects checked: {proofDate}</p>}
      <div className="flex flex-wrap gap-3">
        <Button disabled={busy || !plan || !proof} onClick={() => { void prepare(); }}>Run read-only preflight</Button>
        <Button variant="outline" disabled={busy || !journal} onClick={downloadCheckpoint}>Download recovery checkpoint</Button>
      </div>
    </div>
    <div className="space-y-4 rounded-lg border p-5">
      <p role="status" aria-live="polite">{message}</p>
      <progress className="w-full" aria-label="Verified archive operations" value={completed} max={552} />
      <p>{completed} / 552 operations verified</p>
      {error && <p role="alert" className="whitespace-pre-wrap text-destructive">{error}</p>}
      <div className="flex gap-3">
        <Button disabled={busy || !journal || !backedUp || completed === 552} onClick={() => { void run(); }}>Apply / resume approved batch</Button>
        <Button variant="outline" disabled={!busy} onClick={() => { stopRef.current = true; setMessage("Stopping after the current operation…"); }}>Pause after current operation</Button>
      </div>
      <p className="text-sm text-muted-foreground">Checkpoints contain private catalog metadata. Keep downloaded copies private. No analytics or service credentials are collected.</p>
    </div>
  </section>;
}
