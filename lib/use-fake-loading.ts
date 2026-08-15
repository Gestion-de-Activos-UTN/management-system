import { useEffect, useState } from 'react';

// ponytail: static placeholder until real queries wired, delete this whole hook then.
export function useFakeLoading(ms = 450) {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), ms);
    return () => clearTimeout(timer);
  }, [ms]);

  return loading;
}
