import { useState, useEffect } from 'react';
import type { Mukim } from '../types';

export function useMukims() {
  const [mukims, setMukims] = useState<Mukim[]>([]);
  const [loading, setLoading] = useState(false);

  const load = () => {
    if (mukims.length > 0 || loading) return;
    setLoading(true);
    fetch('/data/mukims.json')
      .then(r => r.json())
      .then((data: Mukim[]) => setMukims(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  return { mukims, loading, load };
}
