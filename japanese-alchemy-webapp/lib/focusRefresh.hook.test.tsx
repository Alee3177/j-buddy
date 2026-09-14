/* @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFocusRefresh } from './focusRefresh';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

function mount(active: boolean, refresh: () => void | Promise<void>) {
  function Probe() {
    useFocusRefresh(active, refresh);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  return {
    async render() {
      await act(async () => {
        root.render(<Probe />);
      });
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

beforeEach(() => {
  setVisibility('visible');
});

describe('useFocusRefresh', () => {
  it('calls refresh on a window focus event', async () => {
    const refresh = vi.fn();
    const probe = mount(true, refresh);
    await probe.render();

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    probe.unmount();
  });

  it('calls refresh on visibilitychange only when visibilityState is "visible"', async () => {
    const refresh = vi.fn();
    const probe = mount(true, refresh);
    await probe.render();

    setVisibility('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(refresh).not.toHaveBeenCalled();

    setVisibility('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    probe.unmount();
  });

  it('dedupes focus + visibilitychange firing together into a single refresh', async () => {
    let resolveRefresh!: () => void;
    const refresh = vi.fn(
      () => new Promise<void>((resolve) => { resolveRefresh = resolve; })
    );
    const probe = mount(true, refresh);
    await probe.render();

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(refresh).toHaveBeenCalledTimes(1);

    // Once the in-flight refresh settles, a genuinely new return-to-tab event
    // triggers a fresh refresh — the guard is re-entrancy, not a one-shot latch.
    await act(async () => {
      resolveRefresh();
    });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(refresh).toHaveBeenCalledTimes(2);

    probe.unmount();
  });

  it('does nothing while inactive (e.g. signed out / auth unresolved)', async () => {
    const refresh = vi.fn();
    const probe = mount(false, refresh);
    await probe.render();

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(refresh).not.toHaveBeenCalled();
    probe.unmount();
  });

  it('removes its event listeners on unmount', async () => {
    const refresh = vi.fn();
    const probe = mount(true, refresh);
    await probe.render();
    probe.unmount();

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(refresh).not.toHaveBeenCalled();
  });

  it('removes and re-adds listeners when active flips off then on (no leaked duplicate handlers)', async () => {
    const refresh = vi.fn();
    function Probe({ active }: { active: boolean }) {
      useFocusRefresh(active, refresh);
      return null;
    }
    const root = createRoot(document.createElement('div'));

    await act(async () => {
      root.render(<Probe active={true} />);
    });
    await act(async () => {
      root.render(<Probe active={false} />);
    });
    await act(async () => {
      root.render(<Probe active={true} />);
    });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    // Exactly one handler is live at a time — one call, not two.
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
