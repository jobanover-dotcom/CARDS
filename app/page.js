'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../src/context/AuthContext';
import PageSkeleton from '../src/components/ui/PageSkeleton';

function Home() {
  const { isLoggedIn, user, loading } = useAuth();
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
    } else {
      router.replace('/login');
    }
  }, [loading, isLoggedIn, user, router]);

  return (
    <div className="w-full h-full min-h-screen bg-slate-100 p-8 max-md:p-4">
      <PageSkeleton />
    </div>
  );
}

export default Home;
