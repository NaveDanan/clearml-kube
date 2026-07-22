// Email Service Configuration
// Supports multiple providers: Resend (recommended), EmailJS (browser-only), or SMTP
// 
// RECOMMENDED: Use Resend (https://resend.com)
// 1. Create a free account at https://resend.com
// 2. Add and verify your domain (or use their test domain for development)
// 3. Create an API key
// 4. Set RESEND_API_KEY in your environment variables
//
// ALTERNATIVE: EmailJS (browser-only, not recommended for server-side)
// Note: EmailJS REST API doesn't work from server-side code (returns 403)
// Only use if you're calling from client-side code directly

interface SendInviteEmailParams {
  to: string;
  inviterName: string;
  inviterEmail: string;
  pipelineName?: string;
  shareUrl: string;
}

export async function sendInviteEmail({
  to,
  inviterName,
  inviterEmail,
  pipelineName,
  shareUrl,
}: SendInviteEmailParams): Promise<{ success: boolean; error?: string; notConfigured?: boolean }> {
  // Try Resend first (recommended for server-side)
  const resendApiKey = process.env.RESEND_API_KEY;
  
  if (resendApiKey) {
    return sendWithResend({
      to,
      inviterName,
      inviterEmail,
      pipelineName,
      shareUrl,
      apiKey: resendApiKey,
    });
  }

  // Fallback: Check if EmailJS is configured (note: only works client-side)
  const publicKey = process.env.EMAILJS_PUBLIC_KEY;
  const serviceId = process.env.EMAILJS_SERVICE_ID;
  const templateId = process.env.EMAILJS_TEMPLATE_ID;

  if (publicKey && serviceId && templateId) {
    console.warn('EmailJS is configured but only works in browser environments. Consider using Resend instead.');
    return sendWithEmailJS({
      to,
      inviterName,
      inviterEmail,
      pipelineName,
      shareUrl,
      publicKey,
      serviceId,
      templateId,
    });
  }

  // No email provider configured
  console.warn('No email provider configured. Set RESEND_API_KEY (recommended) or EMAILJS_* environment variables.');
  return { 
    success: false, 
    notConfigured: true,
    error: 'Email sending not configured. Please set RESEND_API_KEY environment variable.' 
  };
}

