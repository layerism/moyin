import { useEffect } from "react";

export function useStudentPresence(studentId: number | null) {
  useEffect(() => {
    if (studentId === null) return;
    let pending = false;
    const controller = new AbortController();
    const heartbeat = async () => {
      if (pending || controller.signal.aborted) return;
      pending = true;
      try {
        await fetch("/api/student/presence/heartbeat", {
          method: "POST", credentials: "include",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        });
      } catch { /* A later heartbeat will retry after network recovery. */ }
      finally { pending = false; }
    };
    void heartbeat();
    const timer = window.setInterval(() => void heartbeat(), 30_000);
    const resume = () => { if (document.visibilityState === "visible") void heartbeat(); };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [studentId]);
}
