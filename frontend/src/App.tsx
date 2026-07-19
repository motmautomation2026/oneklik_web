import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./lib/AuthProvider";
import RequireAuth from "./components/RequireAuth";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import OnboardingPage from "./pages/OnboardingPage";
import DashboardPage from "./pages/DashboardPage";
import CompanySearchPage from "./pages/CompanySearchPage";
import PeopleSearchPage from "./pages/PeopleSearchPage";
import LinkedInLookupPage from "./pages/LinkedInLookupPage";
import ListsPage from "./pages/ListsPage";
import ListDetailPage from "./pages/ListDetailPage";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route
            path="/onboarding"
            element={
              <RequireAuth>
                <OnboardingPage />
              </RequireAuth>
            }
          />
          <Route
            path="/dashboard"
            element={
              <RequireAuth requireOnboarded>
                <DashboardPage />
              </RequireAuth>
            }
          />
          <Route
            path="/search"
            element={
              <RequireAuth requireOnboarded>
                <CompanySearchPage />
              </RequireAuth>
            }
          />
          <Route
            path="/people"
            element={
              <RequireAuth requireOnboarded>
                <PeopleSearchPage />
              </RequireAuth>
            }
          />
          <Route
            path="/linkedin-lookup"
            element={
              <RequireAuth requireOnboarded>
                <LinkedInLookupPage />
              </RequireAuth>
            }
          />
          <Route
            path="/lists"
            element={
              <RequireAuth requireOnboarded>
                <ListsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/lists/:id"
            element={
              <RequireAuth requireOnboarded>
                <ListDetailPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
