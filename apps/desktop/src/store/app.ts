/**
 * App store: one zustand store per webview, fed by the IPC transport.
 * Surfaces read slices with `useApp(selector)` and call actions via `useApp.getState().<action>`.
 */
import type { AppMethod, AppParams } from '@jarvis/core';
import { create } from 'zustand';
import type { Transport } from '../ipc/client';
import type { ModelStatus } from '../types/ui';
import {
  type AppStateSnapshot,
  applySnapshot,
  applyUiEvent,
  dismissToast,
  initialState,
  type UiState,
} from './reducer';

export interface AppActions {
  /** Attach a transport (real RPC or mock), subscribe to events and load the snapshot. */
  connect(transport: Transport): () => void;
  call<M extends AppMethod>(method: M, params: AppParams<M>): Promise<unknown>;
  dismissToast(id: string): void;
  setModels(models: ModelStatus[]): void;
  setMicLevel(level: number): void;
  setPushToTalk(pressed: boolean): void;
  setMicOpen(open: boolean): void;
}

let transport: Transport | null = null;

export const useApp = create<UiState & AppActions>()((set, get) => ({
  ...initialState(),

  connect(t) {
    transport = t;
    const offEvent = t.onNotification((method, params) => {
      set((s) => applyUiEvent(s, method, params));
    });
    const offStatus = t.onStatus((connection) => {
      set({ connection });
      if (connection === 'open') void loadSnapshot();
    });
    t.start();
    return () => {
      offEvent();
      offStatus();
      t.stop();
      if (transport === t) transport = null;
    };
  },

  async call(method, params) {
    if (!transport) throw new Error('not connected');
    return transport.call(method, params);
  },

  dismissToast(id) {
    set((s) => dismissToast(s, id));
  },
  setModels(models) {
    set({ models });
  },
  setMicLevel(micLevel) {
    if (Math.abs(get().micLevel - micLevel) > 0.01) set({ micLevel });
  },
  setPushToTalk(pushToTalk) {
    set({ pushToTalk });
  },
  setMicOpen(micOpen) {
    set({ micOpen });
  },
}));

async function loadSnapshot(): Promise<void> {
  const t = transport;
  if (!t) return;
  try {
    const snap = (await t.call('app.state', {})) as Partial<AppStateSnapshot>;
    useApp.setState((s) => applySnapshot(s, snap));
    const res = (await t.call('suggestions.list', {})) as { suggestions?: UiState['suggestions'] };
    if (res?.suggestions) useApp.setState({ suggestions: res.suggestions });
  } catch {
    // The connection dropped mid-load; the next 'open' reloads.
  }
}

/** Convenience for components: fire-and-forget an RPC and surface failures as a toast. */
export function send<M extends AppMethod>(method: M, params: AppParams<M>): void {
  useApp
    .getState()
    .call(method, params)
    .catch((e: unknown) => {
      useApp.setState((s) =>
        applyUiEvent(s, 'ui.toast', { level: 'error', title: e instanceof Error ? e.message : String(e) }),
      );
    });
}
