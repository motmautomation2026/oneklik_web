import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Col, Row } from "react-bootstrap";
import { Clipboard, ClipboardCheck, Download, InfoCircle, Linkedin } from "react-bootstrap-icons";
import { CHROME_EXTENSION } from "../lib/chromeExtension";

const EXTENSIONS_URL = "chrome://extensions";

// chrome:// URLs can't be opened from a web page — Chrome blocks the
// navigation and an <a href> would just do nothing on click. Give the user
// the string to paste instead.
function ExtensionsUrlChip() {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(EXTENSIONS_URL);
    } catch {
      // Clipboard API needs a secure context and can be blocked by policy.
      // The address is visible either way, so a failed copy is not an error
      // worth interrupting the install for.
      return;
    }
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <span className="ext-url-chip">
      <code>{EXTENSIONS_URL}</code>
      <Button
        size="sm"
        variant="link"
        className="ext-copy-btn"
        onClick={handleCopy}
        aria-label={`Copy ${EXTENSIONS_URL} to clipboard`}
      >
        {copied ? (
          <>
            <ClipboardCheck className="me-1" /> Copied
          </>
        ) : (
          <>
            <Clipboard className="me-1" /> Copy
          </>
        )}
      </Button>
    </span>
  );
}

interface Step {
  title: React.ReactNode;
  detail?: React.ReactNode;
}

const STEPS: Step[] = [
  {
    title: "Download the .zip",
    detail: "Use the button above the file lands in your browser's Downloads folder.",
  },
  {
    title: "Extract it",
    detail: (
      <>
        Unzip the file. You'll get a folder named <code>{CHROME_EXTENSION.folderName}</code> that
        exact folder is what Chrome needs in step 5.
      </>
    ),
  },
  {
    title: (
      <>
        Open <ExtensionsUrlChip />
      </>
    ),
    detail: "Paste it into a new tab's address bar links to chrome:// pages can't be clicked.",
  },
  {
    title: "Turn on Developer mode",
    detail: "The toggle sits in the top-right corner of the extensions page.",
  },
  {
    title: "Click Load unpacked",
    detail: (
      <>
        Select the extracted <code>{CHROME_EXTENSION.folderName}</code> folder itself not the .zip,
        and not a folder inside it.
      </>
    ),
  },
  {
    title: "Open LinkedIn and sign in",
    detail: "Click the QuickICP icon on a profile to open the side panel and sign in to your account.",
  },
];

export default function ChromeExtensionPanel() {
  return (
    <Row className="g-4 extension-panel">
      <Col xs={12} lg={5} xl={4}>
        {/* Deliberately not h-100 — matching the taller steps card left a
            large dead gap under the download button. */}
        <Card className="shadow-sm border-primary-subtle">
          <Card.Body>
            <div className="ext-icon mb-3">
              <Linkedin aria-hidden="true" />
            </div>
            <h2 className="h5 mb-1">QuickICP Chrome Extension</h2>
            <Badge bg="light" text="dark" className="ext-version mb-3">
              v{CHROME_EXTENSION.version}
            </Badge>
            <p className="text-body-secondary small mb-4">
              Find emails and phone numbers directly on LinkedIn, without leaving the profile you're
              looking at. Reveals use the same credits and the same balance as this page.
            </p>

            <Button
              as="a"
              href={CHROME_EXTENSION.downloadPath}
              download={CHROME_EXTENSION.fileName}
              variant="primary"
              size="lg"
              className="w-100"
            >
              <Download className="me-2" />
              Download Extension (.zip)
            </Button>
            <p className="text-body-secondary text-center small mt-2 mb-0">
              {CHROME_EXTENSION.sizeLabel} · v{CHROME_EXTENSION.version}
            </p>
          </Card.Body>
        </Card>
      </Col>

      <Col xs={12} lg={7} xl={8}>
        <Card className="shadow-sm h-100">
          <Card.Body>
            <h2 className="h6 mb-1">Install in 6 steps</h2>
            <p className="text-body-secondary small mb-4">
              Takes about a minute. You only do this once.
            </p>

            <ol className="ext-steps">
              {STEPS.map((step, i) => (
                <li key={i}>
                  <span className="ext-step-num">{i + 1}</span>
                  <div className="ext-step-body">
                    <span className="ext-step-title">{step.title}</span>
                    {step.detail && <span className="ext-step-detail">{step.detail}</span>}
                  </div>
                </li>
              ))}
            </ol>

            <div className="ext-note">
              <InfoCircle className="flex-shrink-0" />
              <span>
                Requires Chrome {CHROME_EXTENSION.minChromeVersion} or newer (Edge, Brave and other
                Chromium browsers work too). The extension only runs on linkedin.com and stays
                installed until you remove it  Chrome may ask you to confirm it after each restart
                while it's loaded unpacked.
              </span>
            </div>
          </Card.Body>
        </Card>
      </Col>
    </Row>
  );
}
