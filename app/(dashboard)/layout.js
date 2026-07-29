'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../src/context/AuthContext';

function DashboardLayout({ children }) {
  const { isLoggedIn, user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && (!isLoggedIn || !user)) {
      router.replace('/login');
    }
  }, [loading, isLoggedIn, user, router]);

  if (loading) {
    return (
      <div className="w-full h-full min-h-screen bg-slate-100 flex items-center justify-center">
        <p className="text-[#666] text-sm">Loading...</p>
      </div>
    );
  }

  if (!isLoggedIn || !user) {
    return (
      <div className="w-full h-full min-h-screen bg-slate-100 flex items-center justify-center">
        <p className="text-[#666] text-sm">Redirecting to login...</p>
      </div>
    );
  }

  return <>{children}</>;
}

export default DashboardLayout;
