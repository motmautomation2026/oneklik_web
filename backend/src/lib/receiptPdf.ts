import PDFDocument from "pdfkit";
import type { PaymentReceiptRenderModel } from "./receiptHtml.js";

const BRAND = "#2262f0";
const PAID = "#1a7f37";
const PAGE_MARGIN = 48;
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2;

function pdfSafe(s: string): string {
  return s.replace(/\u20B9/g, "Rs.");
}

export function renderPaymentReceiptPdf(model: PaymentReceiptRenderModel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
      info: {
        Title: model.receipt_number,
        Author: "Quick ICP",
        Subject: "Payment Receipt",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = PAGE_MARGIN;
    const right = PAGE_MARGIN + CONTENT_WIDTH;
    let y = PAGE_MARGIN;

    doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(18).text("Quick ICP", left, y);
    y = doc.y + 6;
    doc.fillColor("#111").font("Helvetica-Bold").fontSize(22).text("Payment Receipt", left, y);
    y = doc.y + 8;
    doc.fillColor("#444").font("Helvetica").fontSize(10).text("This is to acknowledge that we have received your payment.", left, y, {
      width: CONTENT_WIDTH,
    });
    y = doc.y + 20;

    const meta: Array<[string, string, string?]> = [
      ["Invoice Number", model.invoice_number],
      ["Receipt Number", model.receipt_number],
    ];
    if (model.transaction_id) meta.push(["Transaction ID", model.transaction_id]);
    meta.push(["Date Paid", model.date_paid_label], ["Payment Status", model.status, "paid"]);

    for (const [label, value, kind] of meta) {
      doc.fillColor("#333").font("Helvetica-Bold").fontSize(10).text(label, left, y, { width: 130, lineBreak: false });
      if (kind === "paid") {
        doc.fillColor(PAID).font("Helvetica-Bold").text(value, left + 140, y);
      } else {
        doc.fillColor("#111").font("Helvetica").text(pdfSafe(value), left + 140, y);
      }
      y += 16;
    }

    y += 8;
    doc.moveTo(left, y).strokeColor(BRAND).lineWidth(1.2).lineTo(right, y).stroke();
    y += 14;

    doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(11).text("Received From", left, y);
    y = doc.y + 8;
    doc.fillColor("#111").font("Helvetica-Bold").fontSize(11).text(pdfSafe(model.buyer_name), left, y);
    y = doc.y + 4;
    doc.fillColor("#444").font("Helvetica").fontSize(10);
    if (model.buyer_location) {
      doc.text(pdfSafe(model.buyer_location), left, y, { width: CONTENT_WIDTH });
      y = doc.y + 2;
    }
    if (model.buyer_email) {
      doc.text(model.buyer_email, left, y, { width: CONTENT_WIDTH });
      y = doc.y + 2;
    }

    y += 12;
    doc.moveTo(left, y).strokeColor(BRAND).lineWidth(1.2).lineTo(right, y).stroke();
    y += 14;

    doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(11).text("Payment Details", left, y);
    y = doc.y + 8;
    doc.fillColor("#444").font("Helvetica").fontSize(10).text(pdfSafe(model.description), left, y, { width: CONTENT_WIDTH });
    y = doc.y + 8;
    doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(14).text(pdfSafe(model.amount_paid_label), left, y);
    y = doc.y + 6;
    doc.fillColor("#444").font("Helvetica").fontSize(10).text(`Payment Method: ${pdfSafe(model.payment_method)}`, left, y);

    y = doc.y + 18;
    doc.moveTo(left, y).strokeColor(BRAND).lineWidth(1.2).lineTo(right, y).stroke();
    y += 14;

    doc.fillColor("#666").font("Helvetica").fontSize(9);
    doc.text("This is a computer-generated receipt and does not require a signature.", left, y, { width: CONTENT_WIDTH });
    y = doc.y + 12;
    doc.text("Thank you,", left, y);
    y = doc.y + 4;
    doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(10).text(model.seller_name, left, y);
    if (model.seller_support_email) {
      y = doc.y + 2;
      doc.fillColor("#666").font("Helvetica").fontSize(9).text(model.seller_support_email, left, y);
    }

    doc.end();
  });
}
