import React from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import Landing from "./pages/Landing";
import AuthPage from "./pages/AuthPage";
import Dashboard from "./pages/CabinetPage";
import QuizEditor from "./pages/QuizEditor";
import EventPage from "./pages/EventPage";
import HostPanel from "./pages/HostPanel";
import ScreenGame from "./pages/ScreenGame";
import PlayGame from "./pages/PlayGame";
import NotFound from "./pages/NotFound";
import AdminPage from "./pages/AdminPage";

function RequireAuth({ children }) {
  const { token } = useAuth();
  const location = useLocation();
  if (!token) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
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
        path="/event/:id"
        element={
          <RequireAuth>
            <EventPage />
          </RequireAuth>
        }
      />
      <Route
        path="/history"
        element={
          <RequireAuth>
            <Navigate to="/dashboard?tab=history" replace />
          </RequireAuth>
        }
      />
      <Route
        path="/profile"
        element={
          <RequireAuth>
            <Navigate to="/dashboard?tab=settings" replace />
          </RequireAuth>
        }
      />
      <Route
        path="/host/:quizId"
        element={
          <RequireAuth>
            <HostPanel />
          </RequireAuth>
        }
      />
      <Route path="/screen/:pin" element={<ScreenGame />} />
      <Route path="/play" element={<PlayGame />} />
      <Route path="/play/:pin" element={<PlayGame />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
