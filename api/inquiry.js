const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value, maxLength = 4000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function escapeHtml(value) {
  return clean(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

function getToAddresses(raw) {
  return clean(raw)
    .split(",")
    .map(address => address.trim())
    .filter(Boolean);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const body = req.body || {};
    const name = clean(body.name, 120);
    const email = clean(body.email, 254).toLowerCase();
    const phone = clean(body.phone, 60);
    const inquiryType = clean(body.type, 100) || "General Information";
    const business = clean(body.business, 160);
    const message = clean(body.message, 5000);

    if (!name || !email || !message) {
      return res.status(400).json({
        error: "Please enter your name, email address, and message."
      });
    }

    if (!EMAIL_PATTERN.test(email)) {
      return res.status(400).json({
        error: "Please enter a valid email address."
      });
    }

    const recipientRaw =
      process.env.RJ_INQUIRY_TO_EMAIL ||
      process.env.INQUIRY_TO_EMAIL ||
      "";

    const from =
      process.env.RJ_INQUIRY_FROM_EMAIL ||
      process.env.INQUIRY_FROM_EMAIL ||
      "";

    const recipients = getToAddresses(recipientRaw);

    if (!recipients.length || !from) {
      console.error("R&J inquiry email configuration is incomplete.");
      return res.status(500).json({
        error: "The website email service is not configured yet. Please try again later."
      });
    }

    const subject = `R&J Productions Website Inquiry — ${inquiryType} — ${name}`;

    const text = [
      "New R&J Productions website inquiry",
      "",
      `Name: ${name}`,
      `Email: ${email}`,
      phone ? `Phone: ${phone}` : "",
      `Inquiry Type: ${inquiryType}`,
      business ? `Business: ${business}` : "",
      "",
      "Message:",
      message
    ].filter(Boolean).join("\n");

    const html = [
      "<h2>New R&amp;J Productions website inquiry</h2>",
      `<p><strong>Name:</strong> ${escapeHtml(name)}</p>`,
      `<p><strong>Email:</strong> ${escapeHtml(email)}</p>`,
      phone ? `<p><strong>Phone:</strong> ${escapeHtml(phone)}</p>` : "",
      `<p><strong>Inquiry Type:</strong> ${escapeHtml(inquiryType)}</p>`,
      business ? `<p><strong>Business:</strong> ${escapeHtml(business)}</p>` : "",
      `<p><strong>Message:</strong></p><p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>`
    ].filter(Boolean).join("");

    const resendKey =
      process.env.RJ_RESEND_API_KEY ||
      process.env.RESEND_API_KEY ||
      "";

    if (resendKey) {
      const resendResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from,
          to: recipients,
          reply_to: email,
          subject,
          text,
          html
        })
      });

      if (!resendResponse.ok) {
        const details = await resendResponse.text();
        console.error("Resend email error:", details);
        return res.status(502).json({
          error: "The email service rejected the message. Please try again later."
        });
      }
    } else {
      const smtpHost =
        process.env.RJ_SMTP_HOST ||
        process.env.SMTP_HOST ||
        "";

      const smtpPort = Number(
        process.env.RJ_SMTP_PORT ||
        process.env.SMTP_PORT ||
        587
      );

      const smtpUser =
        process.env.RJ_SMTP_USER ||
        process.env.SMTP_USER ||
        "";

      const smtpPass =
        process.env.RJ_SMTP_PASS ||
        process.env.SMTP_PASS ||
        "";

      if (!smtpHost || !smtpUser || !smtpPass) {
        console.error("R&J inquiry SMTP configuration is incomplete.");
        return res.status(500).json({
          error: "The website email service is not configured yet. Please try again later."
        });
      }

      const nodemailer = require("nodemailer");
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number.isFinite(smtpPort) ? smtpPort : 587,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass
        }
      });

      await transporter.sendMail({
        from,
        to: recipients.join(","),
        replyTo: email,
        subject,
        text,
        html
      });
    }

    return res.status(200).json({
      message: "Thanks for reaching out — your message was sent successfully. R&J Productions will get back to you soon."
    });
  } catch (error) {
    console.error("R&J inquiry handler error:", error);
    return res.status(500).json({
      error: "We could not send your message right now. Please try again."
    });
  }
};
