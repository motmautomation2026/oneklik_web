import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./lib/AuthProvider";
import RequireAuth from "./components/RequireAuth";
import RootRedirect from "./components/RootRedirect";
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
import BuyCreditsPage from "./pages/BuyCreditsPage";
import ProfilePage from "./pages/ProfilePage";
import WalletPage from "./pages/WalletPage";
import RequireAdmin from "./admin/guards/RequireAdmin";
import AdminShell from "./admin/layout/AdminShell";
import AdminOverviewPage from "./admin/pages/AdminOverviewPage";
import AdminUsersPage from "./admin/pages/AdminUsersPage";
import AdminUserDetailPage from "./admin/pages/AdminUserDetailPage";
import AdminTransactionsPage from "./admin/pages/AdminTransactionsPage";
import AdminRunsPage from "./admin/pages/AdminRunsPage";
import AdminListsPage from "./admin/pages/AdminListsPage";

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
          <Route
            path="/buy-credits"
            element={
              <RequireAuth requireOnboarded>
                <BuyCreditsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/profile"
            element={
              <RequireAuth requireOnboarded>
                <ProfilePage />
              </RequireAuth>
            }
          />
          <Route
            path="/wallet"
            element={
              <RequireAuth requireOnboarded>
                <WalletPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin"
            element={
              // Deliberately no requireOnboarded here (unlike every product
              // route below) — an admin account promoted via SQL may never
              // have gone through /onboarding (profile.company left null),
              // and requireOnboarded would otherwise bounce them to
              // /onboarding before RequireAdmin even runs.
              <RequireAuth>
                <RequireAdmin>
                  <AdminShell />
                </RequireAdmin>
              </RequireAuth>
            }
          >
            <Route index element={<AdminOverviewPage />} />
            <Route path="users" element={<AdminUsersPage />} />
            <Route path="users/:id" element={<AdminUserDetailPage />} />
            <Route path="transactions" element={<AdminTransactionsPage />} />
            <Route path="runs" element={<AdminRunsPage />} />
            <Route path="lists" element={<AdminListsPage />} />
          </Route>
          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
