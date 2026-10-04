import { useImperativeHandle, useMemo, useState, type Dispatch, type ReactNode, type Ref, type SetStateAction } from "react";

export interface DialogStateHandle<T> {
  setState: Dispatch<SetStateAction<T>>;
}

/** An imperative opening updates only the dialog subtree, not its records table.
 * The render function still receives the latest metadata/permissions from its
 * parent; only the transient draft state belongs to this boundary. */
export function DialogStateBoundary<T extends object>({ initialState, controlRef, children }: {
  initialState: T;
  controlRef: Ref<DialogStateHandle<T>>;
  children: (state: T, setState: Dispatch<SetStateAction<T>>, setters: { [K in keyof T]: Dispatch<SetStateAction<T[K]>> }) => ReactNode;
}) {
  const [state, setState] = useState(initialState);
  const setters = useMemo(() => Object.fromEntries(Object.keys(initialState).map(key => [
    key, (value: unknown) => setState(current => {
      const field = key as keyof T;
      const next = typeof value === "function" ? value(current[field]) : value;
      return Object.is(current[field], next) ? current : { ...current, [key]: next };
    }),
  ])) as { [K in keyof T]: Dispatch<SetStateAction<T[K]>> }, [initialState]);
  useImperativeHandle(controlRef, () => ({ setState }), []);
  return children(state, setState, setters);
}