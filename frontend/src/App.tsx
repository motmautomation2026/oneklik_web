import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./lib/AuthProvider";
import RequireAuth from "./components/RequireAuth";
import RootRedirect from "./components/RootRedirect";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import OnboardingPage from "./pages/OnboardingPage";
import DashboardPage from "./pages/DashboardPage";
import CompanySearchPage from "./pages/CompanySearchPage";
import PeopleSearchPage from "./pages/PeopleSearchPage";
import LinkedInLookupPage from "./pages/LinkedInLookupPage";
import EmailTemplatesPage from "./pages/EmailTemplatesPage";
import ListsPage from "./pages/ListsPage";
import ListDetailPage from "./pages/ListDetailPage";
import BuyCreditsPage from "./pages/BuyCreditsPage";
import ProfilePage from "./pages/ProfilePage";
import WalletPage from "./pages/WalletPage";
import PaymentsPage from "./pages/PaymentsPage";
import BillingDetailsPage from "./pages/BillingDetailsPage";
import BillingHubPage from "./pages/BillingHubPage";
import BillingDocumentPage from "./pages/BillingDocumentPage";
import SupportPage from "./pages/SupportPage";
import NewTicketPage from "./pages/NewTicketPage";
import SupportTicketPage from "./pages/SupportTicketPage";
import RequireAdmin from "./admin/guards/RequireAdmin";
import AdminShell from "./admin/layout/AdminShell";
import AdminOverviewPage from "./admin/pages/AdminOverviewPage";
import AdminUsersPage from "./admin/pages/AdminUsersPage";
import AdminUserDetailPage from "./admin/pages/AdminUserDetailPage";
import AdminTransactionsPage from "./admin/pages/AdminTransactionsPage";
import AdminInvoicesPage from "./admin/pages/AdminInvoicesPage";
import AdminSubscriptionsPage from "./admin/pages/AdminSubscriptionsPage";
import AdminRunsPage from "./admin/pages/AdminRunsPage";
import AdminListsPage from "./admin/pages/AdminListsPage";
import AdminSupportPage from "./admin/pages/AdminSupportPage";
import AdminSupportDetailPage from "./admin/pages/AdminSupportDetailPage";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
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
            path="/email-templates"
            element={
              <RequireAuth requireOnboarded>
                <EmailTemplatesPage />
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
            path="/billing"
            element={
              <RequireAuth requireOnboarded>
                <BillingHubPage />
              </RequireAuth>
            }
          />
          <Route
            path="/billing/documents/:id"
            element={
              <RequireAuth requireOnboarded>
                <BillingDocumentPage />
              </RequireAuth>
            }
          />
          <Route
            path="/payments"
            element={
              <RequireAuth requireOnboarded>
                <PaymentsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/billing/details"
            element={
              <RequireAuth requireOnboarded>
                <BillingDetailsPage />
              </RequireAuth>
            }
          />
          {/* Support is the one authenticated surface a suspended or banned
              user can still reach — allowLockedOut is what lets them past the
              lockout screen, and requireOnboarded is deliberately omitted so a
              half-onboarded account can still ask for help. Static "/new" is
              declared before "/:id"; React Router ranks static segments above
              dynamic ones regardless of order, but keeping them in this order
              matches how the Express routers read. */}
          <Route
            path="/support"
            element={
              <RequireAuth allowLockedOut>
                <SupportPage />
              </RequireAuth>
            }
          />
          <Route
            path="/support/new"
            element={
              <RequireAuth allowLockedOut>
                <NewTicketPage />
              </RequireAuth>
            }
          />
          <Route
            path="/support/:id"
            element={
              <RequireAuth allowLockedOut>
                <SupportTicketPage />
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
            <Route path="invoices" element={<AdminInvoicesPage />} />
            <Route path="subscriptions" element={<AdminSubscriptionsPage />} />
            <Route path="runs" element={<AdminRunsPage />} />
            <Route path="support" element={<AdminSupportPage />} />
            <Route path="support/:id" element={<AdminSupportDetailPage />} />
            <Route path="lists" element={<AdminListsPage />} />
          </Route>
          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
