import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setToken } from '../api';

export function LoginPage() {
  const [token, setValue] = useState('');
  const nav = useNavigate();
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setToken(token);
    nav('/dashboard');
  };
  return <form onSubmit={onSubmit} style={{ padding: 12 }}><h2>Admin Token Login</h2><input value={token} onChange={(e) => setValue(e.target.value)} /><button>Save</button></form>;
}
