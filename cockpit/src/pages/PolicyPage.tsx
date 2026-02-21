import { useEffect, useState } from 'react';
import { api } from '../api';

export function PolicyPage() {
  const [json, setJson] = useState('{}');
  useEffect(() => { api.getPolicy().then((p) => setJson(JSON.stringify(p, null, 2))); }, []);
  return <div style={{ padding: 12 }}><h2>Policy</h2><textarea rows={28} cols={80} value={json} onChange={(e) => setJson(e.target.value)} /><br/><button onClick={() => api.updatePolicy(JSON.parse(json))}>Save</button></div>;
}
