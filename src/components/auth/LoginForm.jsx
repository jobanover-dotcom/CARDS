import React, { useState } from 'react';

function LoginForm({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!username || !password) {
      setError('Please fill in all fields');
      return;
    }

    const result = await onLogin({ username, password });

    if (result && result.error) {
      setError(result.error);
    }
  };

  return (
    <div className="flex justify-end items-center min-h-screen font-sans relative overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url('/cbackground.jpg')` }}
      />
      <div className="absolute inset-0 bg-[#1e3c72]/25"></div>
      <div className="bg-white/75 backdrop-blur-md rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.3)] p-10 max-sm:p-6 w-full max-w-[420px] max-sm:max-w-[90%] z-10 relative mr-16 max-sm:mr-0">
        <div className="text-center mb-7">
          <img src="/clogo.png" alt="CARWILL Construction Logo" className="max-w-[120px] h-auto mb-2.5 mx-auto object-contain" />
        </div>
        <h1 className="text-[#1e3c72] text-3xl max-sm:text-2xl m-0 text-center font-bold tracking-widest">Welcome to CARWILL</h1>
        <h2 className="text-[#2a5298] text-3xl max-sm:text-2xl mt-0 mx-0 mb-10 text-center font-bold tracking-widest">CONSTRUCTION</h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError('');
              }}
              className="py-3 px-4 border-2 border-[#e0e0e0] rounded-md text-sm transition-all duration-300 bg-[#f8f9fa]/80 text-[#333] placeholder:text-[#999] focus:outline-none focus:border-[#2a5298] focus:bg-white focus:ring-2 focus:ring-[#2a5298]/10"
            />
          </div>

          <div className="flex flex-col gap-2">
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              className="py-3 px-4 border-2 border-[#e0e0e0] rounded-md text-sm transition-all duration-300 bg-[#f8f9fa]/80 text-[#333] placeholder:text-[#999] focus:outline-none focus:border-[#2a5298] focus:bg-white focus:ring-2 focus:ring-[#2a5298]/10"
            />
          </div>

          {error && <div className="text-[#dc3545] text-[13px] py-2.5 px-3 bg-[#f8d7da] border border-[#f5c6cb] rounded mb-2">{error}</div>}

          <button type="submit" className="py-3.5 px-6 max-sm:py-3 max-sm:px-5 bg-gradient-to-br from-[#1e3c72] to-[#2a5298] text-white border-none rounded-md text-base max-sm:text-sm font-semibold cursor-pointer transition-all duration-300 mt-3 uppercase tracking-wider hover:-translate-y-0.5 hover:shadow-[0_10px_25px_rgba(42,82,152,0.3)] active:translate-y-0">
            Login
          </button>
        </form>
      </div>
    </div>
  );
}

export default LoginForm;
