'use client';

import { useAuth } from '../src/context/AuthContext';
import LoginForm from '../src/components/auth/LoginForm';
import HomePage from '../src/screens/HomePage';

function Home() {
  const { isLoggedIn, user, login } = useAuth();

  return (
    <div className="w-full h-full min-h-screen bg-slate-100 text-slate-800">
      {isLoggedIn && user ? (
        <HomePage />
      ) : (
        <LoginForm onLogin={login} />
      )}
    </div>
  );
}

export default Home;
