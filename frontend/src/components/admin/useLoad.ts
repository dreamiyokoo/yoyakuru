"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";

/** 読み込み中・エラー・再読み込みをまとめて扱う。key が変わると読み直す。 */
export function useLoad<T>(key: string | null, load: () => Promise<T>) {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string }>({ key: null, data: null, error: "" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (key === null) return;
    let active = true;
    load()
      .then((data) => active && setState({ key, data, error: "" }))
      .catch((e: unknown) => active && setState({ key, data: null, error: e instanceof ApiError ? e.message : "読み込みに失敗しました" }));
    return () => {
      active = false;
    };
    // load は呼び出し側で key に含めた値だけに依存する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data: state.key === key ? state.data : null, error: state.key === key ? state.error : "", loading: state.key !== key, reload };
}
