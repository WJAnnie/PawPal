import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";

/**
 * Frisbee mini-game.
 *
 * 30-second session, 8 frisbee passes spread evenly across the timer. Each
 * pass launches a frisbee from a random side that arcs across the play field
 * and exits the other side. Tap (mouse click) the frisbee to catch it.
 *
 * Score >= REQUIRED_SCORE earns the bonus reward (the main process applies
 * coins + mood). On natural end or close, results are sent via
 * window.pawpal.frisbee.report and the window is dismissed.
 *
 * Layout: this is hosted in a frameless transparent BrowserWindow so the
 * top wrapper handles the visual chrome (rounded card + drag handle) and
 * the game canvas fills the rest.
 */

const GAME_DURATION_MS = 30_000;
const TOTAL_PASSES = 8;
const PASS_TRAVEL_MS = 1800;
const REQUIRED_SCORE = 5;

interface FrisbeeInstance {
  id: number;
  /** 0 = enters from left, 1 = enters from right. */
  fromLeft: boolean;
  /** Vertical arc apex (px from top of canvas). */
  arcY: number;
  startedAt: number;
  caught: boolean;
}

export function FrisbeeWindow(): JSX.Element {
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION_MS);
  const [phase, setPhase] = useState<"intro" | "playing" | "ended">("intro");
  const [frisbees, setFrisbees] = useState<FrisbeeInstance[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const passesLaunchedRef = useRef(0);
  const reportedRef = useRef(false);

  const startGame = useCallback((): void => {
    setPhase("playing");
    setScore(0);
    setFrisbees([]);
    passesLaunchedRef.current = 0;
    reportedRef.current = false;
    startedAtRef.current = Date.now();
  }, []);

  // Timer + pass scheduling.
  useEffect(() => {
    if (phase !== "playing") return;
    const intervalId = window.setInterval(() => {
      const startedAt = startedAtRef.current;
      if (startedAt === null) return;
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, GAME_DURATION_MS - elapsed);
      setTimeLeft(remaining);

      // Launch frisbees on a fixed schedule. We compute how many should have
      // launched by now and spawn the missing ones (catches up if the tab was
      // ever throttled).
      const targetLaunches = Math.min(
        TOTAL_PASSES,
        Math.floor((elapsed / GAME_DURATION_MS) * TOTAL_PASSES) + 1
      );
      while (passesLaunchedRef.current < targetLaunches) {
        passesLaunchedRef.current += 1;
        const id = passesLaunchedRef.current;
        setFrisbees((current) => [
          ...current,
          {
            id,
            fromLeft: Math.random() < 0.5,
            arcY: 60 + Math.floor(Math.random() * 80),
            startedAt: Date.now(),
            caught: false
          }
        ]);
      }

      if (remaining <= 0) {
        setPhase("ended");
        window.clearInterval(intervalId);
      }
    }, 100);
    return () => window.clearInterval(intervalId);
  }, [phase]);

  // Garbage-collect frisbees that have left the field.
  useEffect(() => {
    if (phase !== "playing") return;
    const cleanupId = window.setInterval(() => {
      const now = Date.now();
      setFrisbees((current) =>
        current.filter((f) => now - f.startedAt < PASS_TRAVEL_MS + 200)
      );
    }, 250);
    return () => window.clearInterval(cleanupId);
  }, [phase]);

  // Report result + auto-close on game end.
  useEffect(() => {
    if (phase !== "ended" || reportedRef.current) return;
    reportedRef.current = true;
    void window.pawpal.frisbee
      .report({ score, requiredScore: REQUIRED_SCORE, cancelled: false })
      .finally(() => {
        // Brief celebration before closing so the user sees the final score.
        window.setTimeout(() => window.pawpal.frisbee.close(), 2400);
      });
  }, [phase, score]);

  const handleCatch = useCallback((id: number): void => {
    setFrisbees((current) => {
      const target = current.find((f) => f.id === id);
      if (!target || target.caught) return current;
      return current.map((f) => (f.id === id ? { ...f, caught: true } : f));
    });
    setScore((prev) => prev + 1);
  }, []);

  const handleClose = useCallback((): void => {
    if (phase === "playing" && !reportedRef.current) {
      reportedRef.current = true;
      void window.pawpal.frisbee.report({
        score,
        requiredScore: REQUIRED_SCORE,
        cancelled: true
      });
    }
    window.pawpal.frisbee.close();
  }, [phase, score]);

  const secondsLeft = useMemo(() => Math.ceil(timeLeft / 1000), [timeLeft]);

  return (
    <div className="frisbee-shell">
      <header className="frisbee-shell__head">
        <span className="frisbee-shell__title">🥏 接飞盘</span>
        <span className="frisbee-shell__hud">
          <span className="frisbee-shell__score">得分 {score}</span>
          {phase === "playing" ? (
            <span className="frisbee-shell__timer">{secondsLeft}s</span>
          ) : null}
        </span>
        <button
          type="button"
          className="frisbee-shell__close"
          aria-label="关闭"
          onClick={handleClose}
        >
          ×
        </button>
      </header>

      <div className="frisbee-canvas">
        {phase === "intro" ? (
          <div className="frisbee-overlay">
            <p>准备好了吗？</p>
            <p className="frisbee-overlay__hint">30 秒内点中 5 次以上有惊喜！</p>
            <button
              type="button"
              className="frisbee-shell__primary"
              onClick={startGame}
            >
              开始
            </button>
          </div>
        ) : null}

        {phase === "ended" ? (
          <div className="frisbee-overlay">
            <p>{score >= REQUIRED_SCORE ? "🎉 漂亮！" : "辛苦啦～"}</p>
            <p className="frisbee-overlay__hint">最终得分：{score}</p>
          </div>
        ) : null}

        {phase === "playing"
          ? frisbees
              .filter((f) => !f.caught)
              .map((f) => (
                <FrisbeeSprite key={f.id} frisbee={f} onCatch={handleCatch} />
              ))
          : null}
      </div>
    </div>
  );
}

function FrisbeeSprite({
  frisbee,
  onCatch
}: {
  frisbee: FrisbeeInstance;
  onCatch: (id: number) => void;
}): JSX.Element {
  // We animate via CSS custom properties — start side and arc apex are the
  // only inputs. CSS keyframes handle the arc + horizontal transit.
  return (
    <button
      type="button"
      className={`frisbee-sprite ${
        frisbee.fromLeft ? "frisbee-sprite--ltr" : "frisbee-sprite--rtl"
      }`}
      style={{ ["--arc-y" as string]: `${frisbee.arcY}px` }}
      onClick={() => onCatch(frisbee.id)}
      aria-label="飞盘"
    >
      🥏
    </button>
  );
}
