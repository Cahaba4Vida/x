import { useEffect, useState } from 'react';
import { api } from '../api';

export function ToolsPage() {
  const [tools, setTools] = useState<Record<string, boolean>>({});
  useEffect(() => {
    api.getTools().then((res) => {
      const next: Record<string, boolean> = {};
      res.tools.forEach((t) => { next[String(t.name)] = Boolean(t.enabled); });
      setTools(next);
    });
  }, []);
  return <div style={{ padding: 12 }}><h2>Tools</h2>
    {Object.entries(tools).map(([k, v]) => <div key={k}><label><input type="checkbox" checked={v} onChange={(e) => setTools({ ...tools, [k]: e.target.checked })} />{k}</label></div>)}
    <button onClick={() => api.updateTools(tools)}>Save</button>
  </div>;
}
