import '../src/styles/tailwind.css';
import '../src/styles/globals.css';
import { AuthProvider } from '../src/context/AuthContext';

export const metadata = {
  title: 'CARWILL Construction - Material Management',
  description: 'CARWILL Construction Material Management System',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
