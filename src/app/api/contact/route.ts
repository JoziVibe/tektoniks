import { NextResponse } from "next/server";
import { Resend } from "resend";
import { z } from "zod";

export const runtime = "nodejs";

const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MIN_SUBMIT_TIME_MS = 2500;
const MAX_SUBMIT_TIME_MS = 1000 * 60 * 60 * 6;
const IP_RATE_LIMIT_MAX = 5;
const IP_RATE_LIMIT_WINDOW_MS = 1000 * 60 * 15;
const EMAIL_RATE_LIMIT_MAX = 3;
const EMAIL_RATE_LIMIT_WINDOW_MS = 1000 * 60 * 60;

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type TurnstileResponse = {
  success?: boolean;
  "error-codes"?: string[];
};

const rateLimitBuckets = new Map<string, RateLimitBucket>();

const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  company: z.string().trim().max(160).optional().default(""),
  message: z.string().trim().min(1).max(4000),
  website: z.string().trim().max(200).optional().default(""),
  submittedAt: z.number().int().positive().optional(),
  turnstileToken: z.string().trim().max(2048).optional().default(""),
});

const forbiddenPattern =
  /(https?:\/\/[^\s]+|www\.[^\s]+|[<>{};]|\b(script|function|const|let|var|eval)\b)/i;

const stripUnsafeContent = (value: string) =>
  value
    .replace(/<[^>]*>?/gm, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+=/gi, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim();

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const hasForbiddenContent = (value: string) => forbiddenPattern.test(value);

const getClientIp = (request: Request) => {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const firstForwardedIp = forwardedFor?.split(",")[0]?.trim();

  return (
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    firstForwardedIp ||
    "unknown"
  );
};

const pruneRateLimitBuckets = (now: number) => {
  if (rateLimitBuckets.size < 500) {
    return;
  }

  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) {
      rateLimitBuckets.delete(key);
    }
  }
};

const isRateLimited = (key: string, max: number, windowMs: number) => {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);

  pruneRateLimitBuckets(now);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  if (bucket.count >= max) {
    return true;
  }

  bucket.count += 1;
  return false;
};

const getPacingError = (submittedAt?: number) => {
  if (!submittedAt) {
    return "Please refresh the page and try again.";
  }

  const elapsedMs = Date.now() - submittedAt;

  if (elapsedMs < MIN_SUBMIT_TIME_MS) {
    return "Please wait a moment before submitting.";
  }

  if (elapsedMs > MAX_SUBMIT_TIME_MS || elapsedMs < 0) {
    return "Please refresh the page and try again.";
  }

  return null;
};

const verifyTurnstileToken = async (token: string, remoteIp: string) => {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  if (!secret || !siteKey) {
    return true;
  }

  if (!token || token.length > 2048) {
    return false;
  }

  try {
    const body = new URLSearchParams({
      secret,
      response: token,
    });

    if (remoteIp !== "unknown") {
      body.set("remoteip", remoteIp);
    }

    const response = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return false;
    }

    const result = (await response.json()) as TurnstileResponse;
    return result.success === true;
  } catch (error) {
    console.error("Turnstile validation failed", error);
    return false;
  }
};

const getValidationError = (issues: z.ZodIssue[]) => {
  const field = issues[0]?.path[0];

  if (field === "name") {
    return "Please enter your full name.";
  }

  if (field === "email") {
    return "Please enter a valid email address.";
  }

  if (field === "message") {
    return "Please enter a message.";
  }

  return "Please complete the required fields.";
};

export async function POST(request: Request) {
  const clientIp = getClientIp(request);
  const userAgent = request.headers.get("user-agent")?.trim() ?? "";
  const payload = await request.json().catch(() => null);
  const parsed = contactSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: getValidationError(parsed.error.issues) },
      { status: 400 },
    );
  }

  if (parsed.data.website) {
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  if (!userAgent) {
    return NextResponse.json(
      { error: "Please submit the form from a browser." },
      { status: 400 },
    );
  }

  const pacingError = getPacingError(parsed.data.submittedAt);

  if (pacingError) {
    return NextResponse.json({ error: pacingError }, { status: 400 });
  }

  if (
    isRateLimited(
      `ip:${clientIp}`,
      IP_RATE_LIMIT_MAX,
      IP_RATE_LIMIT_WINDOW_MS,
    )
  ) {
    return NextResponse.json(
      { error: "Too many inquiries. Please try again later." },
      { status: 429 },
    );
  }

  if (
    hasForbiddenContent(parsed.data.name) ||
    hasForbiddenContent(parsed.data.company) ||
    hasForbiddenContent(parsed.data.message)
  ) {
    return NextResponse.json(
      { error: "Links and code snippets are not allowed in inquiries." },
      { status: 400 },
    );
  }

  const turnstilePassed = await verifyTurnstileToken(
    parsed.data.turnstileToken,
    clientIp,
  );

  if (!turnstilePassed) {
    return NextResponse.json(
      { error: "Verification failed. Please try again." },
      { status: 400 },
    );
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  const toEmail = process.env.RESEND_TO_EMAIL ?? "info@tektonics.africa";
  const fromName = process.env.RESEND_FROM_NAME ?? "Tektonics Website";
  const subjectPrefix =
    process.env.RESEND_SUBJECT_PREFIX ?? "Tektonics Website Inquiry";

  if (!apiKey || !fromEmail) {
    console.error("Resend is not configured. RESEND_API_KEY and RESEND_FROM_EMAIL are required.");

    return NextResponse.json(
      { error: "Email service is not configured yet." },
      { status: 500 },
    );
  }

  const inquiry = {
    name: stripUnsafeContent(parsed.data.name),
    email: stripUnsafeContent(parsed.data.email),
    company: stripUnsafeContent(parsed.data.company),
    message: stripUnsafeContent(parsed.data.message),
  };

  if (
    isRateLimited(
      `email:${inquiry.email.toLowerCase()}`,
      EMAIL_RATE_LIMIT_MAX,
      EMAIL_RATE_LIMIT_WINDOW_MS,
    )
  ) {
    return NextResponse.json(
      { error: "Too many inquiries. Please try again later." },
      { status: 429 },
    );
  }

  const text = [
    "New inquiry from the Tektonics website",
    "",
    `Name: ${inquiry.name}`,
    `Email: ${inquiry.email}`,
    `Company: ${inquiry.company || "N/A"}`,
    "",
    "Message:",
    inquiry.message,
  ].join("\n");

  const html = `
    <h2>New inquiry from the Tektonics website</h2>
    <p><strong>Name:</strong> ${escapeHtml(inquiry.name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(inquiry.email)}</p>
    <p><strong>Company:</strong> ${escapeHtml(inquiry.company || "N/A")}</p>
    <p><strong>Message:</strong></p>
    <p>${escapeHtml(inquiry.message).replace(/\n/g, "<br />")}</p>
  `;

  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      to: toEmail,
      from: `${fromName} <${fromEmail}>`,
      replyTo: inquiry.email,
      subject: `${subjectPrefix}: ${inquiry.name}`,
      text,
      html,
      tags: [
        {
          name: "category",
          value: "website-contact",
        },
      ],
    });

    if (error) {
      console.error("Resend contact email failed", error);

      return NextResponse.json(
        { error: "We could not send your inquiry right now." },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("Resend contact email failed", error);

    return NextResponse.json(
      { error: "We could not send your inquiry right now." },
      { status: 502 },
    );
  }
}
