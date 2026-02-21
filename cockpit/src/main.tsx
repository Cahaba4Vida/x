import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { getToken } from './api';
import { DashboardPage } from './pages/DashboardPage';
import { EmailPage } from './pages/EmailPage';
import { LoginPage } from './pages/LoginPage';
import { PolicyPage } from './pages/PolicyPage';
import { TaskPage } from './pages/TaskPage';
import { ToolsPage } from './pages/ToolsPage';
import { AppsPage } from './pages/AppsPage';

const Guard = ({ children }: { children: JSX.Element }) => (getToken() ? children : <Navigate to="/login" replace />);

const Nav = () => (
  <nav style={{ display: 'flex', gap: 12, padding: 8 }}>
    <Link to="/dashboard">Dashboard</Link>
    <Link to="/email">Email</Link>
    <Link to="/policy">Policy</Link>
    <Link to="/tools">Tools</Link>
    <Link to="/apps">Apps</Link>
  </nav>
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Nav />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<Guard><DashboardPage /></Guard>} />
        <Route path="/tasks/:id" element={<Guard><TaskPage /></Guard>} />
        <Route path="/email" element={<Guard><EmailPage /></Guard>} />
        <Route path="/policy" element={<Guard><PolicyPage /></Guard>} />
        <Route path="/tools" element={<Guard><ToolsPage /></Guard>} />
        <Route path="/apps" element={<Guard><AppsPage /></Guard>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
