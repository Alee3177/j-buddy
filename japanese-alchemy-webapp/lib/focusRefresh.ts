'use client';

/**
 * P7.3-I — robust hybrid fallback for the realtime dashboard feeds.
 *
 * Production evidence (this phase) cleared the deployed bundle, the write/
 * listener paths, the React effect lifecycle, and permission/query errors as
 * causes of the live-refresh failure; what's left is an unreliable Firestore
 * `Listen` transport in the real browser environment, which is out of this
 * app's control to root-cause further. `onSnapshot` stays the PRIMARY realtime
 * mechanism (unchanged) — this hook adds a narrow, event-driven safety net: a
 * fresh one-shot server read whenever the user plausibly returns to the tab
 * (window `focus`, or `visibilitychange` becoming `"visible"`), which is
 * exactly the real workflow this bug affects (webapp open → work happens in
 * the Chrome Extension → user tabs back). No polling/setInterval — this only
 * fires on those two browser signals.
 */

import { useEffect, useRef } from 'react';

/**
 * @param active Whether to attach listeners at all — gate this on
 *   `authResolved && uid != null` (and, if the fallback fetch itself is
 *   optional for a given feed, on the fetch being provided) so a signed-out
 *   user, or one whose auth hasn't resolved yet, never triggers a refresh.
 * @param refresh Called on a qualifying focus/visibility event. Must be
 *   referentially stable (wrap in `useCallback`) or the effect will detach
 *   and reattach the browser listeners on every render.
 */
export function useFocusRefresh(active: boolean, refresh: () => void | Promise<void>): void {
  // Re-entrancy guard, not a timer: focus and visibilitychange can both fire
  // for the same "user returned to the tab" moment (they run synchronously
  // back-to-back), so the second one must be a no-op rather than issuing a
  // second concurrent fetch. Once the in-flight refresh settles, the guard
  // opens again for the next genuine return-to-tab event.
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!active) return;

    const trigger = () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      Promise.resolve()
        .then(refresh)
        .finally(() => {
          inFlightRef.current = false;
        });
    };

    const onFocus = () => trigger();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') trigger();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [active, refresh]);
}
