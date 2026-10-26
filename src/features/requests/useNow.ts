// The current time, re-rendered every `intervalMs`: recurring requests say
// "next payment in 40 s" and must move on by themselves.
import { useEffect, useState } from 'react';

export function useNow(intervalMs = 5_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
