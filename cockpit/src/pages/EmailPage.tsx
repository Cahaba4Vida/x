import { useEffect, useState } from 'react';
import { api } from '../api';

export function EmailPage() {
  const [digest, setDigest] = useState<Record<string, unknown>>({});
  useEffect(() => { api.getDigest().then(setDigest); }, []);
  return <div style={{ padding: 12 }}><h2>Daily Digest</h2><pre>{JSON.stringify(digest, null, 2)}</pre></div>;
}
