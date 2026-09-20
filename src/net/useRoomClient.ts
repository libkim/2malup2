import { createContext, useContext, useSyncExternalStore } from 'react';
import type { ClientState, RoomClient } from './client';

export const RoomClientContext = createContext<RoomClient | null>(null);

export function useClient(): RoomClient {
  const client = useContext(RoomClientContext);
  if (!client) throw new Error('RoomClientContext가 없습니다');
  return client;
}

export function useClientState(): ClientState {
  const client = useClient();
  return useSyncExternalStore(client.subscribe, client.getSnapshot);
}
