import { useState, useEffect } from 'react';
import type { District } from '../types';

export function useDistricts() {
  const [districts, setDistricts] = useState<District[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/data/districts.json')
      .then(r => r.json())
      .then((data: District[]) => {
        setDistricts(data);
        setLoading(false);
      })
      .catch(e => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  return { districts, loading, error };
}
