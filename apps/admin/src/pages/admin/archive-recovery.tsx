import { useConvex, useConvexAuth } from "convex/react";
import Head from "next/head";
import { useEffect, useRef, useState } from "react";
import { useBbpcAdminAuth } from "@/components/auth/BbpcAdminAuthContext";
import { Button } from "@/components/ui/button";
import { ARCHIVE_ORIGIN, ARCHIVE_TARGET, archiveApi } from "@/convex/archiveImport";
import { RECOVERY_KEY, applyRecovery, parseRecoveryJournal, parseRecoveryPlan, prepareRecovery,
  type RecoveryJournal, type RecoveryPlan } from "@/convex/archiveRecovery";

export default function ArchiveRecoveryPage() {
  const convex = useConvex();
  const auth = useBbpcAdminAuth();
  const { isAuthenticated } = useConvexAuth();
  const authorized = auth.accountStatus === "ready" && auth.user?.isAdmin === true && isAuthenticated;
  const authorizedRef = useRef(authorized);
  authorizedRef.current = authorized;
  const busyRef = useRef(false);
  const stopRef = useRef(false);
  const [plan, setPlan] = useState<RecoveryPlan | null>(null);
  const [journal, setJournal] = useState<RecoveryJournal | null>(null);
  const [busy, setBusy] = useState(false);
  const [backedUp, setBackedUp] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [message, setMessage] = useState("Load the approved recovery manifest. No writes yet.");
  const [error, setError] = useState("");
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (busyRef.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => { stopRef.current = true; window.removeEventListener("beforeunload", warn); };
  }, []);
  function persist(value: RecoveryJournal) {
    const text = JSON.stringify(value);
    localStorage.setItem(RECOVERY_KEY, text);
    if (localStorage.getItem(RECOVERY_KEY) !== text) throw new Error("Checkpoint persistence failed. Stopped.");
  }
  function apiClient() { return archiveApi(convex, () => authorizedRef.current && location.origin === ARCHIVE_ORIGIN); }
  async function exclusively(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      if (!authorizedRef.current || location.origin !== ARCHIVE_ORIGIN || convex.url !== ARCHIVE_TARGET) throw new Error("Use the signed-in production admin site.");
      if (!navigator.locks) throw new Error("Browser locking is required.");
      await navigator.locks.request(RECOVERY_KEY, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error("Recovery is running in another tab.");
        await work();
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBackedUp(false);
    } finally { busyRef.current = false; setBusy(false); }
  }
  async function prepare() {
    await exclusively(async () => {
      if (!plan) throw new Error("Load the approved manifest first.");
      setJournal(null); setBackedUp(false);
      setMessage("Checking the complete authenticated catalog. No writes yet.");
      const saved = localStorage.getItem(RECOVERY_KEY);
      const next = await prepareRecovery(plan, apiClient(), saved ? parseRecoveryJournal(saved) : undefined);
      persist(next); setJournal(next);
      setCompleted(Object.values(next.entries).filter(e => e === "done").length);
      setMessage("Preflight passed. Download the recovery checkpoint before applying.");
    });
  }
  function download() {
    try {
      const saved = localStorage.getItem(RECOVERY_KEY);
      if (!saved) throw new Error("Run preflight first.");
      parseRecoveryJournal(saved);
      const url = URL.createObjectURL(new Blob([saved], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `bbpc-recovery-741-759-${new Date().toISOString().replaceAll(":", "-")}.json`;
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setBackedUp(true);
    } catch (cause) { setError(String(cause)); }
  }
  async function run() {
    await exclusively(async () => {
      if (!plan || !journal || !backedUp) throw new Error("Preflight and download the checkpoint first.");
      const saved = localStorage.getItem(RECOVERY_KEY);
      if (!saved) throw new Error("Durable checkpoint missing.");
      const next = parseRecoveryJournal(saved);
      stopRef.current = false; setJournal(next);
      const result = await applyRecovery({ plan, journal: next, api: apiClient(), persist,
        stop: () => stopRef.current || !authorizedRef.current,
        progress: count => { setCompleted(count); setMessage(`Verified ${count} of 19 episodes.`); } });
      setMessage(result === "complete" ? "All 19 audio links and 11 date corrections verified. Download the final checkpoint. RSS unchanged."
        : "Paused. Run preflight again before resuming.");
      if (result === "paused") setBackedUp(false);
    });
  }
  if (!authorized) return <p role="status">Sign in with a verified BBPC administrator account.</p>;
  return <section className="mx-auto max-w-3xl space-y-6 py-10">
    <Head><title>Episodes 741–759 recovery | BBPC Admin</title><meta name="robots" content="noindex,nofollow" /></Head>
    <h1 className="text-2xl font-bold">Recover episodes 741–759</h1>
    <p>19 Azure audio links · 11 filename-based date corrections · No new listings or RSS cutover</p>
    <p>Only the exact approved manifest is accepted. All other episode fields and relationships are preserved. Avoid editing the catalog in other sessions during recovery.</p>
    <label className="block space-y-2"><span>Approved recovery manifest JSON</span>
      <input aria-label="Approved recovery manifest JSON" type="file" accept=".json,application/json" disabled={busy} onChange={event => {
        const file = event.target.files?.[0];
        setPlan(null); setJournal(null); setBackedUp(false); setCompleted(0); setError("");
        if (file) void file.text().then(parseRecoveryPlan).then(value => {
          setPlan(value); setMessage("Exact approved manifest verified: 19 episodes.");
        }).catch(cause => setError(String(cause)));
      }} />
    </label>
    {plan && <table className="w-full text-left text-sm"><thead><tr><th>Episode</th><th>Current date</th><th>Filename date</th></tr></thead>
      <tbody>{plan.operations.map(op => <tr key={op.before.id}><td>{op.before.number}</td><td>{op.before.date}</td><td>{op.date}</td></tr>)}</tbody></table>}
    <div className="flex flex-wrap gap-3">
      <Button disabled={busy || !plan} onClick={() => { void prepare(); }}>Run read-only preflight</Button>
      <Button variant="outline" disabled={busy || !journal} onClick={download}>Download recovery checkpoint</Button>
    </div>
    <p role="status" aria-live="polite">{message}</p>
    <progress aria-label="Verified recovery operations" value={completed} max={19} className="w-full" />
    <p>{completed} / 19 episodes verified</p>
    {error && <p role="alert" className="whitespace-pre-wrap text-destructive">{error}</p>}
    <div className="flex gap-3">
      <Button disabled={busy || !journal || !backedUp || completed === 19} onClick={() => { void run(); }}>Apply / resume approved recovery</Button>
      <Button variant="outline" disabled={!busy} onClick={() => { stopRef.current = true; }}>Pause after current episode</Button>
    </div>
    <p className="text-sm text-muted-foreground">Checkpoint files contain private catalog metadata. Keep them private. No analytics or credentials are collected.</p>
  </section>;
}
