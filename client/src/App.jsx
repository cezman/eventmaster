import React from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import Landing from "./pages/Landing";
import AuthPage from "./pages/AuthPage";
import Dashboard from "./pages/Dashboard";
import QuizEditor from "./pages/QuizEditor";
import HostGame from "./pages/HostGame";
import PlayGame from "./pages/PlayGame";
import NotFound from "./pages/NotFound";
import ProfilePage from "./pages/ProfilePage";
import HistoryPage from "./pages/HistoryPage";
import AdminPage from "./pages/AdminPage";

function RequireAuth({ children }) {
  const { token } = useAuth();
  const location = useLocation();
  if (!token) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/quiz/:id"
        element={
          <RequireAuth>
            <QuizEditor />
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <AdminPage />
          </RequireAuth>
        }
      />
      <Route
        path="/history"
        element={
          <RequireAuth>
            <HistoryPage />
          </RequireAuth>
        }
      />
      <Route
        path="/profile"
        element={
          <RequireAuth>
            <ProfilePage />
          </RequireAuth>
        }
      />
      <Route
        path="/host/:quizId"
        element={
          <RequireAuth>
            <HostGame />
          </RequireAuth>
        }
      />
      <Route path="/play" element={<PlayGame />} />
      <Route path="/play/:pin" element={<PlayGame />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
