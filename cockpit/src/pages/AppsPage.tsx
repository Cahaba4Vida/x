import { useEffect, useState } from 'react';
import { api } from '../api';

export function AppsPage() {
  const [apps, setApps] = useState<Array<Record<string, unknown>>>([]);
  useEffect(() => { api.getApps().then((r) => setApps(r.apps)); }, []);
  return <div style={{ padding: 12 }}>
    <h2>Configured Apps</h2>
    <pre>{JSON.stringify(apps, null, 2)}</pre>
  </div>;
}
