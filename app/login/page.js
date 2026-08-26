'use client';
import { useAuth } from '../../src/context/AuthContext';
import LoginForm from '../../src/components/auth/LoginForm';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

function LoginPage() {
  const { isLoggedIn, user, loading, login } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (isLoggedIn && user) {
      if (user.role === 'Superadmin') {
        router.replace('/admin');
      } else if (user.role === 'Admin') {
        router.replace('/purchaser');
      } else if (user.role === 'Warehouse') {
        router.replace('/warehouse');
      } else {
        router.replace('/login');
      }
    }
  }, [loading, isLoggedIn, user, router]);

  return (
    <div className="w-full h-full min-h-screen bg-slate-100 text-slate-800">
      {loading ? null : (!isLoggedIn || !user ? <LoginForm onLogin={login} /> : null)}
    </div>
  );
}

export default LoginPage;
