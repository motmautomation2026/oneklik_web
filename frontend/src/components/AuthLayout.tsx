import type { ReactNode } from "react";
import { CheckCircleFill } from "react-bootstrap-icons";

const FEATURES = [
  "Verified company & people data",
  "Instant email & phone reveal",
  "AI-powered search, one sentence away",
];

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell">
      <div className="auth-visual">
        <div className="auth-visual-brand">
          <span className="auth-visual-logo">OK</span>
          One-Klik
        </div>

        <div>
          <h1 className="auth-visual-headline">B2B company &amp; people search, in one click.</h1>
          <ul className="auth-visual-features">
            {FEATURES.map((feature) => (
              <li key={feature}>
                <CheckCircleFill size={16} />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="auth-visual-foot">Verified contact data, delivered fast.</p>
      </div>

      <div className="auth-form-panel">{children}</div>
    </div>
  );
}
