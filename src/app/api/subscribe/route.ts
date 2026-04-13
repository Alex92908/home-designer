import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { email, source } = await req.json();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;

  if (apiKey) {
    // Add contact to Resend audience
    const audienceId = process.env.RESEND_AUDIENCE_ID;
    if (audienceId) {
      await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email, unsubscribed: false }),
      });
    }

    // Send welcome email to subscriber
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM ?? "Home Designer <onboarding@resend.dev>",
        to: [email],
        subject: "Your Home Designer plan is ready 🏠",
        html: `<p>Hi there!</p>
<p>Thanks for using <strong>Home Designer</strong>. Your design plan has been saved.</p>
<p>Come back anytime to continue planning your perfect home: <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "https://home-designer-lovat.vercel.app"}">Open my plan</a></p>
<p>— The Home Designer Team</p>`,
      }),
    });

    // Notify owner
    const ownerEmail = process.env.OWNER_EMAIL;
    if (ownerEmail) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: process.env.RESEND_FROM ?? "Home Designer <onboarding@resend.dev>",
          to: [ownerEmail],
          subject: `New lead: ${email}`,
          html: `<p>New subscriber from <strong>${source ?? "unknown"}</strong>: ${email}</p>`,
        }),
      });
    }
  } else {
    // No API key — just log server-side for now
    console.log(`[subscribe] ${new Date().toISOString()} | ${email} | source: ${source}`);
  }

  return NextResponse.json({ ok: true });
}