// Send email using Resend (recommended - works server-side)
async function sendWithResend({
  to,
  inviterName,
  inviterEmail,
  pipelineName,
  shareUrl,
  apiKey,
}: SendInviteEmailParams & { apiKey: string }): Promise<{ success: boolean; error?: string }> {
  // Generate recipient name from email
  const toName = to.split('@')[0]
    .replace(/[._-]/g, ' ')
    .split(' ')
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  const pipelineLabel = pipelineName || 'a ClearPipe pipeline';
  
  // Get the from email domain from environment or use default
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'ClearPipe <onboarding@resend.dev>';

  // Extract base URL from shareUrl for the logo
  const baseUrl = new URL(shareUrl).origin;
  const logoUrl = `${baseUrl}/images/logo_name.png`;

  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <img src="${logoUrl}" alt="ClearPipe" style="height: 40px; width: auto;" />
      </div>
      <h2 style="color: #4F46E5; margin-bottom: 24px;">You've been invited to collaborate!</h2>
      <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi ${toName},</p>
      <p style="color: #374151; font-size: 16px; line-height: 1.6;">
        <strong>${inviterName}</strong> (${inviterEmail}) has invited you to collaborate on <strong>${pipelineLabel}</strong>.
      </p>
      <p style="margin: 32px 0;">
        <a href="${shareUrl}" 
           style="background-color: #4F46E5; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 500;">
          Open Pipeline
        </a>
      </p>
      <p style="color: #6B7280; font-size: 14px;">
        Or copy this link: <a href="${shareUrl}" style="color: #4F46E5;">${shareUrl}</a>
      </p>
      <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 32px 0;">
      <p style="color: #9CA3AF; font-size: 12px;">
        This invitation was sent by ClearPipe. If you didn't expect this email, you can safely ignore it.
      </p>
    </div>
  `;

  const textContent = `
You've been invited to collaborate!

Hi ${toName},

${inviterName} (${inviterEmail}) has invited you to collaborate on ${pipelineLabel}.

Click here to open the pipeline: ${shareUrl}

---
This invitation was sent by ClearPipe.
  `.trim();

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [to],
        reply_to: inviterEmail,
        subject: `${inviterName} invited you to collaborate on ${pipelineLabel}`,
        html: htmlContent,
        text: textContent,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Resend error:', data);
      return { 
        success: false, 
        error: data.message || `Resend error (${response.status})` 
      };
    }

    console.log('Email sent successfully via Resend to:', to, 'ID:', data.id);
    return { success: true };

  } catch (error) {
    console.error('Error sending email via Resend:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to send email' 
    };
  }
}

// Send email using EmailJS (browser-only - not recommended for server-side)
async function sendWithEmailJS({
  to,
  inviterName,
  inviterEmail,
  pipelineName,
  shareUrl,
  publicKey,
  serviceId,
  templateId,
}: SendInviteEmailParams & { publicKey: string; serviceId: string; templateId: string }): Promise<{ success: boolean; error?: string }> {
  // Generate recipient name from email
  const toName = to.split('@')[0]
    .replace(/[._-]/g, ' ')
    .split(' ')
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  const pipelineLabel = pipelineName || 'a ClearPipe pipeline';
  const message = `${inviterName} has invited you to collaborate on ${pipelineLabel}.\n\nClick the link below to access the shared pipeline:\n${shareUrl}`;

  try {
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://clearpipe.app', // Required for EmailJS
      },
      body: JSON.stringify({
        service_id: serviceId,
        template_id: templateId,
        user_id: publicKey,
        template_params: {
          to_name: toName,
          to_email: to,
          from_name: inviterName,
          from_email: inviterEmail,
          reply_to: inviterEmail,
          message: message,
          share_url: shareUrl,
          pipeline_name: pipelineLabel,
        },
      }),
    });

    const responseText = await response.text();
    
    if (!response.ok) {
      console.error('EmailJS error:', response.status, responseText);
      return { 
        success: false, 
        error: `EmailJS error (${response.status}): ${responseText}. Note: EmailJS only works in browser environments.` 
      };
    }

    if (responseText === 'OK') {
      console.log('Email sent successfully via EmailJS to:', to);
      return { success: true };
    }

    return { success: true };

  } catch (error) {
    console.error('Error sending email via EmailJS:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to send email' 
    };
  }
}

// Export config check function
export function getEmailConfig() {
  const hasResend = !!process.env.RESEND_API_KEY;
  const hasEmailJS = !!(process.env.EMAILJS_PUBLIC_KEY && process.env.EMAILJS_SERVICE_ID && process.env.EMAILJS_TEMPLATE_ID);
  
  return {
    provider: hasResend ? 'resend' : hasEmailJS ? 'emailjs' : 'none',
    isConfigured: hasResend || hasEmailJS,
    resendConfigured: hasResend,
    emailJSConfigured: hasEmailJS,
  };
}

/**
 * Email Provider Setup Guide:
 * 
 * OPTION 1: Resend (Recommended - Works Server-Side)
 * ================================================
 * 1. Create account at https://resend.com (free tier: 3,000 emails/month)
 * 2. Go to API Keys and create a new key
 * 3. Add to your .env file:
 *    RESEND_API_KEY=re_xxxxxxxxxxxx
 *    RESEND_FROM_EMAIL=Your App <noreply@yourdomain.com>
 * 
 * For development, you can use their test domain:
 *    RESEND_FROM_EMAIL=ClearPipe <onboarding@resend.dev>
 * 
 * OPTION 2: EmailJS (Browser-Only - Not Recommended)
 * ==================================================
 * Note: EmailJS only works when called from browser JavaScript.
 * Server-side calls will return 403 errors.
 * 
 * If you must use EmailJS, call it from client-side code:
 *    EMAILJS_PUBLIC_KEY=your-public-key
 *    EMAILJS_SERVICE_ID=your-service-id
 *    EMAILJS_TEMPLATE_ID=your-template-id
 */
