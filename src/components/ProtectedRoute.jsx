/**
 * ProtectedRoute — gates the app behind Google sign-in + authorization.
 * Shows a loader while auth resolves, redirects to /login if not authorized.
 */

import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

function ProtectedRoute({ children }) {
  const { currentUser, authorized, loading } = useAuth();

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1rem',
        background: 'linear-gradient(135deg, #14110A 0%, #3A2E14 100%)',
      }}>
        <div style={{
          width: '46px',
          height: '46px',
          border: '4px solid rgba(255,255,255,0.3)',
          borderTopColor: '#fff',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!currentUser || !authorized) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export default ProtectedRoute;
