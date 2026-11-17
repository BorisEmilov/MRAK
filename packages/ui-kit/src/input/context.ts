import { createContext, useContext } from 'react';
import type { Binding, InputMode, PadType } from './devices';

export interface InputState {
  mode: InputMode;
  padType: PadType;
  bindings: Readonly<Record<string, Binding>>;
}

export const InputContext = createContext<InputState>({
  mode: 'keyboard',
  padType: 'generic',
  bindings: {},
});

export function useInput(): InputState {
  return useContext(InputContext);
}
